/**
 * This server's own GitHub App. The owner creates it from Server settings with GitHub's
 * app manifest flow, which hands back the app's id, private key, webhook secret and
 * OAuth credentials; they are stored encrypted. Each self-hosted server has its own app.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { SlashCommand } from "@shared/types";
import type { Env } from "../env";
import { schema, type Db } from "../db";
import { decryptSecret, encryptSecret, base64Url, fromBase64Url } from "../lib/crypto";
import { deleteSetting, getSetting, setSetting } from "../instance";
import { createAppUser } from "./app-users";
import { proxiedImage } from "./embeds";
import type { Fetcher } from "./bot-events";

export interface GitHubAppConfig {
  appId: number;
  slug: string;
  name: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: string;
  /** PEM, PKCS#1 or PKCS#8. */
  privateKey: string;
  webhookSecret: string;
}

const SETTING = "github_app";
const BOT_SETTING = "github_bot_user_id";
export const GITHUB_API = "https://api.github.com";

const cache = new WeakMap<object, { config: GitHubAppConfig | null; expiresAt: number }>();

export async function getGitHubApp(env: Env): Promise<GitHubAppConfig | null> {
  const hit = cache.get(env);
  if (hit && hit.expiresAt > Date.now()) return hit.config;
  const stored = await getSetting(env.DB, SETTING);
  const config = stored ? (JSON.parse(await decryptSecret(env, stored)) as GitHubAppConfig) : null;
  cache.set(env, { config, expiresAt: Date.now() + 60_000 });
  return config;
}

export async function saveGitHubApp(env: Env, config: GitHubAppConfig): Promise<void> {
  await setSetting(env.DB, SETTING, await encryptSecret(env, JSON.stringify(config)));
  cache.delete(env);
}

export async function forgetGitHubApp(env: Env, db: Db): Promise<void> {
  await deleteSetting(env.DB, SETTING);
  await db.delete(schema.githubInstallations);
  cache.delete(env);
  tokens.clear();
}

/** The built-in /github command, offered once the app exists. */
export async function githubCommand(env: Env): Promise<SlashCommand | null> {
  return (await getGitHubApp(env)) ? { name: "github", description: "Post a repository's activity in this channel", usage: "subscribe owner/repo · unsubscribe owner/repo · list" } : null;
}

// ---------------------------------------------------------------------------
// App manifest
// ---------------------------------------------------------------------------

/** GitHub App names are unique across GitHub and at most 34 characters. */
export function defaultAppName(origin: string): string {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  return `Chat ${host}`.slice(0, 34);
}

export function appManifest(origin: string, name: string) {
  return {
    name,
    url: origin,
    description: `Posts GitHub activity into Chat at ${new URL(origin).host}, and previews GitHub links.`,
    hook_attributes: { url: `${origin}/api/github/app/webhook`, active: true },
    redirect_url: `${origin}/api/github/app/created`,
    callback_urls: [`${origin}/api/github/account/callback`],
    setup_url: `${origin}/api/github/app/installed`,
    setup_on_update: true,
    public: false,
    request_oauth_on_install: false,
    default_permissions: { metadata: "read", contents: "read", issues: "write", pull_requests: "write", actions: "read" },
    default_events: ["push", "create", "delete", "issues", "issue_comment", "pull_request", "pull_request_review", "pull_request_review_comment", "release", "workflow_run", "commit_comment"],
  };
}

// ---------------------------------------------------------------------------
// Authenticating as the app, and as an installation
// ---------------------------------------------------------------------------

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/** GitHub issues PKCS#1 keys; Web Crypto only imports PKCS#8. Wraps one in the other. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octets = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [0x02, 0x01, 0x00, ...rsaAlgorithm, ...octets];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

function pemBody(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return fromBase64Url(b64.replace(/\+/g, "-").replace(/\//g, "_"));
}

const signingKeys = new Map<string, Promise<CryptoKey>>();

function importPrivateKey(pem: string): Promise<CryptoKey> {
  let key = signingKeys.get(pem);
  if (!key) {
    const der = pem.includes("BEGIN RSA PRIVATE KEY") ? pkcs1ToPkcs8(pemBody(pem)) : pemBody(pem);
    key = crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    signingKeys.set(pem, key);
  }
  return key;
}

/** A short-lived JWT that authenticates as the app itself. */
export async function appJwt(config: GitHubAppConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: String(config.appId) })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importPrivateKey(config.privateKey), new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

export interface GitHubResponse<T> {
  ok: boolean;
  status: number;
  data: T;
}

