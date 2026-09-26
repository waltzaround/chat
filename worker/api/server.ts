import { Hono } from "hono";
import { and, desc, eq, isNull, like, or } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { ApiError } from "../lib/errors";
import { schema } from "../db";
import { toUserSummary } from "../lib/serialize";
import { resetPasswordUrl } from "../auth/auth";
import { emailEnabled } from "../email";
import { parseBody } from "../lib/validate";
import { registrationPolicy, serverOwnerId, setRegistrationPolicy, setWorkspaceCreationPolicy, workspaceCreationPolicy } from "../instance";
import { hubFor } from "../lib/hub";
import { userHub } from "../lib/notify";
import { WS_CLOSE } from "@shared/events";
import { deleteServerUserSchema, updateServerSettingsSchema } from "@shared/schemas";
import { deleteAccount } from "../lib/accounts";
import type { PasswordResetLink, ServerSettings, ServerUser } from "@shared/types";

/** Owner-issued links last longer than emailed ones: they travel by chat or text message. */
const RESET_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** Settings for the whole deployment. Only the server owner can read or change them. */
export const serverRoutes = new Hono<AppEnv>();

serverRoutes.use("*", requireUser);
serverRoutes.use("*", async (c, next) => {
  if ((await serverOwnerId(c.env.DB)) !== c.get("user").id) throw ApiError.forbidden("Only the server owner can change server settings");
  await next();
});

async function settings(env: AppEnv["Bindings"]): Promise<ServerSettings> {
  const [registration, workspaceCreation] = await Promise.all([registrationPolicy(env.DB), workspaceCreationPolicy(env.DB)]);
  return { registration, workspaceCreation, emailEnabled: emailEnabled(env) };
}

serverRoutes.get("/", async (c) => c.json(await settings(c.env)));

serverRoutes.patch("/", async (c) => {
  const input = await parseBody(c, updateServerSettingsSchema);
  if (input.registration) await setRegistrationPolicy(c.env.DB, input.registration);
  if (input.workspaceCreation) await setWorkspaceCreationPolicy(c.env.DB, input.workspaceCreation);
  return c.json(await settings(c.env));
});

/** Every account on the server, newest first, filtered by name, username, or email. */
serverRoutes.get("/users", async (c) => {
  const db = c.get("db");
  const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 64);
  const pattern = `%${q}%`; // % and _ act as wildcards, which is fine for an owner-only search
  const rows = await db
    .select()
    .from(schema.users)
    .where(and(isNull(schema.users.deletedAt), q ? or(like(schema.users.username, pattern), like(schema.users.displayName, pattern), like(schema.users.email, pattern)) : undefined))
    .orderBy(desc(schema.users.createdAt))
    .limit(25);
  const ownerId = await serverOwnerId(c.env.DB);
  const body: ServerUser[] = rows.map((u) => ({
    ...toUserSummary(u),
    email: u.email,
    createdAt: u.createdAt.toISOString(),
    isServerOwner: u.id === ownerId,
    suspended: !!u.suspendedAt,
  }));
  return c.json(body);
});

/**
 * A one-time link to set a new password for any account. This is how people recover
 * access when the server has no email (email needs the Workers Paid plan).
 */
serverRoutes.post("/users/:userId/password-reset", async (c) => {
  const db = c.get("db");
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, c.req.param("userId")) });
  if (!user) throw ApiError.notFound("User");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + RESET_LINK_TTL_MS);
  // Same record Better Auth writes for emailed resets, so its reset endpoint accepts it.
  const ctx = await c.get("auth").$context;
  await ctx.internalAdapter.createVerificationValue({ identifier: `reset-password:${token}`, value: user.id, expiresAt });
  const body: PasswordResetLink = { url: resetPasswordUrl(c.get("origin"), token), expiresAt: expiresAt.toISOString() };
  return c.json(body, 201);
});

/**
 * Suspend: the account cannot sign in, its sessions end, and its open connections close.
 * Its messages and memberships stay, so unsuspending restores everything.
 */
serverRoutes.post("/users/:userId/suspension", async (c) => {
  const db = c.get("db");
  const userId = c.req.param("userId");
  if (userId === c.get("user").id) throw ApiError.validation(undefined, "You cannot suspend your own account");
  const [updated] = await db.update(schema.users).set({ suspendedAt: new Date() }).where(eq(schema.users.id, userId)).returning({ id: schema.users.id });
  if (!updated) throw ApiError.notFound("User");
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  const memberships = await db
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.userId, userId), eq(schema.workspaceMembers.status, "active")));
  await Promise.all([
    ...memberships.map((m) => hubFor(c.env, m.workspaceId).disconnectUser(userId, "suspended").catch((err) => console.error("disconnect failed", err))),
    userHub(c.env, userId).disconnect(WS_CLOSE.UNAUTHENTICATED, "suspended").catch((err) => console.error("disconnect failed", err)),
  ]);
  return c.body(null, 204);
});

serverRoutes.delete("/users/:userId/suspension", async (c) => {
  const db = c.get("db");
  const [updated] = await db.update(schema.users).set({ suspendedAt: null }).where(eq(schema.users.id, c.req.param("userId"))).returning({ id: schema.users.id });
  if (!updated) throw ApiError.notFound("User");
  return c.body(null, 204);
});

/** Delete another account, optionally with all its messages. */
serverRoutes.delete("/users/:userId", async (c) => {
  const userId = c.req.param("userId");
  if (userId === c.get("user").id) throw ApiError.validation(undefined, "Delete your own account from your profile settings");
  const target = await c.get("db").query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!target || target.deletedAt) throw ApiError.notFound("User");
  const input = await parseBody(c, deleteServerUserSchema);
  await deleteAccount(c.env, c.get("db"), userId, { deleteMessages: input.deleteMessages });
  return c.body(null, 204);
});

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}
