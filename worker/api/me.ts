import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { toCurrentUser, toUserSummary, toWorkspaceSummary } from "../lib/serialize";
import { notifyWorkspace } from "../lib/hub";
import { canCreateWorkspace, registrationPolicy, serverIconUrl, serverOwnerId, serverPolicies, serverProfile, verifiedEmailRequiredSince } from "../instance";
import { DEFAULT_PRIVACY, DEFAULT_TERMS, fillPolicy } from "@shared/policies";
import type { ServerBranding, ServerPolicies } from "@shared/types";

import { emailEnabled } from "../email";
import { deleteAccountSchema, updateMeSchema } from "@shared/schemas";
import { deleteAccount, exportAccount } from "../lib/accounts";
import { unreadMentionCounts } from "../lib/mentions";
import { checkRateLimit } from "../security/ratelimit";
import type { AuthConfig, InstanceInfo, WorkspaceSummary } from "@shared/types";
import { API_VERSION, APP_VERSION } from "@shared/version";
import { realtimekitConfigured } from "../realtimekit/client";
import { createLinkedSession, LINKED_SCOPE } from "../auth/linked";
import { z } from "zod";

const linkSchema = z.object({
  /** The web origin that will hold the session, or "desktop" for the desktop app. */
  linkedTo: z.union([z.literal("desktop"), z.string().url().max(200).refine((v) => /^https?:\/\//.test(v), "Must be a web address")]),
});

export const meRoutes = new Hono<AppEnv>();

/** The owner's name, description and icon for this server, shown before sign-in. */
async function branding(db: D1Database): Promise<ServerBranding> {
  const profile = await serverProfile(db);
  return { name: profile.name, description: profile.description, iconUrl: serverIconUrl(profile) };
}

/** Public: identifies this server to native apps before they sign in. */
meRoutes.get("/instance", async (c) => {
  const [registration, owner] = await Promise.all([registrationPolicy(c.env.DB), serverOwnerId(c.env.DB)]);
  const body: InstanceInfo = {
    server: await branding(c.env.DB),
    software: "chat",
    version: APP_VERSION,
    apiVersion: API_VERSION,
    registration,
    signUp: {
      open: registration === "open" && !!owner,
      challenge: !!(c.env.TURNSTILE_SECRET_KEY && c.env.TURNSTILE_SITE_KEY),
      requireVerifiedEmail: emailEnabled(c.env) && (await verifiedEmailRequiredSince(c.env.DB)) !== null,
    },
    features: {
      voice: realtimekitConfigured(c.env),
      passwordResetEmail: emailEnabled(c.env),
      googleSignIn: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      githubSignIn: !!(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET),
    },
  };
  return c.json(body);
});

/**
 * Public: the privacy policy and terms (the /privacy and /terms pages, and the app
 * stores' required links). The owner's own text, or the template filled in.
 */
meRoutes.get("/policies", async (c) => {
  const [custom, profile, ownerId] = await Promise.all([serverPolicies(c.env.DB), serverProfile(c.env.DB), serverOwnerId(c.env.DB)]);
  const owner = ownerId ? await c.env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(ownerId).first<{ display_name: string }>() : null;
  const vars = { server: profile.name ?? new URL(c.get("origin")).host, owner: owner?.display_name ?? "the server owner" };
  const body: ServerPolicies = {
    privacyPolicy: fillPolicy(custom.privacyPolicy ?? DEFAULT_PRIVACY, vars),
    terms: fillPolicy(custom.terms ?? DEFAULT_TERMS, vars),
    customPrivacy: custom.privacyPolicy !== null,
    customTerms: custom.terms !== null,
  };
  return c.json(body);
});

/** Public: the server's icon, for login screens before anyone signs in. */
meRoutes.get("/instance/icon", async (c) => {
  const { iconKey } = await serverProfile(c.env.DB);
  const object = iconKey ? await c.env.UPLOADS.get(iconKey) : null;
  if (!object) return c.json({ error: { code: "not_found", message: "No server icon" } }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.get("Content-Type")?.startsWith("image/")) headers.set("Content-Type", "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  return new Response(object.body, { headers });
});

/** Public: which auth providers are available, the Turnstile site key, and whether this is a fresh deployment. */
meRoutes.get("/auth-config", async (c) => {
  const [owner, registration] = await Promise.all([serverOwnerId(c.env.DB), registrationPolicy(c.env.DB)]);
  const body: AuthConfig = {
    server: await branding(c.env.DB),
    providers: {
      github: !!(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET),
      google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    },
    turnstileSiteKey: c.env.TURNSTILE_SECRET_KEY ? c.env.TURNSTILE_SITE_KEY ?? null : null,
    firstRun: !owner,
    claimRequired: !owner && !!c.env.OWNER_CLAIM_TOKEN?.trim(),
    registration,
    passwordResetEmail: emailEnabled(c.env),
    requireVerifiedEmail: emailEnabled(c.env) && (await verifiedEmailRequiredSince(c.env.DB)) !== null,
  };
  return c.json(body);
});

meRoutes.use("/me", requireUser);
meRoutes.use("/me/*", requireUser);

/** Server-wide facts about the signed-in account. */
async function serverContext(db: D1Database, userId: string) {
  const [ownerId, canCreate, password] = await Promise.all([serverOwnerId(db), canCreateWorkspace(db, userId), credentialAccount(db, userId)]);
  return { ownerId, canCreateWorkspace: canCreate, hasPassword: !!password };
}

function credentialAccount(db: D1Database, userId: string) {
  return db.prepare("SELECT password FROM accounts WHERE user_id = ? AND provider_id = 'credential' AND password IS NOT NULL").bind(userId).first<{ password: string }>();
}

/**
 * Links this account to another place that shows it in a server rail: another Chat
 * server's web app (via the /link page) or the desktop app. Only callable by this
 * server's own pages with a full session, so a linked session can't mint more.
 */
meRoutes.post("/me/linked-sessions", async (c) => {
  if (c.get("sessionScope") === LINKED_SCOPE) throw ApiError.forbidden();
  if (c.req.header("origin") !== c.get("origin")) throw ApiError.forbidden("Link servers from this server's own pages.");
  checkRateLimit(`link:${c.get("user").id}`, 10, 60_000);
  const { linkedTo } = await parseBody(c, linkSchema);
  const label = linkedTo === "desktop" ? "Chat desktop app (server list)" : `Linked to ${new URL(linkedTo).host}`;
  const token = await createLinkedSession(c.get("auth"), c.get("user").id, label);
  return c.json({ token }, 201);
});

/** Unlinking: the other server revokes the linked session it holds. */
meRoutes.delete("/me/linked-session", async (c) => {
  if (c.get("sessionScope") !== LINKED_SCOPE) throw ApiError.forbidden();
  await c.get("db").delete(schema.sessions).where(eq(schema.sessions.id, c.get("sessionId")));
  return c.body(null, 204);
});

/** People you've blocked. */
meRoutes.get("/me/blocks", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({ user: schema.users })
    .from(schema.userBlocks)
    .innerJoin(schema.users, eq(schema.users.id, schema.userBlocks.blockedUserId))
    .where(eq(schema.userBlocks.blockerUserId, c.get("user").id));
  return c.json(rows.map((r) => toUserSummary(r.user)));
});

meRoutes.put("/me/blocks/:userId", async (c) => {
  const me = c.get("user").id;
  const userId = c.req.param("userId");
  if (userId === me) throw ApiError.validation(undefined, "You can't block yourself");
  const target = await c.get("db").query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!target) throw ApiError.notFound("User");
  await c.get("db").insert(schema.userBlocks).values({ blockerUserId: me, blockedUserId: userId, createdAt: new Date() }).onConflictDoNothing();
  await refreshDm(c.env, c.get("db"), me, userId);
  return c.body(null, 204);
});

meRoutes.delete("/me/blocks/:userId", async (c) => {
  const me = c.get("user").id;
  const userId = c.req.param("userId");
  await c.get("db").delete(schema.userBlocks).where(and(eq(schema.userBlocks.blockerUserId, me), eq(schema.userBlocks.blockedUserId, userId)));
  await refreshDm(c.env, c.get("db"), me, userId);
  return c.body(null, 204);
});

/** Their DM's permissions just changed: drop the hub's cache and refresh both clients. */
async function refreshDm(env: AppEnv["Bindings"], db: AppEnv["Variables"]["db"], a: string, b: string) {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  const pair = await db.query.dmPairs.findFirst({ where: and(eq(schema.dmPairs.userA, userA), eq(schema.dmPairs.userB, userB)) });
  if (pair) await notifyWorkspace(env, pair.workspaceId, { type: "workspace.updated", reason: "members" });
}

/** Delete your own account. Asks for your username, and your password if you have one. */
meRoutes.delete("/me", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, deleteAccountSchema);
  if (input.confirmUsername.toLowerCase() !== user.username.toLowerCase()) throw ApiError.validation(undefined, "Type your username to confirm");
  const credential = await credentialAccount(c.env.DB, user.id);
  if (credential) {
    const ctx = await c.get("auth").$context;
    if (!input.password || !(await ctx.password.verify({ hash: credential.password, password: input.password }))) {
      throw ApiError.validation(undefined, "That password is wrong");
    }
  }
  await deleteAccount(c.env, c.get("db"), user.id, { deleteMessages: input.deleteMessages });
  return c.body(null, 204);
});

