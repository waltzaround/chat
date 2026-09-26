import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "../db";
import { Permission, buildContext, channelPermissions, hasPermission, toOverwriteLike } from "../permissions/resolve";
import type { PermissionBits } from "@shared/permissions";
import { usersBlocking } from "./blocks";
import { chunked } from "./chunks";

/** Cap on how many people one message can notify. */
const MAX_RECIPIENTS = 5000;

export interface ParsedMentions {
  usernames: string[];
  everyone: boolean;
  here: boolean;
}

/** Mentions are plain `@username`, `@everyone` and `@here`. Code spans and blocks don't count. */
export function parseMentions(content: string): ParsedMentions {
  const text = content.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const names = new Set<string>();
  let everyone = false;
  let here = false;
  for (const match of text.matchAll(/(^|[^\w@./])@([a-z0-9_.]{2,32})/gi)) {
    const name = match[2]!.toLowerCase().replace(/\.+$/, "");
    if (name === "everyone") everyone = true;
    else if (name === "here") here = true;
    else if (name.length >= 2) names.add(name);
  }
  return { usernames: [...names], everyone, here };
}

export interface MentionInput {
  workspaceId: string;
  channelId: string;
  authorUserId: string;
  content: string;
  /** Author of the message being replied to, who is notified like Discord does. */
  replyToAuthorId: string | null;
  /** The author's permissions in the channel: @everyone/@here need MENTION_EVERYONE. */
  authorPermissions: PermissionBits;
  /** People currently connected to the workspace, for @here. */
  onlineUserIds: () => string[];
}

/** Everyone this message should notify: mentioned, able to see the channel, not the author. */
export async function mentionRecipients(db: Db, input: MentionInput): Promise<string[]> {
  const parsed = parseMentions(input.content);
  const wide = hasPermission(input.authorPermissions, Permission.MENTION_EVERYONE);
  const everyone = wide && parsed.everyone;
  const here = wide && parsed.here && !everyone;
  if (!everyone && !here && parsed.usernames.length === 0 && !input.replyToAuthorId) return [];

  const candidates = new Set<string>();
  if (input.replyToAuthorId) candidates.add(input.replyToAuthorId);
  if (here) for (const id of input.onlineUserIds()) candidates.add(id);
  if (parsed.usernames.length) {
    const named = await chunked(parsed.usernames, (names) => db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.username, names)));
    for (const u of named) candidates.add(u.id);
  }
  candidates.delete(input.authorUserId);
  if (!everyone && candidates.size === 0) return [];

  const membersOf = (userIds: string[] | null) =>
    db
      .select({ member: schema.workspaceMembers })
      .from(schema.workspaceMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, input.workspaceId),
          eq(schema.workspaceMembers.status, "active"),
          isNull(schema.users.suspendedAt),
          isNull(schema.users.deletedAt),
          userIds ? inArray(schema.workspaceMembers.userId, userIds) : undefined,
        ),
      )
      .limit(MAX_RECIPIENTS + 1);
  const members = everyone ? await membersOf(null) : await chunked([...candidates], (ids) => membersOf(ids));

  const [workspace, roles, memberRoles, overwrites] = await Promise.all([
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, input.workspaceId) }),
    db.query.roles.findMany({ where: eq(schema.roles.workspaceId, input.workspaceId) }),
    db.select({ userId: schema.memberRoles.userId, roleId: schema.memberRoles.roleId }).from(schema.memberRoles).where(eq(schema.memberRoles.workspaceId, input.workspaceId)),
    db.query.channelPermissionOverwrites.findMany({ where: eq(schema.channelPermissionOverwrites.channelId, input.channelId) }),
  ]);
  if (!workspace) return [];
  const rolesBy = new Map<string, string[]>();
  for (const r of memberRoles) rolesBy.set(r.userId, [...(rolesBy.get(r.userId) ?? []), r.roleId]);
  const channelOverwrites = toOverwriteLike(overwrites);

  const out: string[] = [];
  const blockingAuthor = await usersBlocking(db, input.authorUserId, members.map((m) => m.member.userId));
  for (const { member } of members) {
    if (blockingAuthor.has(member.userId)) continue;
    if (member.userId === input.authorUserId) continue;
    const ctx = buildContext(workspace, member, roles, rolesBy.get(member.userId) ?? []);
    if (hasPermission(channelPermissions(ctx, channelOverwrites), Permission.VIEW_CHANNEL)) out.push(member.userId);
    if (out.length >= MAX_RECIPIENTS) break;
  }
  return out;
}

/** Store who a message notifies, replacing any earlier set (for edits). */
export async function saveMentions(db: Db, message: { id: string; workspaceId: string; channelId: string; sequence: number }, userIds: string[]): Promise<void> {
  const rows = userIds.map((userId) => ({ messageId: message.id, userId, workspaceId: message.workspaceId, channelId: message.channelId, sequence: message.sequence }));
  // D1 allows 100 bound parameters per statement: 5 columns → 20 rows each.
  const statements = [db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id))];
  for (let i = 0; i < rows.length; i += 20) statements.push(db.insert(schema.messageMentions).values(rows.slice(i, i + 20)).onConflictDoNothing() as never);
  await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
}

/** Unread mentions of one user, per channel (in one workspace) or per workspace. */
export async function unreadMentionCounts(db: Db, userId: string, by: "channel" | "workspace", workspaceId?: string): Promise<Map<string, number>> {
  const key = by === "channel" ? sql`mm.channel_id` : sql`mm.workspace_id`;
  const rows = await db.all<{ key: string; count: number }>(sql`
    SELECT ${key} AS key, count(*) AS count
    FROM message_mentions mm
    JOIN messages m ON m.id = mm.message_id AND m.deleted_at IS NULL
    LEFT JOIN channel_read_states rs ON rs.user_id = mm.user_id AND rs.channel_id = mm.channel_id
    WHERE mm.user_id = ${userId}
      ${workspaceId ? sql`AND mm.workspace_id = ${workspaceId}` : sql``}
      AND mm.sequence > coalesce(rs.last_read_sequence, 0)
    GROUP BY ${key}`);
  return new Map(rows.map((r) => [r.key, Number(r.count)]));
}

/**
 * Work out and store who a new or edited message notifies. Returns them so a new
 * message's caller can send the notifications (edits never re-notify).
 */
export async function recordMentions(
  db: Db,
  row: { id: string; workspaceId: string; channelId: string; channelSequence: number; authorUserId: string; content: string; replyToMessageId: string | null; threadRootId?: string | null },
  authorPermissions: PermissionBits,
  onlineUserIds: () => string[],
): Promise<string[]> {
  // A reply notifies whoever it answers; a thread reply, whoever started the thread.
  let replyToAuthorId: string | null = null;
  const answering = row.replyToMessageId ?? row.threadRootId ?? null;
  if (answering) {
    const target = await db.query.messages.findFirst({ where: eq(schema.messages.id, answering), columns: { authorUserId: true } });
    replyToAuthorId = target?.authorUserId ?? null;
  }
  const recipients = await mentionRecipients(db, {
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    authorUserId: row.authorUserId,
    content: row.content,
    replyToAuthorId,
    authorPermissions,
    onlineUserIds,
  });
  await saveMentions(db, { id: row.id, workspaceId: row.workspaceId, channelId: row.channelId, sequence: row.channelSequence }, recipients);
  return recipients;
}
