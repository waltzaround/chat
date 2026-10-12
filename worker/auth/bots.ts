/**
 * Bot tokens: `Authorization: Bot <token>`, where the token is `<bot user id>.<secret>`.
 * Only a hash of the secret is stored. A bot may call the routes below and nothing
 * else: no settings, invites, DMs, account management or realtime sockets.
 */
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "../db";
import { randomToken, sha256Hex, timingSafeEqual } from "../lib/crypto";

export const BOT_SCOPE = "bot";

const BOT_ROUTES: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/api\/me$/ },
  { method: "GET", path: /^\/api\/me\/workspaces$/ },
  { method: "GET", path: /^\/api\/workspaces\/[^/]+$/ },
  { method: "GET", path: /^\/api\/workspaces\/[^/]+\/members$/ },
  { method: "GET", path: /^\/api\/workspaces\/[^/]+\/roles$/ },
  { method: "GET", path: /^\/api\/channels\/[^/]+$/ },
  { method: "GET", path: /^\/api\/channels\/[^/]+\/messages$/ },
  { method: "POST", path: /^\/api\/channels\/[^/]+\/messages$/ },
  { method: "GET", path: /^\/api\/channels\/[^/]+\/messages\/[^/]+$/ },
  { method: "PATCH", path: /^\/api\/channels\/[^/]+\/messages\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/channels\/[^/]+\/messages\/[^/]+$/ },
  { method: "GET", path: /^\/api\/channels\/[^/]+\/pins$/ },
  { method: "PUT", path: /^\/api\/channels\/[^/]+\/messages\/[^/]+\/pin$/ },
  { method: "DELETE", path: /^\/api\/channels\/[^/]+\/messages\/[^/]+\/pin$/ },
  { method: "PUT", path: /^\/api\/channels\/[^/]+\/messages\/[^/]+\/reactions$/ },
  { method: "DELETE", path: /^\/api\/channels\/[^/]+\/messages\/[^/]+\/reactions\/[^/]+$/ },
  { method: "POST", path: /^\/api\/uploads\/authorize$/ },
  { method: "PUT", path: /^\/api\/uploads\/put\/[^/]+$/ },
  { method: "POST", path: /^\/api\/uploads\/complete$/ },
  { method: "GET", path: /^\/api\/files\/.+$/ },
  { method: "GET", path: /^\/api\/bots\/@me$/ },
  { method: "GET", path: /^\/api\/bots\/@me\/commands$/ },
  { method: "PUT", path: /^\/api\/bots\/@me\/commands$/ },
];

export function botMayCall(method: string, path: string): boolean {
  return BOT_ROUTES.some((r) => r.method === method && r.path.test(path));
}

export async function newBotToken(botUserId: string): Promise<{ token: string; hash: string; hint: string }> {
  const secret = randomToken();
  return { token: `${botUserId}.${secret}`, hash: await sha256Hex(secret), hint: secret.slice(-4) };
}

export type BotUser = typeof schema.users.$inferSelect;

/** The bot's user row for a valid token, or null. */
export async function resolveBotToken(db: Db, token: string): Promise<{ user: BotUser; lastUsedAt: Date | null } | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.length > 200) return null;
  const userId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  const row = await db
    .select({ bot: schema.bots, user: schema.users })
    .from(schema.bots)
    .innerJoin(schema.users, eq(schema.users.id, schema.bots.userId))
    .where(and(eq(schema.bots.userId, userId), isNull(schema.users.deletedAt), isNull(schema.users.suspendedAt)))
    .get();
  if (!row) return null;
  if (!timingSafeEqual(row.bot.tokenHash, await sha256Hex(secret))) return null;
  return { user: row.user, lastUsedAt: row.bot.lastUsedAt };
}
