import { Hono } from "hono";
import { desc, eq, like, or } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { ApiError } from "../lib/errors";
import { schema } from "../db";
import { toUserSummary } from "../lib/serialize";
import { resetPasswordUrl } from "../auth/auth";
import { emailEnabled } from "../email";
import { parseBody } from "../lib/validate";
import { registrationPolicy, serverOwnerId, setRegistrationPolicy } from "../instance";
import { updateServerSettingsSchema } from "@shared/schemas";
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

serverRoutes.get("/", async (c) => {
  const body: ServerSettings = { registration: await registrationPolicy(c.env.DB), emailEnabled: emailEnabled(c.env) };
  return c.json(body);
});

serverRoutes.patch("/", async (c) => {
  const input = await parseBody(c, updateServerSettingsSchema);
  await setRegistrationPolicy(c.env.DB, input.registration);
  const body: ServerSettings = { registration: input.registration, emailEnabled: emailEnabled(c.env) };
  return c.json(body);
});

/** Every account on the server, newest first, filtered by name, username, or email. */
serverRoutes.get("/users", async (c) => {
  const db = c.get("db");
  const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 64);
  const pattern = `%${q}%`; // % and _ act as wildcards, which is fine for an owner-only search
  const rows = await db
    .select()
    .from(schema.users)
    .where(q ? or(like(schema.users.username, pattern), like(schema.users.displayName, pattern), like(schema.users.email, pattern)) : undefined)
    .orderBy(desc(schema.users.createdAt))
    .limit(25);
  const ownerId = await serverOwnerId(c.env.DB);
  const body: ServerUser[] = rows.map((u) => ({
    ...toUserSummary(u),
    email: u.email,
    createdAt: u.createdAt.toISOString(),
    isServerOwner: u.id === ownerId,
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

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}
