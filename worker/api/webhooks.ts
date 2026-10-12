/**
 * Incoming webhooks: a secret URL that posts into one channel.
 *
 * The URL speaks Discord's execute-webhook format, so tools with Discord support
 * (GitHub Actions, Grafana, Sentry, Uptime Kuma, Home Assistant...) work as they are.
 * `/slack` takes Slack's format and `/github` takes GitHub's own deliveries.
 */
import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { UserSummary, Webhook, WebhookSecrets } from "@shared/types";
import { newId } from "@shared/id";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_UPLOAD_BYTES, MESSAGE_MAX_LENGTH, displayNameSchema, idSchema } from "@shared/schemas";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema, type Db } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { audit } from "../lib/audit";
import { hubFor, notifyWorkspace } from "../lib/hub";
import { iso, isoRequired, toUserSummary } from "../lib/serialize";
import { loadMessage, softDeleteMessage } from "../lib/messages";
import { Permission, hasPermission, loadChannelAccess, requireMember, requirePermission } from "../permissions/resolve";
import { decryptSecret, encryptSecret, hmacSha256Hex, randomToken, sha256Hex, timingSafeEqual } from "../lib/crypto";
import { createAppUser, retireAppUser } from "../integrations/app-users";
import { normalizeEmbeds, proxiedImage } from "../integrations/embeds";
import { fromDiscord, fromSlack, type IncomingMessage } from "../integrations/incoming";
import { formatGitHubEvent } from "../integrations/github-format";
import { safeServeType, sanitizeFilename, sniffMimeType, validateFilename } from "../uploads/r2";

type WebhookRow = typeof schema.webhooks.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

const MAX_WEBHOOKS_PER_WORKSPACE = 50;

function toWebhook(row: WebhookRow, user: UserRow | undefined, creator: UserRow | undefined): Webhook {
  const summary: UserSummary | null = user ? toUserSummary(user) : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    name: summary?.displayName ?? "Webhook",
    avatarUrl: summary?.avatarUrl ?? null,
    allowEveryone: row.allowEveryone,
    createdBy: creator ? toUserSummary(creator) : null,
    createdAt: isoRequired(row.createdAt),
    lastUsedAt: iso(row.lastUsedAt),
  };
}

async function loadWebhooks(db: Db, rows: WebhookRow[]): Promise<Webhook[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.userId, r.createdBy]))];
  const users = ids.length ? await db.select().from(schema.users).where(inArray(schema.users.id, ids)) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => toWebhook(r, byId.get(r.userId), byId.get(r.createdBy)));
}

function secretsFor(origin: string, webhook: Webhook, token: string, secret: string): WebhookSecrets {
  const url = `${origin}/api/webhooks/${webhook.id}/${token}`;
  return { webhook, url, slackUrl: `${url}/slack`, githubUrl: `${url}/github`, secret };
}

// ---------------------------------------------------------------------------
// Managing webhooks (workspace settings)
// ---------------------------------------------------------------------------

export const webhookAdminRoutes = new Hono<AppEnv>();
webhookAdminRoutes.use("*", requireUser);

const createWebhookSchema = z.object({ channelId: idSchema, name: displayNameSchema });
const updateWebhookSchema = z.object({
  name: displayNameSchema.optional(),
  channelId: idSchema.optional(),
  /** An image the caller uploaded with purpose "avatar", or null to clear it. */
  avatarKey: z.string().max(256).nullable().optional(),
});

webhookAdminRoutes.get("/:workspaceId/webhooks", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_INTEGRATIONS, "Manage integrations");
  const rows = await db.select().from(schema.webhooks).where(eq(schema.webhooks.workspaceId, ctx.workspaceId)).orderBy(desc(schema.webhooks.createdAt));
  return c.json(await loadWebhooks(db, rows));
});

