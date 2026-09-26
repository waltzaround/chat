import { Hono } from "hono";
import { and, eq, inArray, or } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { parseQuery } from "../lib/validate";
import { hydrateMessages } from "../lib/messages";
import { checkRateLimit } from "../security/ratelimit";
import { buildContext, visibleChannelIds } from "../permissions/resolve";
import { toFtsQuery } from "./workspaces";
import { searchQuerySchema } from "@shared/schemas";
import type { Message, SearchResponse, SearchResult } from "@shared/types";
import { chunked } from "../lib/chunks";

/** GET /api/search: every channel you can see, across all your workspaces and DMs. */
export const searchRoutes = new Hono<AppEnv>();
searchRoutes.use("*", requireUser);

searchRoutes.get("/", async (c) => {
  const db = c.get("db");
  const me = c.get("user").id;
  checkRateLimit(`search:${me}`, 60, 60 * 1000);
  const q = parseQuery(c, searchQuerySchema);
  const ftsQuery = toFtsQuery(q.q);
  const empty: SearchResponse = { results: [], total: 0 };
  if (!ftsQuery) return c.json(empty);

  const memberships = await db
    .select({ workspace: schema.workspaces, member: schema.workspaceMembers })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(and(eq(schema.workspaceMembers.userId, me), eq(schema.workspaceMembers.status, "active")));
  if (memberships.length === 0) return c.json(empty);

  // Which channels you can see. Everyone in a DM can read it; communities resolve roles.
  const communities = memberships.filter((m) => m.workspace.kind !== "dm");
  const dmIds = memberships.filter((m) => m.workspace.kind === "dm").map((m) => m.workspace.id);
  const [roles, memberRoles, dmPairs] = await Promise.all([
    chunked(communities.map((m) => m.workspace.id), (ids) => db.select().from(schema.roles).where(inArray(schema.roles.workspaceId, ids))),
    communities.length ? db.select().from(schema.memberRoles).where(eq(schema.memberRoles.userId, me)) : [],
    dmIds.length ? db.select().from(schema.dmPairs).where(or(eq(schema.dmPairs.userA, me), eq(schema.dmPairs.userB, me))) : [],
  ]);
  const visible = await Promise.all(
    communities.map((m) => {
      const ctx = buildContext(
        m.workspace,
        m.member,
        roles.filter((r) => r.workspaceId === m.workspace.id),
        memberRoles.filter((r) => r.workspaceId === m.workspace.id).map((r) => r.roleId),
      );
      return visibleChannelIds(db, ctx);
    }),
  );
  const channelIds = [...visible.flat(), ...dmPairs.map((p) => p.channelId)];
  if (channelIds.length === 0) return c.json(empty);

  // One JSON parameter, so any number of channels fits D1's 100-parameter limit.
  const authorClause = q.authorId ? " AND f.author_user_id = ?" : "";
  const params: unknown[] = [ftsQuery, JSON.stringify(channelIds), ...(q.authorId ? [q.authorId] : [])];
  const where = `messages_fts MATCH ? AND f.channel_id IN (SELECT value FROM json_each(?))${authorClause} AND m.deleted_at IS NULL`;
  const [countRes, rowsRes] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT count(*) AS total FROM messages_fts f JOIN messages m ON m.id = f.message_id WHERE ${where}`).bind(...params),
    c.env.DB.prepare(
      `SELECT m.id, snippet(messages_fts, 0, '\u0001', '\u0002', '…', 24) AS snippet, c.name AS channel_name
       FROM messages_fts f JOIN messages m ON m.id = f.message_id JOIN channels c ON c.id = m.channel_id
       WHERE ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, q.limit, q.offset),
  ]);
  const total = Number((countRes.results[0] as { total: number } | undefined)?.total ?? 0);
  const hits = rowsRes.results as Array<{ id: string; snippet: string; channel_name: string }>;
  if (hits.length === 0) return c.json({ results: [], total } satisfies SearchResponse);

  // Hydrate per workspace (nicknames and role colours are per workspace), then keep the order.
  const rows = await db.select().from(schema.messages).where(inArray(schema.messages.id, hits.map((h) => h.id)));
  const byWorkspace = new Map<string, typeof rows>();
  for (const r of rows) byWorkspace.set(r.workspaceId, [...(byWorkspace.get(r.workspaceId) ?? []), r]);
  const hydrated = new Map<string, Message>();
  for (const group of byWorkspace.values()) for (const m of await hydrateMessages(db, group, me)) hydrated.set(m.id, m);

  const peerIds = dmPairs.map((p) => (p.userA === me ? p.userB : p.userA));
  const peers = await chunked(peerIds, (ids) => db.select({ id: schema.users.id, name: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, ids)));
  const peerName = new Map(dmPairs.map((p) => [p.workspaceId, peers.find((u) => u.id === (p.userA === me ? p.userB : p.userA))?.name ?? "Deleted user"]));
  const workspaceBy = new Map(memberships.map((m) => [m.workspace.id, m.workspace]));

  const results: SearchResult[] = [];
  for (const h of hits) {
    const message = hydrated.get(h.id);
    const ws = message ? workspaceBy.get(message.workspaceId) : undefined;
    if (!message || !ws) continue;
    const kind = ws.kind === "dm" ? "dm" : "community";
    results.push({ message, channelName: h.channel_name, snippet: h.snippet, workspace: { id: ws.id, name: ws.name, kind, dmPeerName: kind === "dm" ? (peerName.get(ws.id) ?? null) : null } });
  }
  return c.json({ results, total } satisfies SearchResponse);
});
