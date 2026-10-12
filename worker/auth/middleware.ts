import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, schema, type Db } from "../db";
import { createAuth, type Auth } from "./auth";
import { appOrigin, authSecret } from "../instance";
import { ApiError } from "../lib/errors";
import { LINKED_SCOPE, linkedSessionMayCall } from "./linked";
import { BOT_SCOPE, botMayCall, resolveBotToken } from "./bots";
import { checkRateLimit } from "../security/ratelimit";

export type UserRow = typeof schema.users.$inferSelect;

export type AppVariables = {
  db: Db;
  auth: Auth;
  /** Public origin for links (APP_URL, or the origin this request came in on). */
  origin: string;
  user: UserRow;
  sessionId: string;
  /** "linked" when another server's rail is calling (see auth/linked.ts); "bot" for a bot token (auth/bots.ts). */
  sessionScope: string | null;
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
  const authorization = c.req.header("authorization");
  if (authorization?.startsWith("Bot ")) {
    const bot = await resolveBotToken(c.get("db"), authorization.slice(4).trim());
    if (!bot) throw ApiError.unauthenticated("That bot token isn't valid");
    if (!botMayCall(c.req.method, c.req.path)) throw ApiError.forbidden("Bots can't use this endpoint");
    checkRateLimit(`bot:${bot.user.id}`, 120, 60_000);
    // Remembered at most once a minute, for the owner's "last used" column.
    if (!bot.lastUsedAt || Date.now() - bot.lastUsedAt.getTime() > 60_000) {
      c.executionCtx.waitUntil(c.get("db").update(schema.bots).set({ lastUsedAt: new Date() }).where(eq(schema.bots.userId, bot.user.id)).then(() => undefined));
    }
    c.set("user", bot.user);
    c.set("sessionId", `bot:${bot.user.id}`);
    c.set("sessionScope", BOT_SCOPE);
    return next();
  }
  const result = await resolveSession(c.get("auth"), c.get("db"), c.req.raw.headers, { allowLinked: true });
  if (!result) throw ApiError.unauthenticated();
  if (result.scope === LINKED_SCOPE && !linkedSessionMayCall(c.req.method, c.req.path)) {
    throw ApiError.forbidden("A linked server can only see your workspaces and unread counts.");
  }
  c.set("user", result.user);
  c.set("sessionId", result.sessionId);
  c.set("sessionScope", result.scope);
  await next();
};

/**
 * Linked sessions (another server's rail) are refused unless the caller opts in and
 * then checks the route itself, as requireUser does.
 */
export async function resolveSession(
  auth: Auth,
  db: Db,
  headers: Headers,
  options: { allowLinked?: boolean } = {},
): Promise<{ user: UserRow; sessionId: string; scope: string | null } | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const scope = (session.session as { scope?: string | null }).scope ?? null;
  if (scope === LINKED_SCOPE && !options.allowLinked) return null;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.user.id) });
  // Checked against the row, not the cached session cookie, so a suspension applies at once.
  // Apps never have sessions; refusing them here is a second lock on the door.
  if (!user || user.suspendedAt || user.deletedAt || user.kind !== "human") return null;
  return { user, sessionId: session.session.id, scope };
}