/** One GitHub REST call. `token` is an installation, user or app token. */
export async function githubApi<T = Record<string, unknown>>(path: string, init: { token?: string | null; method?: string; body?: unknown } = {}, fetcher: Fetcher = fetch): Promise<GitHubResponse<T>> {
  const res = await fetcher(`${GITHUB_API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Chat-GitHub-App",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

const tokens = new Map<number, { token: string; expiresAt: number }>();

export async function installationToken(env: Env, installationId: number, fetcher: Fetcher = fetch): Promise<string | null> {
  const hit = tokens.get(installationId);
  if (hit && hit.expiresAt > Date.now() + 5 * 60_000) return hit.token;
  const config = await getGitHubApp(env);
  if (!config) return null;
  const res = await githubApi<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, { method: "POST", token: await appJwt(config) }, fetcher);
  if (!res.ok || !res.data?.token) return null;
  tokens.set(installationId, { token: res.data.token, expiresAt: Date.parse(res.data.expires_at) });
  return res.data.token;
}

/** The installation covering an account (user or organisation), by login. */
export async function installationFor(db: Db, owner: string) {
  return db.query.githubInstallations.findFirst({ where: sql`lower(${schema.githubInstallations.accountLogin}) = ${owner.toLowerCase()}` });
}

/** A token that can read `owner`'s repositories, if the app is installed there. */
export async function tokenForOwner(env: Env, db: Db, owner: string, fetcher: Fetcher = fetch): Promise<string | null> {
  if (!(await getGitHubApp(env))) return null;
  const installation = await installationFor(db, owner);
  return installation ? installationToken(env, installation.id, fetcher) : null;
}

export async function recordInstallation(db: Db, installation: { id: number; account?: { login?: string; type?: string } | null }): Promise<void> {
  const login = installation.account?.login;
  if (!installation.id || !login) return;
  await db
    .insert(schema.githubInstallations)
    .values({ id: installation.id, accountLogin: login, accountType: installation.account?.type ?? "User", createdAt: new Date() })
    .onConflictDoUpdate({ target: schema.githubInstallations.id, set: { accountLogin: login, accountType: installation.account?.type ?? "User" } });
}

// ---------------------------------------------------------------------------
// The GitHub account that posts
// ---------------------------------------------------------------------------

const GITHUB_AVATAR = "https://avatars.githubusercontent.com/u/9919?s=128&v=4";

/** The "GitHub" app account that subscriptions post as. Created the first time it's needed. */
export async function githubBotUser(env: Env, db: Db): Promise<typeof schema.users.$inferSelect> {
  const id = await getSetting(env.DB, BOT_SETTING);
  if (id) {
    const existing = await db.query.users.findFirst({ where: and(eq(schema.users.id, id), isNull(schema.users.deletedAt)) });
    if (existing) return existing;
  }
  const user = await createAppUser(db, { kind: "bot", name: "GitHub", image: (await proxiedImage(env, GITHUB_AVATAR)) ?? null });
  await setSetting(env.DB, BOT_SETTING, user.id);
  return user;
}

export async function isGitHubBot(env: Env, userId: string): Promise<boolean> {
  return (await getSetting(env.DB, BOT_SETTING)) === userId;
}

// ---------------------------------------------------------------------------
// People's own GitHub accounts, for buttons that act on GitHub
// ---------------------------------------------------------------------------

export async function exchangeOAuthCode(config: GitHubAppConfig, code: string, redirectUri: string, fetcher: Fetcher = fetch) {
  const res = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Chat-GitHub-App" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
}

/** A person's GitHub token, refreshed when it has expired. Null when not linked. */
export async function userGitHubToken(env: Env, db: Db, userId: string, fetcher: Fetcher = fetch): Promise<string | null> {
  const row = await db.query.githubAccounts.findFirst({ where: eq(schema.githubAccounts.userId, userId) });
  if (!row) return null;
  if (!row.expiresAt || row.expiresAt.getTime() > Date.now() + 60_000) return decryptSecret(env, row.accessToken);
  const config = await getGitHubApp(env);
  if (!config || !row.refreshToken) return null;
  const res = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Chat-GitHub-App" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: await decryptSecret(env, row.refreshToken) }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  await db
    .update(schema.githubAccounts)
    .set({
      accessToken: await encryptSecret(env, data.access_token),
      refreshToken: data.refresh_token ? await encryptSecret(env, data.refresh_token) : row.refreshToken,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    })
    .where(eq(schema.githubAccounts.userId, userId));
  return data.access_token;
}
