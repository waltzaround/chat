import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, schema, type Db } from "../db";
import { createAuth, type Auth } from "./auth";
import { appOrigin, authSecret } from "../instance";
import { ApiError } from "../lib/errors";

export type UserRow = typeof schema.users.$inferSelect;

export type AppVariables = {
  db: Db;
  auth: Auth;
  /** Public origin for links (APP_URL, or the origin this request came in on). */
  origin: string;
  user: UserRow;
  sessionId: string;
};

export type AppEnv = { Bindings: Env; Variables: AppVariables };

/** Attaches db + auth to every request. */
export const withServices: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = createDb(c.env.DB);
  const origin = appOrigin(c.env, c.req.raw);
  c.set("db", db);
  c.set("origin", origin);
  c.set("auth", createAuth(c.env, db, origin, await authSecret(c.env)));
  await next();
};

/**
 * Resolves the Better Auth session from the request cookies and loads the
 * full user row. Rejects with 401 when there is no valid session.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const result = await resolveSession(c.get("auth"), c.get("db"), c.req.raw.headers);
  if (!result) throw ApiError.unauthenticated();
  c.set("user", result.user);
  c.set("sessionId", result.sessionId);
  await next();
};

export async function resolveSession(
  auth: Auth,
  db: Db,
  headers: Headers,
): Promise<{ user: UserRow; sessionId: string } | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.user.id) });
  // Checked against the row, not the cached session cookie, so a suspension applies at once.
  if (!user || user.suspendedAt || user.deletedAt) return null;
  return { user, sessionId: session.session.id };
}
