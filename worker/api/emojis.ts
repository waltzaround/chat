import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { audit } from "../lib/audit";
import { notifyWorkspace } from "../lib/hub";
import { fileUrl, isoRequired } from "../lib/serialize";
import { Permission, requireMember, requirePermission } from "../permissions/resolve";
import { newId } from "@shared/id";
import { createEmojiSchema } from "@shared/schemas";
import type { CustomEmoji } from "@shared/types";

export const emojiRoutes = new Hono<AppEnv>();
emojiRoutes.use("*", requireUser);

const MAX_EMOJIS_PER_WORKSPACE = 250;

function toEmoji(row: typeof schema.customEmojis.$inferSelect): CustomEmoji {
  return { id: row.id, workspaceId: row.workspaceId, name: row.name, url: fileUrl(row.r2Key)!, createdBy: row.createdBy, createdAt: isoRequired(row.createdAt) };
}

/** Every member can list the workspace's custom emojis (needed to render messages). */
emojiRoutes.get("/:workspaceId/emojis", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  const rows = await db.query.customEmojis.findMany({ where: eq(schema.customEmojis.workspaceId, ctx.workspaceId), orderBy: asc(schema.customEmojis.name) });
  return c.json(rows.map(toEmoji));
});

emojiRoutes.post("/:workspaceId/emojis", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_EMOJIS, "Manage emojis");
  const input = await parseBody(c, createEmojiSchema);
  // The key must belong to this workspace's emoji prefix and actually exist in the bucket.
  if (!input.key.startsWith(`emojis/${ctx.workspaceId}/`)) throw ApiError.forbidden("Upload does not belong to this workspace");
  const head = await c.env.UPLOADS.head(input.key);
  if (!head) throw ApiError.validation(undefined, "Upload not found — did the transfer finish?");

  const [count] = await db.select({ n: sql<number>`count(*)` }).from(schema.customEmojis).where(eq(schema.customEmojis.workspaceId, ctx.workspaceId));
  if (Number(count?.n ?? 0) >= MAX_EMOJIS_PER_WORKSPACE) throw ApiError.conflict(`Workspaces can have up to ${MAX_EMOJIS_PER_WORKSPACE} custom emojis`);
  const clash = await db.query.customEmojis.findFirst({ where: and(eq(schema.customEmojis.workspaceId, ctx.workspaceId), eq(schema.customEmojis.name, input.name)) });
  if (clash) throw ApiError.conflict(`An emoji named :${input.name}: already exists`);

  const row = { id: newId(), workspaceId: ctx.workspaceId, name: input.name, r2Key: input.key, createdBy: ctx.userId, createdAt: new Date() };
  await db.insert(schema.customEmojis).values(row);
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "emoji.created", targetType: "emoji", targetId: row.id, details: { name: row.name } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "emojis" });
  return c.json(toEmoji(row), 201);
});

emojiRoutes.delete("/:workspaceId/emojis/:emojiId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_EMOJIS, "Manage emojis");
  const row = await db.query.customEmojis.findFirst({ where: and(eq(schema.customEmojis.id, c.req.param("emojiId")), eq(schema.customEmojis.workspaceId, ctx.workspaceId)) });
  if (!row) throw ApiError.notFound("Emoji");
  await db.delete(schema.customEmojis).where(eq(schema.customEmojis.id, row.id));
  await c.env.BACKGROUND_QUEUE.send({ type: "message.deleted", attachmentKeys: [row.r2Key] });
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "emoji.deleted", targetType: "emoji", targetId: row.id, details: { name: row.name } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "emojis" });
  return c.body(null, 204);
});