webhookAdminRoutes.post("/:workspaceId/webhooks", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const ctx = await requireMember(db, c.req.param("workspaceId"), user.id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_INTEGRATIONS, "Manage integrations");
  if (ctx.workspace.kind === "dm") throw ApiError.forbidden("Direct messages can't have webhooks");
  const input = await parseBody(c, createWebhookSchema);
  const access = await loadChannelAccess(db, input.channelId, user.id);
  if (!access || access.channel.workspaceId !== ctx.workspaceId || !hasPermission(access.permissions, Permission.VIEW_CHANNEL)) throw ApiError.notFound("Channel");
  if (access.channel.kind !== "text") throw ApiError.validation(undefined, "Webhooks post into text channels");
  const existing = await db.select({ id: schema.webhooks.id }).from(schema.webhooks).where(eq(schema.webhooks.workspaceId, ctx.workspaceId));
  if (existing.length >= MAX_WEBHOOKS_PER_WORKSPACE) throw ApiError.conflict(`A workspace can have up to ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks`);

  const appUser = await createAppUser(db, { kind: "webhook", name: input.name });
  const token = randomToken();
  const secret = randomToken(24);
  const [row] = await db
    .insert(schema.webhooks)
    .values({
      id: newId(),
      workspaceId: ctx.workspaceId,
      channelId: access.channel.id,
      userId: appUser.id,
      tokenHash: await sha256Hex(token),
      secret: await encryptSecret(c.env, secret),
      allowEveryone: hasPermission(access.permissions, Permission.MENTION_EVERYONE),
      createdBy: user.id,
      createdAt: new Date(),
    })
    .returning();
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: user.id, action: "webhook.created", targetType: "webhook", targetId: row!.id, details: { name: input.name, channelId: access.channel.id } });
  return c.json(secretsFor(c.get("origin"), toWebhook(row!, appUser, user), token, secret), 201);
});

async function requireManagedWebhook(c: Context<AppEnv>): Promise<{ row: WebhookRow; ctxUserId: string }> {
  const db = c.get("db");
  const row = await db.query.webhooks.findFirst({ where: and(eq(schema.webhooks.id, c.req.param("webhookId")!), eq(schema.webhooks.workspaceId, c.req.param("workspaceId")!)) });
  if (!row) throw ApiError.notFound("Webhook");
  const ctx = await requireMember(db, row.workspaceId, c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_INTEGRATIONS, "Manage integrations");
  return { row, ctxUserId: ctx.userId };
}

webhookAdminRoutes.patch("/:workspaceId/webhooks/:webhookId", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { row } = await requireManagedWebhook(c);
  const input = await parseBody(c, updateWebhookSchema);
  const changes: Partial<WebhookRow> = {};
  if (input.channelId && input.channelId !== row.channelId) {
    const access = await loadChannelAccess(db, input.channelId, user.id);
    if (!access || access.channel.workspaceId !== row.workspaceId || !hasPermission(access.permissions, Permission.VIEW_CHANNEL)) throw ApiError.notFound("Channel");
    if (access.channel.kind !== "text") throw ApiError.validation(undefined, "Webhooks post into text channels");
    changes.channelId = access.channel.id;
  }
  if (Object.keys(changes).length) await db.update(schema.webhooks).set(changes).where(eq(schema.webhooks.id, row.id));
  const userChanges: Partial<UserRow> = {};
  if (input.name) userChanges.displayName = input.name;
  if (input.avatarKey !== undefined) {
    if (input.avatarKey !== null && !input.avatarKey.startsWith(`avatars/${user.id}/`)) throw ApiError.validation(undefined, "Upload the image first");
    userChanges.avatarKey = input.avatarKey;
  }
  if (Object.keys(userChanges).length) await db.update(schema.users).set({ ...userChanges, updatedAt: new Date() }).where(eq(schema.users.id, row.userId));
  await audit(db, { workspaceId: row.workspaceId, actorUserId: user.id, action: "webhook.updated", targetType: "webhook", targetId: row.id, details: { ...input } });
  const updated = (await db.query.webhooks.findFirst({ where: eq(schema.webhooks.id, row.id) }))!;
  return c.json((await loadWebhooks(db, [updated]))[0]);
});

