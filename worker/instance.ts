import type { Env } from "./env";

/**
 * Zero-config defaults so a fresh deploy works without any vars or secrets.
 * Setting APP_URL or BETTER_AUTH_SECRET explicitly still takes precedence.
 */

const AUTH_SECRET_PLACEHOLDERS = new Set(["", "change-me", "change-me-to-a-long-random-string"]);

/** Public origin: APP_URL when set, otherwise the origin the request arrived on. */
export function appOrigin(env: Env, request: Request): string {
  const configured = env.APP_URL?.trim();
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

const generatedSecrets = new WeakMap<object, Promise<string>>();

/**
 * BETTER_AUTH_SECRET when set. Otherwise a random secret generated on first use
 * and kept in D1, so every isolate and every deploy signs sessions with the same key.
 */
export function authSecret(env: Env): Promise<string> {
  const configured = env.BETTER_AUTH_SECRET?.trim();
  if (configured && !AUTH_SECRET_PLACEHOLDERS.has(configured)) return Promise.resolve(configured);
  let pending = generatedSecrets.get(env);
  if (!pending) {
    pending = loadOrCreateSetting(env.DB, "auth_secret", randomSecret);
    generatedSecrets.set(env, pending);
    pending.catch(() => generatedSecrets.delete(env));
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Server owner and sign-up policy
// ---------------------------------------------------------------------------

export type { RegistrationPolicy, WorkspaceCreationPolicy } from "@shared/types";
import type { RegistrationPolicy, WorkspaceCreationPolicy } from "@shared/types";

/** The account that set this server up. Null until someone signs up. */
export function serverOwnerId(db: D1Database): Promise<string | null> {
  return getSetting(db, "owner_user_id");
}

/**
 * Makes `userId` the owner if nobody is yet. The first owner starts the server
 * invite-only, so strangers who find the URL cannot sign up.
 */
export async function claimOwnership(db: D1Database, userId: string): Promise<boolean> {
  const result = await db.prepare("INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('owner_user_id', ?)").bind(userId).run();
  if (!result.meta.changes) return false;
  await db.prepare("INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('registration', 'invite')").run();
  return true;
}

/** Unset means "open": that is how deployments behaved before the setting existed. */
export async function registrationPolicy(db: D1Database): Promise<RegistrationPolicy> {
  return (await getSetting(db, "registration")) === "invite" ? "invite" : "open";
}

export async function setRegistrationPolicy(db: D1Database, policy: RegistrationPolicy): Promise<void> {
  await setSetting(db, "registration", policy);
}

/** Unset means "everyone", as before the setting existed. */
export async function workspaceCreationPolicy(db: D1Database): Promise<WorkspaceCreationPolicy> {
  return (await getSetting(db, "workspace_creation")) === "owner" ? "owner" : "everyone";
}

export async function setWorkspaceCreationPolicy(db: D1Database, policy: WorkspaceCreationPolicy): Promise<void> {
  await setSetting(db, "workspace_creation", policy);
}

/**
 * When set, accounts created after this time (ms) must verify their email before
 * they can sign in. Older accounts are unaffected, so turning it on locks nobody out.
 */
export async function verifiedEmailRequiredSince(db: D1Database): Promise<number | null> {
  const value = await getSetting(db, "require_verified_email_since");
  return value ? Number(value) : null;
}

export async function setVerifiedEmailRequired(db: D1Database, required: boolean): Promise<void> {
  if (required) await db.prepare("INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('require_verified_email_since', ?)").bind(String(Date.now())).run();
  else await db.prepare("DELETE FROM instance_settings WHERE key = 'require_verified_email_since'").run();
}

export async function canCreateWorkspace(db: D1Database, userId: string): Promise<boolean> {
  if ((await workspaceCreationPolicy(db)) === "everyone") return true;
  return (await serverOwnerId(db)) === userId;
}

/** Cookies the sign-up page sets so the check also covers Google/GitHub sign-up. */
export const CLAIM_COOKIE = "chat_claim";
export const INVITE_COOKIE = "chat_invite";

/**
 * Who may create an account:
 * - before an owner exists, anyone, unless OWNER_CLAIM_TOKEN is set (npm run setup
 *   sets it and prints a claim link), in which case only the holder of that link;
 * - afterwards, anyone on an open server, or people with a working invite link.
 */
export async function assertMayRegister(env: Env, headers: Headers | undefined): Promise<void> {
  const cookies = parseCookies(headers?.get("cookie"));
  if (!(await serverOwnerId(env.DB))) {
    const token = env.OWNER_CLAIM_TOKEN?.trim();
    if (token && !safeEqual(cookies[CLAIM_COOKIE] ?? "", token)) throw new RegistrationError("claim_required");
    return;
  }
  if ((await registrationPolicy(env.DB)) === "open") return;
  const code = cookies[INVITE_COOKIE];
  if (!code || !(await isUsableInvite(env.DB, code))) throw new RegistrationError("invite_required");
}

export class RegistrationError extends Error {
  constructor(readonly reason: "claim_required" | "invite_required") {
    super(
      reason === "claim_required"
        ? "This server is still being set up. Use the setup link from npm run setup to create the owner account."
        : "This server is invite-only. Ask a member for an invite link.",
    );
  }
}

async function isUsableInvite(db: D1Database, code: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT expires_at, max_uses, uses, revoked_at FROM invites WHERE code = ?")
    .bind(code)
    .first<{ expires_at: number | null; max_uses: number | null; uses: number; revoked_at: number | null }>();
  if (!row || row.revoked_at) return false;
  if (row.expires_at && row.expires_at <= Date.now()) return false;
  return !(row.max_uses && row.uses >= row.max_uses);
}

function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < right.length; i++) diff |= (left[i] ?? 0) ^ right[i]!;
  return diff === 0;
}

/** How the server presents itself before sign-in: login screens and the apps' server picker. */
export interface ServerProfile {
  name: string | null;
  description: string | null;
  iconKey: string | null;
}

export async function serverProfile(db: D1Database): Promise<ServerProfile> {
  const { results } = await db
    .prepare("SELECT key, value FROM instance_settings WHERE key IN ('server_name', 'server_description', 'server_icon_key')")
    .all<{ key: string; value: string }>();
  const get = (k: string) => results.find((r) => r.key === k)?.value || null;
  return { name: get("server_name"), description: get("server_description"), iconKey: get("server_icon_key") };
}

/** null clears a field; undefined leaves it. */
export async function setServerProfile(db: D1Database, input: { name?: string | null; description?: string | null; iconKey?: string | null }): Promise<void> {
  const fields: Array<[string, string | null | undefined]> = [
    ["server_name", input.name],
    ["server_description", input.description],
    ["server_icon_key", input.iconKey],
  ];
  for (const [key, value] of fields) {
    if (value === undefined) continue;
    if (value === null || value === "") await db.prepare("DELETE FROM instance_settings WHERE key = ?").bind(key).run();
    else await setSetting(db, key, value);
  }
}

/** Public URL for the icon; the key in the query busts caches when it changes. */
export function serverIconUrl(profile: ServerProfile): string | null {
  return profile.iconKey ? `/api/instance/icon?v=${encodeURIComponent(profile.iconKey.split("/").pop() ?? "")}` : null;
}

async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare("INSERT INTO instance_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM instance_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function loadOrCreateSetting(db: D1Database, key: string, create: () => string): Promise<string> {
  // INSERT OR IGNORE keeps the first writer's value if two isolates race.
  await db.prepare("INSERT OR IGNORE INTO instance_settings (key, value) VALUES (?, ?)").bind(key, create()).run();
  const row = await db.prepare("SELECT value FROM instance_settings WHERE key = ?").bind(key).first<{ value: string }>();
  if (!row) throw new Error(`instance_settings.${key} is missing after insert`);
  return row.value;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}
