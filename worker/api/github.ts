/**
 * GitHub: the server's own GitHub App (created by the owner), its deliveries, channel
 * subscriptions, and people linking their GitHub accounts for buttons.
 */
import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { GitHubAccountLink, GitHubAppStatus, GitHubFeature } from "@shared/types";
import { idSchema } from "@shared/schemas";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { audit } from "../lib/audit";
import { deleteSetting, getSetting, serverOwnerId, setSetting } from "../instance";
import { encryptSecret, hmacSha256Hex, randomToken, timingSafeEqual } from "../lib/crypto";
import { Permission, hasPermission, loadChannelAccess, requireMember, requirePermission } from "../permissions/resolve";
import {
  appJwt,
  appManifest,
  defaultAppName,
  exchangeOAuthCode,
  forgetGitHubApp,
  getGitHubApp,
  githubApi,
  githubBotUser,
  recordInstallation,
  saveGitHubApp,
} from "../integrations/github-app";
import { GITHUB_FEATURES } from "../integrations/github-format";
import { SubscriptionError, listSubscriptions, parseRepo, routeGitHubAppEvent, subscribe, toSubscription } from "../integrations/github-subscriptions";

const MANIFEST_STATE = "github_manifest_state";
const STATE_TTL_MS = 30 * 60_000;
const ACCOUNT_STATE_COOKIE = "chat_gh_state";

export const githubRoutes = new Hono<AppEnv>();

async function requireOwner(c: Context<AppEnv>): Promise<void> {
  if ((await serverOwnerId(c.env.DB)) !== c.get("user").id) throw ApiError.forbidden("Only the server owner can set up GitHub");
}