/** A new URL and secret. The old URL stops working at once. */
webhookAdminRoutes.post("/:workspaceId/webhooks/:webhookId/regenerate", async (c) => {
  const db = c.get("db");
  const { row } = await requireManagedWebhook(c);
  const token = randomToken();
  const secret = randomToken(24);
  await db.update(schema.webhooks).set({ tokenHash: await sha256Hex(token), secret: await encryptSecret(c.env, secret) }).where(eq(schema.webhooks.id, row.id));
  await audit(db, { workspaceId: row.workspaceId, actorUserId: c.get("user").id, action: "webhook.updated", targetType: "webhook", targetId: row.id, details: { regenerated: true } });
  const [webhook] = await loadWebhooks(db, [row]);
  return c.json(secretsFor(c.get("origin"), webhook!, token, secret));
});

webhookAdminRoutes.delete("/:workspaceId/webhooks/:webhookId", async (c) => {
  const db = c.get("db");
  const { row } = await requireManagedWebhook(c);
  await deleteWebhook(db, row);
  await audit(db, { workspaceId: row.workspaceId, actorUserId: c.get("user").id, action: "webhook.deleted", targetType: "webhook", targetId: row.id });
  return c.body(null, 204);
});

async function deleteWebhook(db: Db, row: WebhookRow): Promise<void> {
  await db.delete(schema.webhooks).where(eq(schema.webhooks.id, row.id));
  await retireAppUser(db, row.userId);
}

// ---------------------------------------------------------------------------
// Posting (public: the secret URL is the permission)
// ---------------------------------------------------------------------------

export const webhookRoutes = new Hono<AppEnv>();

/** Errors in Discord's shape, which webhook tools know how to read. */
function discordError(c: Context<AppEnv>, status: number, message: string, code: number, extra: Record<string, unknown> = {}) {
  return c.json({ message, code, ...extra }, status as 400);
}

async function findWebhook(db: Db, id: string, token: string): Promise<WebhookRow | null> {
  if (!id || !token || token.length > 128) return null;
  const row = await db.query.webhooks.findFirst({ where: eq(schema.webhooks.id, id) });
  if (!row) return null;
  return timingSafeEqual(row.tokenHash, await sha256Hex(token)) ? row : null;
}

webhookRoutes.get("/:id/:token", async (c) => {
  const db = c.get("db");
  const row = await findWebhook(db, c.req.param("id"), c.req.param("token"));
  if (!row) return discordError(c, 404, "Unknown Webhook", 10015);
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) });
  return c.json({ id: row.id, type: 1, name: user?.displayName ?? "Webhook", avatar: null, channel_id: row.channelId, guild_id: row.workspaceId, application_id: null, token: c.req.param("token") });
});

webhookRoutes.delete("/:id/:token", async (c) => {
  const db = c.get("db");
  const row = await findWebhook(db, c.req.param("id"), c.req.param("token"));
  if (!row) return discordError(c, 404, "Unknown Webhook", 10015);
  await deleteWebhook(db, row);
  await audit(db, { workspaceId: row.workspaceId, actorUserId: row.userId, action: "webhook.deleted", targetType: "webhook", targetId: row.id, details: { byToken: true } });
  return c.body(null, 204);
});

webhookRoutes.post("/:id/:token", (c) => execute(c, "discord"));
webhookRoutes.post("/:id/:token/slack", (c) => execute(c, "slack"));
webhookRoutes.post("/:id/:token/github", (c) => execute(c, "github"));

type Format = "discord" | "slack" | "github";

interface ParsedBody {
  incoming: IncomingMessage | null;
  files: File[];
  /** Why nothing was posted, for events we skip (e.g. GitHub's "labeled"). */
  skipped?: boolean;
}

