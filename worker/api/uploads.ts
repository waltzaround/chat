import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { checkRateLimit } from "../security/ratelimit";
import { track } from "../analytics/track";
import { Permission, loadChannelAccess, loadMemberContext, hasPermission } from "../permissions/resolve";
import { canPresign, isInlineType, presignPut, safeServeType, sanitizeFilename, sniffMimeType, UPLOAD_URL_TTL_SECONDS, validateFilename } from "../uploads/r2";
import { toAttachment } from "../lib/messages";
import { newId } from "@shared/id";
import { MAX_UPLOAD_BYTES, uploadAuthorizeSchema, uploadCompleteSchema } from "@shared/schemas";
import type { UploadAuthorization } from "@shared/types";

export const uploadRoutes = new Hono<AppEnv>();
uploadRoutes.use("*", requireUser);

const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const EMOJI_MAX_BYTES = 256 * 1024;

uploadRoutes.post("/authorize", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  checkRateLimit(`upload:${user.id}`, 30, 60_000);
  const input = await parseBody(c, uploadAuthorizeSchema);
  const filename = sanitizeFilename(input.filename);
  const check = validateFilename(filename);
  if (!check.ok) throw ApiError.validation(undefined, check.reason);

  let key: string;
  let attachmentId: string;
  if (input.purpose === "attachment") {
    const access = await loadChannelAccess(db, input.channelId, user.id);
    if (!access || !hasPermission(access.permissions, Permission.VIEW_CHANNEL)) throw ApiError.notFound("Channel");
    if (!hasPermission(access.permissions, Permission.ATTACH_FILES)) throw ApiError.forbidden("You cannot attach files in this channel");
    attachmentId = newId();
    key = `attachments/${access.channel.workspaceId}/${access.channel.id}/${attachmentId}/${filename}`;
    await db.insert(schema.messageAttachments).values({
      id: attachmentId,
      messageId: null,
      workspaceId: access.channel.workspaceId,
      channelId: access.channel.id,
      uploaderUserId: user.id,
      r2Key: key,
      filename,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      status: "pending",
      createdAt: new Date(),
    });
  } else if (input.purpose === "emoji") {
    if (!input.workspaceId) throw ApiError.validation(undefined, "workspaceId is required for emoji uploads");
    const ctx = await loadMemberContext(db, input.workspaceId, user.id);
    if (!ctx) throw ApiError.notFound("Workspace");
    if (!hasPermission(ctx.basePermissions, Permission.MANAGE_EMOJIS)) throw ApiError.forbidden("You need the Manage emojis permission");
    if (!input.mimeType.startsWith("image/")) throw ApiError.validation(undefined, "Emojis must be images");
    if (input.byteSize > EMOJI_MAX_BYTES) throw new ApiError(413, "payload_too_large", "Emojis are limited to 256 KB");
    key = `emojis/${ctx.workspaceId}/${newId()}`;
    attachmentId = key;
  } else {
    if (!input.mimeType.startsWith("image/")) throw ApiError.validation(undefined, "Avatars and icons must be images");
    if (input.byteSize > AVATAR_MAX_BYTES) throw new ApiError(413, "payload_too_large", "Images are limited to 4 MB");
    const id = newId();
    key = input.purpose === "avatar" ? `avatars/${user.id}/${id}` : `workspace-icons/${user.id}/${id}`;
    attachmentId = key;
  }

  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
  if (canPresign(c.env)) {
    const signed = await presignPut(c.env, key, input.mimeType);
    const body: UploadAuthorization = { attachmentId, uploadUrl: signed.url, headers: signed.headers, mode: "presigned", expiresAt };
    return c.json(body);
  }
  // Dev fallback: the Worker streams the body into R2 via the binding.
  const body: UploadAuthorization = {
    attachmentId,
    uploadUrl: `/api/uploads/put/${encodeURIComponent(attachmentId)}`,
    headers: { "Content-Type": input.mimeType },
    mode: "proxy",
    expiresAt,
  };
  return c.json(body);
});