/** A small page of our own, for the steps that leave for github.com. */
function page(c: Context<AppEnv>, title: string, body: string, nonce?: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0b0d;color:#e7e7ea}main{max-width:26rem;padding:1.5rem}button,a{font:inherit}button{background:#e7e7ea;color:#18181b;border:0;border-radius:6px;padding:.5rem 1rem;cursor:pointer}a{color:inherit}@media(prefers-color-scheme:light){body{background:#e7e7ea;color:#0f0f12}button{background:#18181b;color:#fafafa}}</style>
</head><body><main>${body}</main></body></html>`;
  return c.html(html, 200, {
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; ${nonce ? `script-src 'nonce-${nonce}';` : ""} form-action https://github.com; base-uri 'none'; frame-ancestors 'none'`,
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

githubRoutes.get("/status", requireUser, async (c) => {
  const config = await getGitHubApp(c.env);
  const installations = config ? await c.get("db").select().from(schema.githubInstallations) : [];
  const body: GitHubAppStatus = {
    configured: !!config,
    name: config?.name ?? null,
    slug: config?.slug ?? null,
    htmlUrl: config?.htmlUrl ?? null,
    installUrl: config ? `https://github.com/apps/${config.slug}/installations/new` : null,
    installations: installations.map((i) => ({ id: i.id, account: i.accountLogin, type: i.accountType })),
  };
  return c.json(body);
});

// ---------------------------------------------------------------------------
// Creating the app (server owner) with GitHub's manifest flow
// ---------------------------------------------------------------------------

githubRoutes.get("/app/new", requireUser, async (c) => {
  await requireOwner(c);
  const org = c.req.query("org")?.trim();
  if (org && !/^[\w.-]{1,39}$/.test(org)) throw ApiError.validation(undefined, "That isn't a GitHub organisation name");
  const state = randomToken(24);
  await setSetting(c.env.DB, MANIFEST_STATE, `${state}:${Date.now() + STATE_TTL_MS}`);
  const origin = c.get("origin");
  const manifest = appManifest(origin, c.req.query("name")?.trim().slice(0, 34) || defaultAppName(origin));
  const action = org ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${state}` : `https://github.com/settings/apps/new?state=${state}`;
  const nonce = randomToken(12);
  return page(
    c,
    "Create the GitHub App",
    `<h1 style="font-size:1.1rem">Creating this server's GitHub App</h1>
<p>GitHub will ask you to confirm. Then you'll come back here.</p>
<form id="f" method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"><button type="submit">Continue to GitHub</button></form>
<script nonce="${nonce}">document.getElementById("f").submit()</script>`,
    nonce,
  );
});

githubRoutes.get("/app/created", requireUser, async (c) => {
  await requireOwner(c);
  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  const stored = await getSetting(c.env.DB, MANIFEST_STATE);
  const [expected, expires] = (stored ?? "").split(":");
  if (!code || !expected || !timingSafeEqual(expected, state) || Number(expires) < Date.now()) {
    return page(c, "GitHub setup expired", `<p>That GitHub setup link has expired. Start again from Server settings.</p><p><a href="/settings/server">Back to settings</a></p>`);
  }
  await deleteSetting(c.env.DB, MANIFEST_STATE);
  const res = await githubApi<{ id: number; slug: string; name: string; html_url: string; client_id: string; client_secret: string; pem: string; webhook_secret: string }>(`/app-manifests/${encodeURIComponent(code)}/conversions`, { method: "POST" });
  if (!res.ok || !res.data?.pem) return page(c, "GitHub setup failed", `<p>GitHub didn't finish creating the app (error ${res.status}). Try again from Server settings.</p><p><a href="/settings/server">Back to settings</a></p>`);
  const app = res.data;
  await saveGitHubApp(c.env, { appId: app.id, slug: app.slug, name: app.name, htmlUrl: app.html_url, clientId: app.client_id, clientSecret: app.client_secret, privateKey: app.pem, webhookSecret: app.webhook_secret });
  await githubBotUser(c.env, c.get("db"));
  return c.redirect("/settings/server?github=created");
});

/** GitHub sends people here after they install the app on an account. */
githubRoutes.get("/app/installed", async (c) => {
  const id = Number(c.req.query("installation_id"));
  const config = await getGitHubApp(c.env);
  if (config && Number.isInteger(id) && id > 0) {
    // Ask GitHub rather than trusting the query string.
    const res = await githubApi<{ id: number; account: { login: string; type: string } }>(`/app/installations/${id}`, { token: await appJwt(config) });
    if (res.ok) await recordInstallation(c.get("db"), res.data);
  }
  return c.redirect("/settings/server?github=installed");
});

githubRoutes.delete("/app", requireUser, async (c) => {
  await requireOwner(c);
  await forgetGitHubApp(c.env, c.get("db"));
  return c.body(null, 204);
});

/** Deliveries for every repository the app is installed on. */
githubRoutes.post("/app/webhook", async (c) => {
  const config = await getGitHubApp(c.env);
  if (!config) return c.json({ message: "GitHub isn't set up on this server" }, 404);
  const raw = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? "";
  if (!signature || !timingSafeEqual(signature, `sha256=${await hmacSha256Hex(config.webhookSecret, raw)}`)) return c.json({ message: "Bad signature" }, 401);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return c.json({ message: "Body must be JSON" }, 400);
  }
  const event = c.req.header("x-github-event") ?? "";
  const db = c.get("db");
  if (event === "installation") {
    const installation = payload.installation as { id: number; account?: { login?: string; type?: string } };
    if (payload.action === "deleted") await db.delete(schema.githubInstallations).where(eq(schema.githubInstallations.id, installation.id));
    else await recordInstallation(db, installation);
    return c.body(null, 204);
  }
  const posted = await routeGitHubAppEvent(c.env, db, event, payload, c.req.header("x-github-delivery") ?? crypto.randomUUID());
  return c.json({ posted });
});

// ---------------------------------------------------------------------------
// People's GitHub accounts
// ---------------------------------------------------------------------------

githubRoutes.get("/account", requireUser, async (c) => {
  const row = await c.get("db").query.githubAccounts.findFirst({ where: eq(schema.githubAccounts.userId, c.get("user").id) });
  const body: GitHubAccountLink = { available: !!(await getGitHubApp(c.env)), login: row?.githubLogin ?? null };
  return c.json(body);
});

