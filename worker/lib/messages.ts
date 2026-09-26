/**
 * Message loading, hydration and mutation helpers used by both the REST API
 * and the WorkspaceHub. Creating a message (sequence allocation) lives in the
 * hub because it needs single-writer semantics per workspace.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Attachment, Message, MessageAuthor, ReactionSummary, ReplyContext, UserSummary } from "@shared/types";
import { schema, type Db } from "../db";
import { fileUrl, iso, isoRequired, toUserSummary } from "./serialize";

type MessageRow = typeof schema.messages.$inferSelect;
type AttachmentRow = typeof schema.messageAttachments.$inferSelect;

export interface MessageQuery {
  channelId: string;
  before?: number;
  after?: number;
  around?: number;
  limit: number;
}

export async function loadMessagePage(db: Db, q: MessageQuery, viewerUserId: string) {
  const conditions = [eq(schema.messages.channelId, q.channelId), isNull(schema.messages.deletedAt)];
  let rows: MessageRow[];
  let hasMore = false;

  if (q.around !== undefined) {
    const half = Math.max(1, Math.floor(q.limit / 2));
    const [beforeRows, afterRows] = await Promise.all([
      db.select().from(schema.messages).where(and(...conditions, lt(schema.messages.channelSequence, q.around))).orderBy(desc(schema.messages.channelSequence)).limit(half),
      db.select().from(schema.messages).where(and(...conditions, sql`${schema.messages.channelSequence} >= ${q.around}`)).orderBy(asc(schema.messages.channelSequence)).limit(half + 1),
    ]);
    rows = [...beforeRows.reverse(), ...afterRows];
    hasMore = beforeRows.length === half;
  } else if (q.after !== undefined) {
    const found = await db.select().from(schema.messages).where(and(...conditions, gt(schema.messages.channelSequence, q.after))).orderBy(asc(schema.messages.channelSequence)).limit(q.limit + 1);
    hasMore = found.length > q.limit;
    rows = found.slice(0, q.limit);
  } else {
    const where = q.before !== undefined ? and(...conditions, lt(schema.messages.channelSequence, q.before)) : and(...conditions);
    const found = await db.select().from(schema.messages).where(where).orderBy(desc(schema.messages.channelSequence)).limit(q.limit + 1);
    hasMore = found.length > q.limit;
    rows = found.slice(0, q.limit).reverse();
  }

  const messages = await hydrateMessages(db, rows, viewerUserId);
  return { messages, hasMore };
}

export async function loadMessage(db: Db, messageId: string, viewerUserId: string): Promise<Message | null> {
  const row = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!row || row.deletedAt) return null;
  const [m] = await hydrateMessages(db, [row], viewerUserId);
  return m ?? null;
}

export async function hydrateMessages(db: Db, rows: MessageRow[], viewerUserId: string): Promise<Message[]> {
  if (rows.length === 0) return [];
  const workspaceId = rows[0]!.workspaceId;
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.map((r) => r.replyToMessageId).filter((x): x is string => !!x))];

  const replyRows = replyIds.length ? await db.select().from(schema.messages).where(inArray(schema.messages.id, replyIds)) : [];
  const authorIds = [...new Set([...rows.map((r) => r.authorUserId), ...replyRows.map((r) => r.authorUserId)])];

  const [authors, members, memberRoleRows, roles, attachments, reactions] = await Promise.all([
    db.select().from(schema.users).where(inArray(schema.users.id, authorIds)),
    db.select().from(schema.workspaceMembers).where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), inArray(schema.workspaceMembers.userId, authorIds))),
    db.select().from(schema.memberRoles).where(and(eq(schema.memberRoles.workspaceId, workspaceId), inArray(schema.memberRoles.userId, authorIds))),
    db.select().from(schema.roles).where(eq(schema.roles.workspaceId, workspaceId)),
    db.select().from(schema.messageAttachments).where(inArray(schema.messageAttachments.messageId, ids)),
    db.select().from(schema.messageReactions).where(inArray(schema.messageReactions.messageId, ids)),
  ]);

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const colourByUser = new Map<string, string | null>();
  for (const mr of memberRoleRows) {
    const role = roleById.get(mr.roleId);
    if (!role?.colour) continue;
    const current = colourByUser.get(mr.userId);
    const currentRole = current ? roles.find((r) => r.colour === current) : undefined;
    if (!currentRole || role.position > currentRole.position) colourByUser.set(mr.userId, role.colour);
  }
  const nicknameByUser = new Map(members.map((m) => [m.userId, m.nickname]));
  const userById = new Map(authors.map((u) => [u.id, u]));

  const authorFor = (userId: string): MessageAuthor => {
    const u = userById.get(userId);
    const base: UserSummary = u ? toUserSummary(u) : { id: userId, username: "unknown", displayName: "Unknown user", avatarUrl: null };
    return { ...base, nickname: nicknameByUser.get(userId) ?? null, roleColour: colourByUser.get(userId) ?? null };
  };

  const replyById = new Map(replyRows.map((r) => [r.id, r]));
  const attachmentsByMessage = new Map<string, Attachment[]>();
  for (const a of attachments) {
    if (!a.messageId) continue;
    const list = attachmentsByMessage.get(a.messageId) ?? [];
    list.push(toAttachment(a));
    attachmentsByMessage.set(a.messageId, list);
  }
  const reactionsByMessage = new Map<string, ReactionSummary[]>();
  for (const r of reactions) {
    const list = reactionsByMessage.get(r.messageId) ?? [];
    let entry = list.find((e) => e.emoji === r.emoji);
    if (!entry) {
      entry = { emoji: r.emoji, count: 0, me: false, userIds: [] };
      list.push(entry);
    }
    entry.count += 1;
    entry.userIds.push(r.userId);
    if (r.userId === viewerUserId) entry.me = true;
    reactionsByMessage.set(r.messageId, list);
  }

  return rows.map((row) => {
    let replyTo: ReplyContext | null = null;
    if (row.replyToMessageId) {
      const target = replyById.get(row.replyToMessageId);
      replyTo = target
        ? { id: target.id, author: authorFor(target.authorUserId), content: target.deletedAt ? "" : target.content, deleted: !!target.deletedAt }
        : { id: row.replyToMessageId, author: null, content: "", deleted: true };
    }
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      channelId: row.channelId,
      sequence: row.channelSequence,
      author: authorFor(row.authorUserId),
      content: row.content,
      replyTo,
      attachments: attachmentsByMessage.get(row.id) ?? [],
      reactions: reactionsByMessage.get(row.id) ?? [],
      editedAt: iso(row.editedAt),
      pinnedAt: iso(row.pinnedAt),
      createdAt: isoRequired(row.createdAt),
    } satisfies Message;
  });
}

export function toAttachment(a: AttachmentRow): Attachment {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    byteSize: a.byteSize,
    width: a.width,
    height: a.height,
    duration: a.duration,
    url: fileUrl(a.r2Key)!,
  };
}

export async function reactionSummary(db: Db, messageId: string, viewerUserId: string): Promise<ReactionSummary[]> {
  const rows = await db.select().from(schema.messageReactions).where(eq(schema.messageReactions.messageId, messageId));
  const out: ReactionSummary[] = [];
  for (const r of rows) {
    let entry = out.find((e) => e.emoji === r.emoji);
    if (!entry) {
      entry = { emoji: r.emoji, count: 0, me: false, userIds: [] };
      out.push(entry);
    }
    entry.count += 1;
    entry.userIds.push(r.userId);
    if (r.userId === viewerUserId) entry.me = true;
  }
  return out;
}

/** Soft-deletes a message and returns the R2 keys of its attachments for cleanup. */
export async function softDeleteMessage(db: Db, messageId: string): Promise<string[]> {
  const attachments = await db.select({ key: schema.messageAttachments.r2Key }).from(schema.messageAttachments).where(eq(schema.messageAttachments.messageId, messageId));
  await db.update(schema.messages).set({ deletedAt: new Date(), content: "" }).where(eq(schema.messages.id, messageId));
  return attachments.map((a) => a.key);
}
