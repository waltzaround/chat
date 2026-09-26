import { Hono } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { audit } from "../lib/audit";
import { notifyWorkspace } from "../lib/hub";
import { softDeleteMessage } from "../lib/messages";
import { isoRequired, toUserSummary } from "../lib/serialize";
import { checkRateLimit } from "../security/ratelimit";
import { Permission, hasPermission, requireChannelAccess, requireMember, resolveAllChannelPermissions } from "../permissions/resolve";
import { newId } from "@shared/id";
import { reportMessageSchema, resolveReportSchema } from "@shared/schemas";
import type { ReportReason, ReportedMessage } from "@shared/types";

/** POST /api/channels/:channelId/messages/:messageId/report: anyone who can see a message can flag it. */
export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use("*", requireUser);

reportRoutes.post("/:channelId/messages/:messageId/report", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel } = await requireChannelAccess(db, c.req.param("channelId"), user.id);
  const message = await db.query.messages.findFirst({ where: and(eq(schema.messages.id, c.req.param("messageId")), eq(schema.messages.channelId, channel.id)) });
  if (!message || message.deletedAt) throw ApiError.notFound("Message");
  if (message.authorUserId === user.id) throw ApiError.validation(undefined, "You cannot report your own message");
  checkRateLimit(`report:${user.id}`, 10, 60 * 60 * 1000);
  const input = await parseBody(c, reportMessageSchema);

  // Reporting twice is a no-op, so a double click never errors.
  await db
    .insert(schema.messageReports)
    .values({
      id: newId(),
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      messageId: message.id,
      authorUserId: message.authorUserId,
      reporterUserId: user.id,
      reason: input.reason,
      note: input.note || null,
      contentSnapshot: message.content,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  await notifyWorkspace(c.env, channel.workspaceId, { type: "workspace.updated", reason: "reports" });
  return c.body(null, 204);
});

/** The moderation queue: /api/workspaces/:workspaceId/reports. */
export const reportQueueRoutes = new Hono<AppEnv>();
reportQueueRoutes.use("*", requireUser);

/** Channels where this member may moderate: they can see them and manage messages there. */
async function moderatedChannels(db: AppEnv["Variables"]["db"], workspaceId: string, userId: string) {
  const ctx = await requireMember(db, workspaceId, userId);
  const all = await resolveAllChannelPermissions(db, ctx);
  const channels = [...all.values()].filter((e) => hasPermission(e.permissions, Permission.VIEW_CHANNEL | Permission.MANAGE_MESSAGES)).map((e) => e.channel);
  if (channels.length === 0) throw ApiError.forbidden("You cannot moderate messages in this workspace");
  return { ctx, channels };
}

reportQueueRoutes.get("/:workspaceId/reports", async (c) => {
  const db = c.get("db");
  const { channels } = await moderatedChannels(db, c.req.param("workspaceId"), c.get("user").id);
  const rows = await db
    .select()
    .from(schema.messageReports)
    .where(and(eq(schema.messageReports.status, "open"), inArray(schema.messageReports.channelId, channels.map((ch) => ch.id))))
    .orderBy(asc(schema.messageReports.createdAt))
    .limit(500);

  const userIds = [...new Set(rows.flatMap((r) => [r.authorUserId, r.reporterUserId]))];
  const messageIds = [...new Set(rows.map((r) => r.messageId))];
  const [users, messages] = await Promise.all([
    userIds.length ? db.select().from(schema.users).where(inArray(schema.users.id, userIds)) : [],
    messageIds.length ? db.select({ id: schema.messages.id, deletedAt: schema.messages.deletedAt }).from(schema.messages).where(inArray(schema.messages.id, messageIds)) : [],
  ]);
  const userById = new Map(users.map((u) => [u.id, toUserSummary(u)]));
  const deleted = new Set(messages.filter((m) => m.deletedAt).map((m) => m.id));
  const channelName = new Map(channels.map((ch) => [ch.id, ch.name]));

  const byMessage = new Map<string, ReportedMessage>();
  for (const r of rows) {
    let entry = byMessage.get(r.messageId);
    if (!entry) {
      entry = {
        messageId: r.messageId,
        channelId: r.channelId,
        channelName: channelName.get(r.channelId) ?? "unknown",
        author: userById.get(r.authorUserId) ?? null,
        content: r.contentSnapshot,
        messageDeleted: deleted.has(r.messageId),
        firstReportedAt: isoRequired(r.createdAt),
        reports: [],
      };
      byMessage.set(r.messageId, entry);
    }
    entry.reports.push({ reporter: userById.get(r.reporterUserId) ?? null, reason: r.reason as ReportReason, note: r.note, createdAt: isoRequired(r.createdAt) });
  }
  return c.json([...byMessage.values()]);
});

reportQueueRoutes.post("/:workspaceId/reports/:messageId/resolve", async (c) => {
  const db = c.get("db");
  const { ctx, channels } = await moderatedChannels(db, c.req.param("workspaceId"), c.get("user").id);
  const { action } = await parseBody(c, resolveReportSchema);
  const messageId = c.req.param("messageId");
  const open = await db.query.messageReports.findFirst({ where: and(eq(schema.messageReports.messageId, messageId), eq(schema.messageReports.status, "open")) });
  if (!open || !channels.some((ch) => ch.id === open.channelId)) throw ApiError.notFound("Report");

  if (action === "remove") {
    const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    if (message && !message.deletedAt) {
      const keys = await softDeleteMessage(db, message.id);
      if (keys.length) await c.env.BACKGROUND_QUEUE.send({ type: "message.deleted", attachmentKeys: keys });
      await notifyWorkspace(c.env, ctx.workspaceId, { type: "message.deleted", channelId: message.channelId, messageId: message.id, sequence: message.channelSequence }, message.channelId);
    }
  }
  await db
    .update(schema.messageReports)
    .set({ status: action === "remove" ? "removed" : "dismissed", resolvedBy: ctx.userId, resolvedAt: new Date() })
    .where(and(eq(schema.messageReports.messageId, messageId), eq(schema.messageReports.status, "open")));
  await audit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    action: action === "remove" ? "report.removed" : "report.dismissed",
    targetType: "message",
    targetId: messageId,
    details: { authorUserId: open.authorUserId, channelId: open.channelId },
  });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "reports" });
  return c.body(null, 204);
});