githubRoutes.get("/account/connect", requireUser, async (c) => {
  const config = await getGitHubApp(c.env);
  if (!config) throw ApiError.notConfigured("GitHub");
  const state = randomToken(24);
  setCookie(c, ACCOUNT_STATE_COOKIE, state, { path: "/api/github/account", httpOnly: true, sameSite: "Lax", secure: c.get("origin").startsWith("https:"), maxAge: 600 });
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${c.get("origin")}/api/github/account/callback`, state });
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

githubRoutes.get("/account/callback", requireUser, async (c) => {
  const config = await getGitHubApp(c.env);
  const state = c.req.query("state") ?? "";
  const expected = getCookie(c, ACCOUNT_STATE_COOKIE) ?? "";
  deleteCookie(c, ACCOUNT_STATE_COOKIE, { path: "/api/github/account" });
  if (!config || !expected || !timingSafeEqual(expected, state)) return c.redirect("/settings/profile?github=failed");
  const tokens = await exchangeOAuthCode(config, c.req.query("code") ?? "", `${c.get("origin")}/api/github/account/callback`);
  if (!tokens.access_token) return c.redirect("/settings/profile?github=failed");
  const me = await githubApi<{ login: string }>("/user", { token: tokens.access_token });
  if (!me.ok || !me.data?.login) return c.redirect("/settings/profile?github=failed");
  const values = {
    githubLogin: me.data.login,
    accessToken: await encryptSecret(c.env, tokens.access_token),
    refreshToken: tokens.refresh_token ? await encryptSecret(c.env, tokens.refresh_token) : null,
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
  };
  await c
    .get("db")
    .insert(schema.githubAccounts)
    .values({ userId: c.get("user").id, createdAt: new Date(), ...values })
    .onConflictDoUpdate({ target: schema.githubAccounts.userId, set: values });
  return c.redirect("/settings/profile?github=linked");
});

githubRoutes.delete("/account", requireUser, async (c) => {
  await c.get("db").delete(schema.githubAccounts).where(eq(schema.githubAccounts.userId, c.get("user").id));
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Channel subscriptions (workspace settings)
// ---------------------------------------------------------------------------

export const githubSubscriptionRoutes = new Hono<AppEnv>();
githubSubscriptionRoutes.use("*", requireUser);

const featuresSchema = z.array(z.enum(GITHUB_FEATURES as [GitHubFeature, ...GitHubFeature[]])).min(1);

githubSubscriptionRoutes.get("/:workspaceId/github/subscriptions", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_INTEGRATIONS, "Manage integrations");
  return c.json(await listSubscriptions(db, ctx.workspaceId));
});

githubSubscriptionRoutes.post("/:workspaceId/github/subscriptions", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const ctx = await requireMember(db, c.req.param("workspaceId"), user.id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_INTEGRATIONS, "Manage integrations");
  const input = await parseBody(c, z.object({ channelId: idSchema, repo: z.string().min(3).max(200), events: featuresSchema }));
  const repo = parseRepo(input.repo);
  if (!repo) throw ApiError.validation(undefined, "Name the repository as owner/repo");
  const access = await loadChannelAccess(db, input.channelId, user.id);
  if (!access || access.channel.workspaceId !== ctx.workspaceId || !hasPermission(access.permissions, Permission.VIEW_CHANNEL)) throw ApiError.notFound("Channel");
  if (access.channel.kind !== "text") throw ApiError.validation(undefined, "GitHub posts into text channels");
  try {
    const row = await subscribe(c.env, db, { workspaceId: ctx.workspaceId, channelId: access.channel.id, repo, events: input.events, userId: user.id });
    return c.json(toSubscription(row, null), 201);
  } catch (err) {
    if (err instanceof SubscriptionError) throw ApiError.validation(undefined, err.message);
    throw err;
  }
});

async function managedSubscription(c: Context<AppEnv>) {
  const db = c.get("db");
  const row = await db.query.githubSubscriptions.findFirst({ where: and(eq(schema.githubSubscriptions.id, c.req.param("subscriptionId")!), eq(schema.githubSubscriptions.workspaceId, c.req.param("workspaceId")!)) });
  if (!row) throw ApiError.notFound("Subscription");
  const ctx = await requireMember(db, row.workspaceId, c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_INTEGRATIONS, "Manage integrations");
  return row;
}

githubSubscriptionRoutes.patch("/:workspaceId/github/subscriptions/:subscriptionId", async (c) => {
  const db = c.get("db");
  const row = await managedSubscription(c);
  const { events } = await parseBody(c, z.object({ events: featuresSchema }));
  const joined = [...new Set(events)].filter((f) => f !== "stars").join(",");
  await db.update(schema.githubSubscriptions).set({ events: joined }).where(eq(schema.githubSubscriptions.id, row.id));
  await audit(db, { workspaceId: row.workspaceId, actorUserId: c.get("user").id, action: "github.updated", targetType: "channel", targetId: row.channelId, details: { repo: row.repo, events: joined } });
  return c.json(toSubscription({ ...row, events: joined }, null));
});

githubSubscriptionRoutes.delete("/:workspaceId/github/subscriptions/:subscriptionId", async (c) => {
  const db = c.get("db");
  const row = await managedSubscription(c);
  await db.delete(schema.githubSubscriptions).where(eq(schema.githubSubscriptions.id, row.id));
  await audit(db, { workspaceId: row.workspaceId, actorUserId: c.get("user").id, action: "github.unsubscribed", targetType: "channel", targetId: row.channelId, details: { repo: row.repo } });
  return c.body(null, 204);
});
