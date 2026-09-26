import { Hono, type MiddlewareHandler } from "hono";
import { and, eq, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema, type Db } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { iso, toUserSummary } from "../lib/serialize";
import { checkRateLimit } from "../security/ratelimit";
import { newId, slugify } from "@shared/id";
import { Permission } from "@shared/permissions";
import { openDmSchema } from "@shared/schemas";
import type { DirectMessage, UserSummary } from "@shared/types";

/**
 * Direct messages. Each conversation is a small workspace (kind "dm") with the two
 * people as members and one text channel, so messages, uploads, reactions, read state
 * and realtime all work as in any channel. You can message people you share a
 * workspace with.
 */
export const dmRoutes = new Hono<AppEnv>();
dmRoutes.use("*", requireUser);

/** What both people may do in a conversation. Nobody owns it, so nobody moderates it. */
const DM_PERMISSIONS = Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.ADD_REACTIONS | Permission.ATTACH_FILES;

const pairKey = (a: string, b: string) => (a < b ? { userA: a, userB: b } : { userA: b, userB: a });

dmRoutes.get("/", async (c) => {
  const db = c.get("db");
  const me = c.get("user").id;
  const pairs = await db.select().from(schema.dmPairs).where(or(eq(schema.dmPairs.userA, me), eq(schema.dmPairs.userB, me)));
  if (pairs.length === 0) return c.json([]);

  const peerIds = pairs.map((p) => (p.userA === me ? p.userB : p.userA));
  const channelIds = pairs.map((p) => p.channelId);
  const [peers, channels, reads] = await Promise.all([
    db.select().from(schema.users).where(inArray(schema.users.id, peerIds)),
    db.select().from(schema.channels).where(inArray(schema.channels.id, channelIds)),
    db.select().from(schema.channelReadStates).where(and(eq(schema.channelReadStates.userId, me), inArray(schema.channelReadStates.channelId, channelIds))),
  ]);
  const peerBy = new Map(peers.map((u) => [u.id, u]));
  const channelBy = new Map(channels.map((ch) => [ch.id, ch]));
  const readBy = new Map(reads.map((r) => [r.channelId, r.lastReadSequence]));

  const list: DirectMessage[] = [];
  for (const p of pairs) {
    const channel = channelBy.get(p.channelId);
    const peer = peerBy.get(p.userA === me ? p.userB : p.userA);
    if (!channel || !peer) continue;
    list.push({
      workspaceId: p.workspaceId,
      channelId: p.channelId,
      peer: toUserSummary(peer),
      lastMessageAt: iso(channel.lastMessageAt),
      unreadCount: Math.max(0, channel.lastSequence - (readBy.get(channel.id) ?? 0)),
    });
  }
  list.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  return c.json(list);
});