/** Proxy PUT used only when presigning is not configured (local development). */
uploadRoutes.put("/put/:attachmentId", async (c) => {
  if (canPresign(c.env)) throw ApiError.forbidden("Direct uploads are enabled; use the presigned URL");
  const db = c.get("db");
  const user = c.get("user");
  const attachmentId = decodeURIComponent(c.req.param("attachmentId"));
  const key = await resolveKeyForUpload(db, attachmentId, user.id);
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES) throw new ApiError(413, "payload_too_large", "File is too large");
  await c.env.UPLOADS.put(key, c.req.raw.body, { httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" } });
  return c.json({ ok: true });
});

uploadRoutes.post("/complete", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const input = await parseBody(c, uploadCompleteSchema);
  const key = await resolveKeyForUpload(db, input.attachmentId, user.id);

  const head = await c.env.UPLOADS.head(key);
  if (!head) throw ApiError.validation(undefined, "Upload not found — did the transfer finish?");
  if (head.size > MAX_UPLOAD_BYTES) {
    await c.env.UPLOADS.delete(key);
    throw new ApiError(413, "payload_too_large", "File is too large");
  }

  // Never trust the declared type: sniff the first bytes.
  const sample = await c.env.UPLOADS.get(key, { range: { offset: 0, length: 64 } });
  const bytes = sample ? new Uint8Array(await sample.arrayBuffer()) : new Uint8Array();
  const sniffed = sniffMimeType(bytes);

  const row = key.startsWith("attachments/") ? await db.query.messageAttachments.findFirst({ where: eq(schema.messageAttachments.id, input.attachmentId) }) : null;
  if (row) {
    const declared = row.mimeType.toLowerCase();
    let mimeType = declared;
    if (sniffed && sniffed !== declared) mimeType = sniffed;
    else if (!sniffed && isInlineType(declared) && !declared.startsWith("text/")) mimeType = "application/octet-stream";
    mimeType = safeServeType(mimeType);
    const isImage = mimeType.startsWith("image/");
    const isMedia = mimeType.startsWith("video/") || mimeType.startsWith("audio/");
    const [updated] = await db
      .update(schema.messageAttachments)
      .set({
        status: "ready",
        byteSize: head.size,
        mimeType,
        width: isImage || mimeType.startsWith("video/") ? input.width ?? null : null,
        height: isImage || mimeType.startsWith("video/") ? input.height ?? null : null,
        duration: isMedia ? (input.duration !== undefined ? Math.round(input.duration) : null) : null,
      })
      .where(eq(schema.messageAttachments.id, row.id))
      .returning();
    track(c.env, { name: "upload.complete", workspaceId: row.workspaceId, bytes: head.size, mimeType });
    await c.env.BACKGROUND_QUEUE.send({ type: "attachment.process", attachmentId: row.id });
    return c.json(toAttachment(updated!));
  }

  // Avatar / icon: must really be an image.
  if (!sniffed || !sniffed.startsWith("image/")) {
    await c.env.UPLOADS.delete(key);
    throw ApiError.validation(undefined, "That file is not a supported image");
  }
  return c.json({ key, url: `/api/files/${key}` });
});

async function resolveKeyForUpload(db: AppEnv["Variables"]["db"], attachmentId: string, userId: string): Promise<string> {
  if (attachmentId.startsWith(`avatars/${userId}/`) || attachmentId.startsWith(`workspace-icons/${userId}/`)) return attachmentId;
  if (attachmentId.startsWith("emojis/")) {
    const [, workspaceId] = attachmentId.split("/");
    const ctx = workspaceId ? await loadMemberContext(db, workspaceId, userId) : null;
    if (!ctx || !hasPermission(ctx.basePermissions, Permission.MANAGE_EMOJIS)) throw ApiError.notFound("Upload");
    return attachmentId;
  }
  const row = await db.query.messageAttachments.findFirst({ where: eq(schema.messageAttachments.id, attachmentId) });
  if (!row || row.uploaderUserId !== userId) throw ApiError.notFound("Upload");
  if (row.messageId) throw ApiError.conflict("This upload is already attached to a message");
  return row.r2Key;
}

// ---------------------------------------------------------------------------
// Protected downloads — the bucket is private; every read is authorised here.
// ---------------------------------------------------------------------------

export const fileRoutes = new Hono<AppEnv>();
fileRoutes.use("*", requireUser);

fileRoutes.get("/*", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/files\//, ""));
  if (!key || key.includes("..")) throw ApiError.notFound("File");

  // Attachments are served with the type verified at upload time (never the declared one).
  let verifiedType: string | null = null;
  if (key.startsWith("attachments/")) {
    const [, , channelId] = key.split("/");
    if (!channelId) throw ApiError.notFound("File");
    const access = await loadChannelAccess(db, channelId, user.id);
    if (!access || !hasPermission(access.permissions, Permission.VIEW_CHANNEL)) throw ApiError.notFound("File");
    const row = await db.query.messageAttachments.findFirst({ where: eq(schema.messageAttachments.r2Key, key) });
    if (!row || row.status !== "ready") throw ApiError.notFound("File");
    verifiedType = row.mimeType;
  } else if (key.startsWith("emojis/")) {
    const [, workspaceId] = key.split("/");
    const ctx = workspaceId ? await loadMemberContext(db, workspaceId, user.id) : null;
    if (!ctx) throw ApiError.notFound("File");
  } else if (!key.startsWith("avatars/") && !key.startsWith("workspace-icons/")) {
    throw ApiError.notFound("File");
  }

  const rangeHeader = c.req.header("range");
  const object = await c.env.UPLOADS.get(key, { ...(rangeHeader ? { range: c.req.raw.headers } : {}), onlyIf: c.req.raw.headers });
  if (!object) throw ApiError.notFound("File");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const contentType = safeServeType(verifiedType ?? headers.get("Content-Type") ?? "application/octet-stream");
  headers.set("Content-Type", contentType);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  const filename = key.split("/").pop() ?? "file";
  headers.set("Content-Disposition", `${isInlineType(contentType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`);
  if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers });
  if (rangeHeader && object.range && "offset" in object.range) {
    const start = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - start;
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  headers.set("Accept-Ranges", "bytes");
  return new Response(object.body, { status: 200, headers });
});