async function readBody(c: Context<AppEnv>, format: Format, row: WebhookRow): Promise<ParsedBody | Response> {
  const type = c.req.header("content-type") ?? "";
  if (format === "github") {
    const raw = await c.req.text();
    const signature = c.req.header("x-hub-signature-256") ?? "";
    const secret = await decryptSecret(c.env, row.secret);
    if (!signature) return c.json({ message: "Signature missing. Paste this webhook's secret into GitHub's Secret field." }, 401);
    if (!timingSafeEqual(signature, `sha256=${await hmacSha256Hex(secret, raw)}`)) return c.json({ message: "Signature doesn't match this webhook's secret." }, 401);
    let payload: unknown;
    try {
      payload = type.includes("application/x-www-form-urlencoded") ? JSON.parse(new URLSearchParams(raw).get("payload") ?? "") : JSON.parse(raw);
    } catch {
      return c.json({ message: "Body must be JSON" }, 400);
    }
    const formatted = formatGitHubEvent(c.req.header("x-github-event") ?? "", payload);
    if (!formatted) return { incoming: null, files: [], skipped: true };
    return { incoming: { content: formatted.content, embeds: formatted.embeds, allowMentions: false }, files: [] };
  }
  let json: unknown;
  const files: File[] = [];
  try {
    if (type.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const payload = form.get("payload_json");
      json = typeof payload === "string" ? JSON.parse(payload) : Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
      for (const [key, value] of form.entries()) if (typeof value !== "string" && /^(files\[\d+\]|file\d*)$/.test(key)) files.push(value);
    } else {
      json = await c.req.json();
    }
  } catch {
    return discordError(c, 400, "Body must be JSON, or multipart with payload_json", 50109);
  }
  return { incoming: format === "slack" ? fromSlack(json) : fromDiscord(json), files };
}

/** Stores a webhook's uploaded files as ready attachments on its next message. */
async function storeFiles(c: Context<AppEnv>, row: WebhookRow, files: File[]): Promise<string[] | Response> {
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) return discordError(c, 400, `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`, 50045);
  const db = c.get("db");
  const ids: string[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) return discordError(c, 413, "File too large", 40005);
    const filename = sanitizeFilename(file.name || "file");
    if (!validateFilename(filename).ok) return discordError(c, 400, `${filename} isn't an allowed file type`, 50035);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = safeServeType(sniffMimeType(bytes.subarray(0, 64)) ?? (file.type || "application/octet-stream"));
    const id = newId();
    const key = `attachments/${row.workspaceId}/${row.channelId}/${id}/${filename}`;
    await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: mimeType } });
    await db.insert(schema.messageAttachments).values({ id, messageId: null, workspaceId: row.workspaceId, channelId: row.channelId, uploaderUserId: row.userId, r2Key: key, filename, mimeType, byteSize: file.size, status: "ready", createdAt: new Date() });
    ids.push(id);
  }
  return ids;
}

