import { Hono } from "hono";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
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
import { chunked } from "../lib/chunks";

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
  const { channels } = await moderatedChannels(c.get("db"), c.req.param("workspaceId"), c.get("user").id);
  const names = new Map(channels.map((ch) => [ch.id, ch.name]));
  // Filter by workspace in SQL and by moderated channel here (a channel list could pass D1's parameter limit).
  const all = await listReports(c.get("db"), eq(schema.messageReports.workspaceId, c.req.param("workspaceId")), (id) => names.get(id) ?? "unknown");
  return c.json(all.filter((r) => names.has(r.channelId)));
});

/** Open reports matching `where`, grouped by message. */
export async function listReports(db: AppEnv["Variables"]["db"], where: SQL, channelName: (channelId: string) => string): Promise<ReportedMessage[]> {
  const rows = await db
    .select()
    .from(schema.messageReports)
    .where(and(eq(schema.messageReports.status, "open"), where))
    .orderBy(asc(schema.messageReports.createdAt))
    .limit(500);

  const userIds = [...new Set(rows.flatMap((r) => [r.authorUserId, r.reporterUserId]))];
  const messageIds = [...new Set(rows.map((r) => r.messageId))];
  const [users, messages] = await Promise.all([
    chunked(userIds, (ids) => db.select().from(schema.users).where(inArray(schema.users.id, ids))),
    chunked(messageIds, (ids) => db.select({ id: schema.messages.id, deletedAt: schema.messages.deletedAt }).from(schema.messages).where(inArray(schema.messages.id, ids))),
  ]);
  const userById = new Map(users.map((u) => [u.id, toUserSummary(u)]));
  const deleted = new Set(messages.filter((m) => m.deletedAt).map((m) => m.id));

  const byMessage = new Map<string, ReportedMessage>();
  for (const r of rows) {
    let entry = byMessage.get(r.messageId);
    if (!entry) {
      entry = {
        messageId: r.messageId,
        channelId: r.channelId,
        channelName: channelName(r.channelId),
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
  return [...byMessage.values()];
}

reportQueueRoutes.post("/:workspaceId/reports/:messageId/resolve", async (c) => {
  const db = c.get("db");
  const { ctx, channels } = await moderatedChannels(db, c.req.param("workspaceId"), c.get("user").id);
  const { action } = await parseBody(c, resolveReportSchema);
  const allowed = new Set(channels.map((ch) => ch.id));
  await resolveReports(c.env, db, { messageId: c.req.param("messageId"), action, actorUserId: ctx.userId, canResolve: async (report) => allowed.has(report.channelId) });
  return c.body(null, 204);
});

/** Close every open report on a message, optionally deleting the message. */
export async function resolveReports(
  env: AppEnv["Bindings"],
  db: AppEnv["Variables"]["db"],
  opts: { messageId: string; action: "remove" | "dismiss"; actorUserId: string; canResolve: (report: { channelId: string; workspaceId: string }) => Promise<boolean> },
): Promise<void> {
  const open = await db.query.messageReports.findFirst({ where: and(eq(schema.messageReports.messageId, opts.messageId), eq(schema.messageReports.status, "open")) });
  if (!open || !(await opts.canResolve(open))) throw ApiError.notFound("Report");

  if (opts.action === "remove") {
    const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, opts.messageId) });
    if (message && !message.deletedAt) {
      const keys = await softDeleteMessage(db, message.id);
      if (keys.length) await env.BACKGROUND_QUEUE.send({ type: "message.deleted", attachmentKeys: keys });
      await notifyWorkspace(env, open.workspaceId, { type: "message.deleted", channelId: message.channelId, messageId: message.id, sequence: message.channelSequence }, message.channelId);
    }
  }
  await db
    .update(schema.messageReports)
    .set({ status: opts.action === "remove" ? "removed" : "dismissed", resolvedBy: opts.actorUserId, resolvedAt: new Date() })
    .where(and(eq(schema.messageReports.messageId, opts.messageId), eq(schema.messageReports.status, "open")));
  await audit(db, {
    workspaceId: open.workspaceId,
    actorUserId: opts.actorUserId,
    action: opts.action === "remove" ? "report.removed" : "report.dismissed",
    targetType: "message",
    targetId: opts.messageId,
    details: { authorUserId: open.authorUserId, channelId: open.channelId },
  });
  await notifyWorkspace(env, open.workspaceId, { type: "workspace.updated", reason: "reports" });
}