/** Download everything the server holds about you, as JSON. */
meRoutes.get("/me/export", (c) => {
  const user = c.get("user");
  checkRateLimit(`export:${user.id}`, 3, 60 * 60 * 1000);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(exportAccount(c.get("db"), user.id), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="chat-export-${user.username}-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
});

meRoutes.get("/me", async (c) => c.json(toCurrentUser(c.get("user"), await serverContext(c.env.DB, c.get("user").id))));

meRoutes.patch("/me", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const input = await parseBody(c, updateMeSchema);

  if (input.username && input.username !== user.username) {
    const taken = await db.query.users.findFirst({ where: eq(schema.users.username, input.username) });
    if (taken) throw ApiError.conflict("That username is taken");
  }
  if (input.avatarKey && !input.avatarKey.startsWith(`avatars/${user.id}/`)) {
    throw ApiError.forbidden("Avatar key does not belong to you");
  }

  const [updated] = await db
    .update(schema.users)
    .set({
      displayName: input.displayName ?? user.displayName,
      username: input.username ?? user.username,
      bio: input.bio === undefined ? user.bio : input.bio,
      status: input.status ?? user.status,
      avatarKey: input.avatarKey === undefined ? user.avatarKey : input.avatarKey,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id))
    .returning();
  return c.json(toCurrentUser(updated!, await serverContext(c.env.DB, updated!.id)));
});

meRoutes.get("/me/workspaces", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const rows = await db
    .select({
      workspace: schema.workspaces,
      memberCount: sql<number>`(select count(*) from ${schema.workspaceMembers} wm where wm.workspace_id = ${schema.workspaces.id} and wm.status = 'active')`,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(and(eq(schema.workspaceMembers.userId, user.id), eq(schema.workspaceMembers.status, "active"), eq(schema.workspaces.kind, "community")))
    .orderBy(schema.workspaceMembers.joinedAt);
  const mentions = await unreadMentionCounts(c.get("db"), user.id, "workspace");
  const body: WorkspaceSummary[] = rows.map((r) => toWorkspaceSummary(r.workspace, Number(r.memberCount), mentions.get(r.workspace.id) ?? 0));
  return c.json(body);
});