async function execute(c: Context<AppEnv>, format: Format) {
  const db = c.get("db");
  const row = await findWebhook(db, c.req.param("id")!, c.req.param("token")!);
  if (!row) return discordError(c, 404, "Unknown Webhook", 10015);

  const parsed = await readBody(c, format, row);
  if (parsed instanceof Response) return parsed;
  if (parsed.skipped || !parsed.incoming) return c.body(null, 204);
  const { incoming } = parsed;

  const embeds = await normalizeEmbeds(c.env, incoming.embeds);
  if (!incoming.content.trim() && embeds.length === 0 && parsed.files.length === 0) return discordError(c, 400, "Cannot send an empty message", 50006);
  if (incoming.content.length > MESSAGE_MAX_LENGTH) return discordError(c, 400, `Content is limited to ${MESSAGE_MAX_LENGTH} characters`, 50035);
  const attachmentIds = parsed.files.length ? await storeFiles(c, row, parsed.files) : [];
  if (attachmentIds instanceof Response) return attachmentIds;

  const idempotency = c.req.header("x-github-delivery") ?? c.req.header("idempotency-key") ?? crypto.randomUUID();
  const permissions = Permission.SEND_MESSAGES | Permission.ATTACH_FILES | (row.allowEveryone ? Permission.MENTION_EVERYONE : 0);
  const result = await hubFor(c.env, row.workspaceId).createMessage({
    userId: row.userId,
    channelId: row.channelId,
    content: incoming.content,
    clientMessageId: `wh:${idempotency}`.slice(0, 64),
    attachmentIds,
    replyTo: null,
    threadRootId: c.req.query("thread_id") ?? null,
    integration: { permissions, webhookId: row.id },
    authorName: incoming.username ?? null,
    authorAvatarUrl: incoming.avatarUrl ? ((await proxiedImage(c.env, incoming.avatarUrl)) ?? null) : null,
    embeds,
    suppressMentions: !incoming.allowMentions,
  });
  c.executionCtx.waitUntil(db.update(schema.webhooks).set({ lastUsedAt: new Date() }).where(eq(schema.webhooks.id, row.id)).then(() => undefined));
  if (!result.ok) {
    if (result.status === 429) {
      c.header("Retry-After", "60");
      return discordError(c, 429, "You are being rate limited.", 0, { retry_after: 60, global: false });
    }
    if (result.status === 404) return discordError(c, 404, "Unknown Channel", 10003);
    return discordError(c, result.status, result.message, 50035);
  }
  return c.req.query("wait") === "true" ? c.json(result.message) : c.body(null, 204);
}

// Editing and deleting the webhook's own messages, as Discord allows with the token.

const editWebhookMessageSchema = z.object({ content: z.string().max(MESSAGE_MAX_LENGTH).optional(), embeds: z.array(z.unknown()).optional() });

async function webhookMessage(c: Context<AppEnv>) {
  const db = c.get("db");
  const row = await findWebhook(db, c.req.param("id")!, c.req.param("token")!);
  if (!row) return { error: discordError(c, 404, "Unknown Webhook", 10015) } as const;
  const message = await db.query.messages.findFirst({ where: and(eq(schema.messages.id, c.req.param("messageId")!), eq(schema.messages.webhookId, row.id), isNull(schema.messages.deletedAt)) });
  if (!message) return { error: discordError(c, 404, "Unknown Message", 10008) } as const;
  return { row, message } as const;
}

webhookRoutes.patch("/:id/:token/messages/:messageId", async (c) => {
  const db = c.get("db");
  const found = await webhookMessage(c);
  if ("error" in found) return found.error;
  const input = await parseBody(c, editWebhookMessageSchema);
  const changes: Partial<typeof schema.messages.$inferInsert> = { editedAt: new Date() };
  if (input.content !== undefined) changes.content = input.content.trim();
  if (input.embeds !== undefined) {
    const embeds = await normalizeEmbeds(c.env, input.embeds);
    changes.embeds = embeds.length ? embeds : null;
  }
  const content = changes.content ?? found.message.content;
  const hasEmbeds = changes.embeds !== undefined ? !!changes.embeds : !!found.message.embeds?.length;
  if (!content && !hasEmbeds) return discordError(c, 400, "Cannot send an empty message", 50006);
  await db.update(schema.messages).set(changes).where(eq(schema.messages.id, found.message.id));
  const message = (await loadMessage(db, found.message.id, found.row.userId))!;
  await notifyWorkspace(c.env, found.row.workspaceId, { type: "message.updated", message }, found.message.channelId);
  return c.json(message);
});

webhookRoutes.delete("/:id/:token/messages/:messageId", async (c) => {
  const db = c.get("db");
  const found = await webhookMessage(c);
  if ("error" in found) return found.error;
  const keys = await softDeleteMessage(db, found.message.id);
  if (keys.length) await c.env.BACKGROUND_QUEUE.send({ type: "message.deleted", attachmentKeys: keys });
  await notifyWorkspace(c.env, found.row.workspaceId, { type: "message.deleted", channelId: found.message.channelId, messageId: found.message.id, sequence: found.message.channelSequence }, found.message.channelId);
  return c.body(null, 204);
});
