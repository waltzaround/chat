import { Hono } from "hono";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody, parseQuery } from "../lib/validate";
import { audit } from "../lib/audit";
import { hubFor, notifyWorkspace } from "../lib/hub";
import { hydrateMessages, loadMessage, loadMessagePage, reactionSummary, softDeleteMessage } from "../lib/messages";
import { recordMentions } from "../lib/mentions";
import { findFilteredTerm } from "@shared/moderation";
import { checkRateLimit } from "../security/ratelimit";
import { Permission, hasPermission, requireChannelAccess } from "../permissions/resolve";
import { createMessageSchema, editMessageSchema, messagesQuerySchema, overwriteSchema, readSchema, updateChannelSchema, emojiSchema } from "@shared/schemas";
import { CHANNEL_PERMISSIONS } from "@shared/permissions";
import type { MessagePage, PermissionOverwrite } from "@shared/types";
import { z } from "zod";

export const channelRoutes = new Hono<AppEnv>();
channelRoutes.use("*", requireUser);

channelRoutes.get("/:channelId", async (c) => {
  const { channel, permissions } = await requireChannelAccess(c.get("db"), c.req.param("channelId"), c.get("user").id);
  return c.json({ id: channel.id, workspaceId: channel.workspaceId, categoryId: channel.categoryId, name: channel.name, topic: channel.topic, kind: channel.kind, position: channel.position, lastSequence: channel.lastSequence, permissions, lastReadSequence: 0, mentionCount: 0, slowmodeSeconds: channel.slowmodeSeconds });
});

channelRoutes.patch("/:channelId", async (c) => {
  const db = c.get("db");
  const { channel, ctx } = await requireChannelAccess(db, c.req.param("channelId"), c.get("user").id, Permission.MANAGE_CHANNELS);
  const input = await parseBody(c, updateChannelSchema);
  if (input.categoryId) {
    const cat = await db.query.categories.findFirst({ where: and(eq(schema.categories.id, input.categoryId), eq(schema.categories.workspaceId, channel.workspaceId)) });
    if (!cat) throw ApiError.notFound("Category");
  }
  await db
    .update(schema.channels)
    .set({
      name: input.name ? (channel.kind === "voice" ? input.name.replace(/-/g, " ") : input.name) : channel.name,
      topic: input.topic === undefined ? channel.topic : input.topic,
      categoryId: input.categoryId === undefined ? channel.categoryId : input.categoryId,
      position: input.position ?? channel.position,
      slowmodeSeconds: input.slowmodeSeconds ?? channel.slowmodeSeconds,
    })
    .where(eq(schema.channels.id, channel.id));
  await audit(db, { workspaceId: channel.workspaceId, actorUserId: ctx.userId, action: "channel.updated", targetType: "channel", targetId: channel.id, details: input });
  await notifyWorkspace(c.env, channel.workspaceId, { type: "workspace.updated", reason: "channels" });
  return c.json({ ok: true });
});