/** People you could message: anyone active who shares a workspace with you. */
dmRoutes.get("/people", async (c) => {
  const db = c.get("db");
  const me = c.get("user").id;
  const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 64);
  const mine = db.select({ id: schema.workspaceMembers.workspaceId }).from(schema.workspaceMembers).innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId)).where(and(eq(schema.workspaceMembers.userId, me), eq(schema.workspaces.kind, "community")));
  const rows = await db
    .selectDistinct({ user: schema.users })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(
      and(
        inArray(schema.workspaceMembers.workspaceId, mine),
        eq(schema.workspaceMembers.status, "active"),
        ne(schema.users.id, me),
        isNull(schema.users.deletedAt),
        isNull(schema.users.suspendedAt),
        q ? or(like(schema.users.username, `%${q}%`), like(schema.users.displayName, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(schema.users.displayName)
    .limit(20);
  const body: UserSummary[] = rows.map((r) => toUserSummary(r.user));
  return c.json(body);
});

/** Open the conversation with someone, starting it if needed. */
dmRoutes.post("/", async (c) => {
  const db = c.get("db");
  const me = c.get("user").id;
  const { userId } = await parseBody(c, openDmSchema);
  if (userId === me) throw ApiError.validation(undefined, "You can't message yourself");
  const peer = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!peer || peer.deletedAt || peer.suspendedAt) throw ApiError.notFound("User");

  const key = pairKey(me, userId);
  const existing = await db.query.dmPairs.findFirst({ where: and(eq(schema.dmPairs.userA, key.userA), eq(schema.dmPairs.userB, key.userB)) });
  if (existing) {
    await ensureMember(db, existing.workspaceId, me);
    return c.json({ workspaceId: existing.workspaceId, channelId: existing.channelId });
  }

  if (!(await shareWorkspace(db, me, userId))) throw ApiError.forbidden("You can only message people you share a workspace with");
  checkRateLimit(`dm-create:${me}`, 20, 60 * 60 * 1000);

  const now = new Date();
  const workspaceId = newId();
  const channelId = newId();
  await db.batch([
    db.insert(schema.workspaces).values({ id: workspaceId, name: "Direct message", slug: `dm-${slugify(workspaceId)}`, iconKey: null, ownerUserId: me, kind: "dm", createdAt: now, updatedAt: now }),
    db.insert(schema.roles).values({ id: newId(), workspaceId, name: "@everyone", colour: null, position: 0, permissions: DM_PERMISSIONS, isDefault: true, createdAt: now }),
    db.insert(schema.channels).values({ id: channelId, workspaceId, categoryId: null, name: "direct-message", topic: null, kind: "text", position: 0, createdBy: me, createdAt: now }),
    db.insert(schema.workspaceMembers).values([
      { workspaceId, userId: me, nickname: null, joinedAt: now, status: "active", timeoutUntil: null },
      { workspaceId, userId, nickname: null, joinedAt: now, status: "active", timeoutUntil: null },
    ]),
    db.insert(schema.dmPairs).values({ ...key, workspaceId, channelId, createdAt: now }).onConflictDoNothing(),
  ]);
  // Two people racing to start the same conversation: keep whichever pair row won.
  const winner = await db.query.dmPairs.findFirst({ where: and(eq(schema.dmPairs.userA, key.userA), eq(schema.dmPairs.userB, key.userB)) });
  if (winner && winner.workspaceId !== workspaceId) {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    return c.json({ workspaceId: winner.workspaceId, channelId: winner.channelId });
  }
  return c.json({ workspaceId, channelId }, 201);
});

async function shareWorkspace(db: Db, a: string, b: string): Promise<boolean> {
  const row = await db.get<{ found: number }>(sql`
    SELECT 1 AS found FROM workspace_members x
    JOIN workspace_members y ON y.workspace_id = x.workspace_id AND y.user_id = ${b} AND y.status = 'active'
    JOIN workspaces w ON w.id = x.workspace_id AND w.kind = 'community'
    WHERE x.user_id = ${a} AND x.status = 'active' LIMIT 1`);
  return !!row;
}

async function ensureMember(db: Db, workspaceId: string, userId: string): Promise<void> {
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId, nickname: null, joinedAt: new Date(), status: "active", timeoutUntil: null }).onConflictDoNothing();
}

/**
 * DM conversations only allow reading and chatting. Workspace management (settings,
 * roles, invites, channels, members) is refused for them.
 */
export const dmGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const workspaceId = c.req.param("workspaceId");
  if (workspaceId) {
    const row = await c.env.DB.prepare("SELECT kind FROM workspaces WHERE id = ?").bind(workspaceId).first<{ kind: string }>();
    if (row?.kind === "dm") {
      const rest = c.req.path.split(`/api/workspaces/${workspaceId}`)[1] ?? "";
      const readOnly = c.req.method === "GET" && ["", "/members", "/search", "/emojis"].includes(rest);
      if (!readOnly) throw ApiError.forbidden("That isn't available in direct messages");
    }
  }
  await next();
};