channelRoutes.delete("/:channelId", async (c) => {
  const db = c.get("db");
  const { channel, ctx } = await requireChannelAccess(db, c.req.param("channelId"), c.get("user").id, Permission.MANAGE_CHANNELS);
  const attachments = await db.select({ key: schema.messageAttachments.r2Key }).from(schema.messageAttachments).where(eq(schema.messageAttachments.channelId, channel.id));
  await db.delete(schema.channels).where(eq(schema.channels.id, channel.id));
  if (attachments.length) await c.env.BACKGROUND_QUEUE.send({ type: "message.deleted", attachmentKeys: attachments.map((a) => a.key) });
  await audit(db, { workspaceId: channel.workspaceId, actorUserId: ctx.userId, action: "channel.deleted", targetType: "channel", targetId: channel.id, details: { name: channel.name, kind: channel.kind } });
  await notifyWorkspace(c.env, channel.workspaceId, { type: "workspace.updated", reason: "channels" });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Permission overwrites
// ---------------------------------------------------------------------------

channelRoutes.get("/:channelId/overwrites", async (c) => {
  const db = c.get("db");
  const { channel } = await requireChannelAccess(db, c.req.param("channelId"), c.get("user").id, Permission.MANAGE_CHANNELS);
  const rows = await db.query.channelPermissionOverwrites.findMany({ where: eq(schema.channelPermissionOverwrites.channelId, channel.id) });
  const body: PermissionOverwrite[] = rows.map((o) => ({ channelId: o.channelId, targetType: o.targetType as "role" | "user", targetId: o.targetId, allow: o.allowPermissions, deny: o.denyPermissions }));
  return c.json(body);
});

channelRoutes.put("/:channelId/overwrites", async (c) => {
  const db = c.get("db");
  const { channel, ctx } = await requireChannelAccess(db, c.req.param("channelId"), c.get("user").id, Permission.MANAGE_CHANNELS);
  const input = await parseBody(c, overwriteSchema);
  const allow = input.allow & CHANNEL_PERMISSIONS;
  const deny = input.deny & CHANNEL_PERMISSIONS & ~allow;
  if (input.targetType === "role") {
    if (!ctx.roles.some((r) => r.id === input.targetId)) throw ApiError.notFound("Role");
  } else {
    const member = await db.query.workspaceMembers.findFirst({ where: and(eq(schema.workspaceMembers.workspaceId, channel.workspaceId), eq(schema.workspaceMembers.userId, input.targetId)) });
    if (!member) throw ApiError.notFound("Member");
  }
  // Non-admins may not lock themselves (or admins) out of managing the channel.
  if (!hasPermission(ctx.basePermissions, Permission.ADMINISTRATOR) && (deny & Permission.MANAGE_CHANNELS) !== 0 && (input.targetType === "user" ? input.targetId === ctx.userId : ctx.memberRoleIds.includes(input.targetId) || ctx.everyoneRole?.id === input.targetId)) {
    throw ApiError.forbidden("You cannot remove your own ability to manage this channel");
  }
  await db
    .insert(schema.channelPermissionOverwrites)
    .values({ channelId: channel.id, targetType: input.targetType, targetId: input.targetId, allowPermissions: allow, denyPermissions: deny })
    .onConflictDoUpdate({
      target: [schema.channelPermissionOverwrites.channelId, schema.channelPermissionOverwrites.targetType, schema.channelPermissionOverwrites.targetId],
      set: { allowPermissions: allow, denyPermissions: deny },
    });
  await audit(db, { workspaceId: channel.workspaceId, actorUserId: ctx.userId, action: "channel.overwrite_set", targetType: "channel", targetId: channel.id, details: { ...input, allow, deny } });
  await notifyWorkspace(c.env, channel.workspaceId, { type: "workspace.updated", reason: "channels" });
  return c.json({ ok: true });
});

channelRoutes.delete("/:channelId/overwrites/:targetType/:targetId", async (c) => {
  const db = c.get("db");
  const { channel, ctx } = await requireChannelAccess(db, c.req.param("channelId"), c.get("user").id, Permission.MANAGE_CHANNELS);
  const targetType = c.req.param("targetType");
  if (targetType !== "role" && targetType !== "user") throw ApiError.validation(undefined, "Invalid target type");
  await db.delete(schema.channelPermissionOverwrites).where(and(eq(schema.channelPermissionOverwrites.channelId, channel.id), eq(schema.channelPermissionOverwrites.targetType, targetType), eq(schema.channelPermissionOverwrites.targetId, c.req.param("targetId"))));
  await audit(db, { workspaceId: channel.workspaceId, actorUserId: ctx.userId, action: "channel.overwrite_removed", targetType: "channel", targetId: channel.id, details: { targetType, targetId: c.req.param("targetId") } });
  await notifyWorkspace(c.env, channel.workspaceId, { type: "workspace.updated", reason: "channels" });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

channelRoutes.get("/:channelId/messages", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel } = await requireChannelAccess(db, c.req.param("channelId"), user.id);
  const q = parseQuery(c, messagesQuerySchema);
  const page: MessagePage = await loadMessagePage(db, { channelId: channel.id, before: q.before, after: q.after, around: q.around, limit: q.limit }, user.id);
  return c.json(page);
});

/** REST fallback for sending. The hub owns sequence allocation so we delegate to it. */
channelRoutes.post("/:channelId/messages", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel } = await requireChannelAccess(db, c.req.param("channelId"), user.id, Permission.SEND_MESSAGES);
  checkRateLimit(`msg:${user.id}`, 30, 10_000);
  const input = await parseBody(c, createMessageSchema);
  const result = await hubFor(c.env, channel.workspaceId).createMessage({
    userId: user.id,
    channelId: channel.id,
    content: input.content,
    clientMessageId: input.clientMessageId,
    attachmentIds: input.attachmentIds ?? [],
    replyTo: input.replyTo ?? null,
  });
  if (!result.ok) throw new ApiError(result.status, result.code, result.message);
  return c.json(result.message, 201);
});

channelRoutes.patch("/:channelId/messages/:messageId", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel, permissions, ctx } = await requireChannelAccess(db, c.req.param("channelId"), user.id);
  const input = await parseBody(c, editMessageSchema);
  const exempt = hasPermission(permissions, Permission.MANAGE_MESSAGES) || hasPermission(permissions, Permission.MANAGE_CHANNELS);
  if (!exempt && findFilteredTerm(input.content, ctx.workspace.wordFilter)) {
    throw ApiError.validation(undefined, "Your message contains a word or phrase this workspace doesn't allow.");
  }
  const row = await db.query.messages.findFirst({ where: and(eq(schema.messages.id, c.req.param("messageId")), eq(schema.messages.channelId, channel.id)) });
  if (!row || row.deletedAt) throw ApiError.notFound("Message");
  if (row.authorUserId !== user.id) throw ApiError.forbidden("You can only edit your own messages");
  checkRateLimit(`edit:${user.id}`, 20, 10_000);
  await db.update(schema.messages).set({ content: input.content, editedAt: new Date() }).where(eq(schema.messages.id, row.id));
  await recordMentions(db, { ...row, content: input.content }, permissions, () => []);
  const message = (await loadMessage(db, row.id, user.id))!;
  await notifyWorkspace(c.env, channel.workspaceId, { type: "message.updated", message }, channel.id);
  return c.json(message);
});

channelRoutes.delete("/:channelId/messages/:messageId", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel, permissions, ctx } = await requireChannelAccess(db, c.req.param("channelId"), user.id);
  const row = await db.query.messages.findFirst({ where: and(eq(schema.messages.id, c.req.param("messageId")), eq(schema.messages.channelId, channel.id)) });
  if (!row || row.deletedAt) throw ApiError.notFound("Message");
  const isAuthor = row.authorUserId === user.id;
  if (!isAuthor && !hasPermission(permissions, Permission.MANAGE_MESSAGES)) throw ApiError.forbidden("You cannot delete this message");
  const keys = await softDeleteMessage(db, row.id);
  if (keys.length) await c.env.BACKGROUND_QUEUE.send({ type: "message.deleted", attachmentKeys: keys });
  if (!isAuthor) await audit(db, { workspaceId: channel.workspaceId, actorUserId: ctx.userId, action: "message.deleted_by_moderator", targetType: "message", targetId: row.id, details: { authorUserId: row.authorUserId, channelId: channel.id } });
  await notifyWorkspace(c.env, channel.workspaceId, { type: "message.deleted", channelId: channel.id, messageId: row.id, sequence: row.channelSequence }, channel.id);
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

const MAX_PINS = 50;

/** Moderators pin in channels; in a DM, both people can. */
function canPin(access: { permissions: number; ctx: { workspace: { kind: string } } }): boolean {
  return access.ctx.workspace.kind === "dm" || hasPermission(access.permissions, Permission.MANAGE_MESSAGES);
}

channelRoutes.get("/:channelId/pins", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel } = await requireChannelAccess(db, c.req.param("channelId"), user.id);
  const rows = await db.query.messages.findMany({
    where: and(eq(schema.messages.channelId, channel.id), isNull(schema.messages.deletedAt), isNotNull(schema.messages.pinnedAt)),
    orderBy: desc(schema.messages.pinnedAt),
    limit: MAX_PINS,
  });
  return c.json(await hydrateMessages(db, rows, user.id));
});

channelRoutes.put("/:channelId/messages/:messageId/pin", async (c) => setPinned(c, true));
channelRoutes.delete("/:channelId/messages/:messageId/pin", async (c) => setPinned(c, false));

async function setPinned(c: Context<AppEnv>, pinned: boolean) {
  const db = c.get("db");
  const user = c.get("user");
  const access = await requireChannelAccess(db, c.req.param("channelId")!, user.id);
  if (!canPin(access)) throw ApiError.forbidden("You need the Manage messages permission to pin");
  const row = await db.query.messages.findFirst({ where: and(eq(schema.messages.id, c.req.param("messageId")!), eq(schema.messages.channelId, access.channel.id)) });
  if (!row || row.deletedAt) throw ApiError.notFound("Message");
  if (pinned && !row.pinnedAt) {
    const [count] = await db.select({ n: sql<number>`count(*)` }).from(schema.messages).where(and(eq(schema.messages.channelId, access.channel.id), isNotNull(schema.messages.pinnedAt), isNull(schema.messages.deletedAt)));
    if (Number(count?.n ?? 0) >= MAX_PINS) throw ApiError.conflict(`A channel can have up to ${MAX_PINS} pinned messages. Unpin one first.`);
  }
  await db
    .update(schema.messages)
    .set(pinned ? { pinnedAt: row.pinnedAt ?? new Date(), pinnedBy: row.pinnedBy ?? user.id } : { pinnedAt: null, pinnedBy: null })
    .where(eq(schema.messages.id, row.id));
  const message = (await loadMessage(db, row.id, user.id))!;
  await notifyWorkspace(c.env, access.channel.workspaceId, { type: "message.updated", message }, access.channel.id);
  return c.json(message);
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

const reactionBody = z.object({ emoji: emojiSchema });

channelRoutes.put("/:channelId/messages/:messageId/reactions", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel } = await requireChannelAccess(db, c.req.param("channelId"), user.id, Permission.ADD_REACTIONS);
  checkRateLimit(`react:${user.id}`, 40, 10_000);
  const { emoji } = await parseBody(c, reactionBody);
  const row = await db.query.messages.findFirst({ where: and(eq(schema.messages.id, c.req.param("messageId")), eq(schema.messages.channelId, channel.id)) });
  if (!row || row.deletedAt) throw ApiError.notFound("Message");
  await db.insert(schema.messageReactions).values({ messageId: row.id, userId: user.id, emoji, createdAt: new Date() }).onConflictDoNothing();
  const reactions = await reactionSummary(db, row.id, user.id);
  await notifyWorkspace(c.env, channel.workspaceId, { type: "reaction.updated", channelId: channel.id, messageId: row.id, reactions }, channel.id);
  return c.json(reactions);
});

channelRoutes.delete("/:channelId/messages/:messageId/reactions/:emoji", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel } = await requireChannelAccess(db, c.req.param("channelId"), user.id);
  const emoji = decodeURIComponent(c.req.param("emoji"));
  await db.delete(schema.messageReactions).where(and(eq(schema.messageReactions.messageId, c.req.param("messageId")), eq(schema.messageReactions.userId, user.id), eq(schema.messageReactions.emoji, emoji)));
  const reactions = await reactionSummary(db, c.req.param("messageId"), user.id);
  await notifyWorkspace(c.env, channel.workspaceId, { type: "reaction.updated", channelId: channel.id, messageId: c.req.param("messageId"), reactions }, channel.id);
  return c.json(reactions);
});

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

channelRoutes.post("/:channelId/read", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel } = await requireChannelAccess(db, c.req.param("channelId"), user.id);
  const { sequence } = await parseBody(c, readSchema);
  await db
    .insert(schema.channelReadStates)
    .values({ userId: user.id, channelId: channel.id, lastReadSequence: sequence, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.channelReadStates.userId, schema.channelReadStates.channelId], set: { lastReadSequence: sequence, updatedAt: new Date() } });
  return c.json({ ok: true });
});
