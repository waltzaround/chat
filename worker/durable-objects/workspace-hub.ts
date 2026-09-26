/**
 * WorkspaceHub — one Durable Object per workspace.
 *
 * Owns transient realtime coordination: connections, presence, typing,
 * voice-presence summaries and broadcasts. Owns the single-writer message
 * create path (channel_sequence allocation). Persists nothing of its own
 * beyond per-channel sequence counters; D1 is the source of truth.
 *
 * Uses the WebSocket Hibernation API. Everything a connection needs to be
 * restored after hibernation lives in its serialized attachment.
 */
import { DurableObject } from "cloudflare:workers";
import { and, desc, eq, isNull, max, sql } from "drizzle-orm";
import { findFilteredTerm } from "@shared/moderation";
import type { ClientEvent, PresenceEntry, ServerEvent, VoiceParticipantState } from "@shared/events";
import { parseClientEvent, WS_CLOSE } from "@shared/events";
import { Permission, hasPermission } from "@shared/permissions";
import type { Message, PreferredStatus, PresenceStatus } from "@shared/types";
import { newId } from "@shared/id";
import { MESSAGE_MAX_LENGTH } from "@shared/schemas";
import type { Env } from "../env";
import { batchAll, createDb, schema, type Db } from "../db";
import { loadChannelAccess, type ChannelAccess } from "../permissions/resolve";
import { hydrateMessages, loadMessage, loadMessagePage, reactionSummary, softDeleteMessage } from "../lib/messages";
import { track } from "../analytics/track";
import { recordMentions } from "../lib/mentions";
import { notifyUsers } from "../lib/notify";
import type { ApiErrorCode } from "../lib/errors";

interface Attachment {
  userId: string;
  sessionId: string;
  workspaceId: string;
  activeChannelId: string | null;
  status: PreferredStatus;
  voice: (VoiceParticipantState & { channelId: string }) | null;
  connectedAt: number;
}

export interface CreateMessageInput {
  userId: string;
  channelId: string;
  content: string;
  clientMessageId: string;
  attachmentIds: string[];
  replyTo: string | null;
  /** Set when the request originated from a socket so the ack can be routed. */
  originSessionId?: string;
}

export type CreateMessageResult =
  | { ok: true; message: Message; duplicate: boolean }
  | { ok: false; status: number; code: ApiErrorCode; message: string };

const TYPING_TTL_MS = 6_000;
const PRESENCE_COALESCE_MS = 250;
const ACCESS_CACHE_MS = 15_000;
const EVENT_LIMITS: Partial<Record<ClientEvent["type"], { limit: number; windowMs: number }>> = {
  "message.create": { limit: 20, windowMs: 10_000 },
  "message.edit": { limit: 20, windowMs: 10_000 },
  "message.delete": { limit: 20, windowMs: 10_000 },
  "reaction.add": { limit: 40, windowMs: 10_000 },
  "reaction.remove": { limit: 40, windowMs: 10_000 },
  "typing.start": { limit: 15, windowMs: 10_000 },
  "channel.subscribe": { limit: 30, windowMs: 10_000 },
  "channel.read": { limit: 30, windowMs: 10_000 },
};

export class WorkspaceHub extends DurableObject<Env> {
  private db: Db;
  private typing = new Map<string, Map<string, number>>(); // channelId -> userId -> expiresAt
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private presenceDirty = new Set<string>();
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private accessCache = new Map<string, { access: ChannelAccess; expiresAt: number }>();
  private channelLocks = new Map<string, Promise<unknown>>();
  private socketLimits = new WeakMap<WebSocket, Map<string, { count: number; resetAt: number }>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = createDb(env.DB);
    // Heartbeats are answered by the runtime without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(JSON.stringify({ type: "ping" }), JSON.stringify({ type: "pong" })));
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  /** The Worker authenticates the request and forwards identity via headers. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const userId = request.headers.get("x-user-id");
    const sessionId = request.headers.get("x-session-id");
    const workspaceId = request.headers.get("x-workspace-id");
    const status = (request.headers.get("x-user-status") as PreferredStatus | null) ?? "online";
    if (!userId || !sessionId || !workspaceId) return new Response("Missing identity", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const attachment: Attachment = { userId, sessionId, workspaceId, activeChannelId: null, status, voice: null, connectedAt: Date.now() };
    const wasOnline = this.socketsFor(userId).length > 0;
    this.ctx.acceptWebSocket(server, [userId, `session:${sessionId}`]);
    server.serializeAttachment(attachment);

    track(this.env, { name: "ws.connect", workspaceId, reconnect: wasOnline });

    this.send(server, {
      type: "ready",
      sessionId,
      userId,
      workspaceId,
      presence: this.presenceSnapshot(),
      voice: this.voiceSnapshot(),
      serverTime: new Date().toISOString(),
    });
    if (!wasOnline) this.markPresenceDirty(userId);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = this.attachment(ws);
    if (!att) return ws.close(WS_CLOSE.UNAUTHENTICATED, "No session");
    let json: unknown;
    try {
      json = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { type: "error", code: "validation_failed", message: "Malformed frame" });
    }
    const event = parseClientEvent(json);
    if (!event) return this.send(ws, { type: "error", code: "validation_failed", message: "Unknown or invalid event" });
    if (!this.allowEvent(ws, event.type)) {
      return this.send(ws, { type: "error", code: "rate_limited", message: "Slow down", clientMessageId: "clientMessageId" in event ? event.clientMessageId : undefined });
    }
    try {
      await this.handleEvent(ws, att, event);
    } catch (err) {
      console.error("hub event failed", event.type, err);
      this.send(ws, { type: "error", code: "internal_error", message: "Something went wrong", clientMessageId: "clientMessageId" in event ? event.clientMessageId : undefined });
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    void code;
    void reason;
    void wasClean;
    this.handleDisconnect(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.handleDisconnect(ws);
  }

  private handleDisconnect(ws: WebSocket): void {
    const att = this.attachment(ws);
    try {
      ws.close(1000, "bye");
    } catch {
      /* already closed */
    }
    if (!att) return;
    track(this.env, { name: "ws.disconnect", workspaceId: att.workspaceId, durationMs: Date.now() - att.connectedAt });
    const remaining = this.socketsFor(att.userId).filter((s) => s !== ws);
    if (att.activeChannelId) this.clearTyping(att.activeChannelId, att.userId);
    if (att.voice && !remaining.some((s) => this.attachment(s)?.voice?.channelId === att.voice!.channelId)) {
      this.broadcastVoice(att.voice.channelId);
    }
    if (remaining.length === 0) this.markPresenceDirty(att.userId);
  }

  // -------------------------------------------------------------------------
  // Event handling
  // -------------------------------------------------------------------------

  private async handleEvent(ws: WebSocket, att: Attachment, event: ClientEvent): Promise<void> {
    switch (event.type) {
      case "ping":
        return this.send(ws, { type: "pong" });

      case "channel.subscribe": {
        const access = await this.access(att.userId, event.channelId);
        if (!access) return this.send(ws, { type: "error", code: "not_found", message: "Channel not found" });
        if (att.activeChannelId && att.activeChannelId !== event.channelId) this.clearTyping(att.activeChannelId, att.userId);
        att.activeChannelId = event.channelId;
        ws.serializeAttachment(att);
        // Reconnect catch-up: send whatever the client missed.
        const since = event.sinceSequence ?? Math.max(0, access.channel.lastSequence);
        const page = await loadMessagePage(this.db, { channelId: event.channelId, after: since, limit: 100 }, att.userId);
        this.send(ws, {
          type: "channel.sync",
          channelId: event.channelId,
          messages: page.messages,
          complete: !page.hasMore,
          lastSequence: page.messages.at(-1)?.sequence ?? Math.max(since, access.channel.lastSequence),
        });
        // Current typers in the room.
        const typers = this.currentTypers(event.channelId).filter((id) => id !== att.userId);
        if (typers.length) this.send(ws, { type: "typing.updated", channelId: event.channelId, userIds: typers });
        return;
      }

      case "message.create": {
        const result = await this.createMessage({
          userId: att.userId,
          channelId: event.channelId,
          content: event.content,
          clientMessageId: event.clientMessageId,
          attachmentIds: event.attachmentIds ?? [],
          replyTo: event.replyTo ?? null,
          originSessionId: att.sessionId,
        });
        if (!result.ok) {
          return this.send(ws, { type: "error", code: result.code, message: result.message, clientMessageId: event.clientMessageId });
        }
        this.send(ws, { type: "ack", clientMessageId: event.clientMessageId, messageId: result.message.id, sequence: result.message.sequence });
        return;
      }

      case "message.edit": {
        const row = await this.db.query.messages.findFirst({ where: and(eq(schema.messages.id, event.messageId), isNull(schema.messages.deletedAt)) });
        if (!row || row.workspaceId !== att.workspaceId) return this.send(ws, { type: "error", code: "not_found", message: "Message not found" });
        if (row.authorUserId !== att.userId) return this.send(ws, { type: "error", code: "forbidden", message: "You can only edit your own messages" });
        const access = await this.access(att.userId, row.channelId);
        if (!access) return this.send(ws, { type: "error", code: "not_found", message: "Channel not found" });
        const blocked = await this.checkModeration(access, att.userId, event.content, false);
        if (blocked) return this.send(ws, { type: "error", code: blocked.code, message: blocked.message });
        await this.db.update(schema.messages).set({ content: event.content, editedAt: new Date() }).where(eq(schema.messages.id, row.id));
        await recordMentions(this.db, { ...row, content: event.content }, access.permissions, () => this.onlineUserIds());
        const message = await loadMessage(this.db, row.id, att.userId);
        if (message) this.broadcastToChannel(row.channelId, { type: "message.updated", message });
        return;
      }

      case "message.delete": {
        const row = await this.db.query.messages.findFirst({ where: and(eq(schema.messages.id, event.messageId), isNull(schema.messages.deletedAt)) });
        if (!row || row.workspaceId !== att.workspaceId) return this.send(ws, { type: "error", code: "not_found", message: "Message not found" });
        const access = await this.access(att.userId, row.channelId);
        if (!access) return this.send(ws, { type: "error", code: "not_found", message: "Channel not found" });
        const isAuthor = row.authorUserId === att.userId;
        if (!isAuthor && !hasPermission(access.permissions, Permission.MANAGE_MESSAGES)) {
          return this.send(ws, { type: "error", code: "forbidden", message: "You cannot delete this message" });
        }
        const keys = await softDeleteMessage(this.db, row.id);
        if (keys.length) await this.env.BACKGROUND_QUEUE.send({ type: "message.deleted", attachmentKeys: keys });
        if (!isAuthor) {
          await this.db.insert(schema.auditLog).values({ id: newId(), workspaceId: att.workspaceId, actorUserId: att.userId, action: "message.deleted_by_moderator", targetType: "message", targetId: row.id, details: { authorUserId: row.authorUserId, channelId: row.channelId }, createdAt: new Date() });
        }
        this.broadcastToChannel(row.channelId, { type: "message.deleted", channelId: row.channelId, messageId: row.id, sequence: row.channelSequence });
        return;
      }

      case "reaction.add":
      case "reaction.remove": {
        const row = await this.db.query.messages.findFirst({ where: and(eq(schema.messages.id, event.messageId), isNull(schema.messages.deletedAt)) });
        if (!row || row.workspaceId !== att.workspaceId) return this.send(ws, { type: "error", code: "not_found", message: "Message not found" });
        const access = await this.access(att.userId, row.channelId);
        if (!access) return this.send(ws, { type: "error", code: "not_found", message: "Channel not found" });
        if (event.type === "reaction.add") {
          if (!hasPermission(access.permissions, Permission.ADD_REACTIONS)) return this.send(ws, { type: "error", code: "forbidden", message: "You cannot react here" });
          const count = await this.db.select({ n: sql<number>`count(distinct emoji)` }).from(schema.messageReactions).where(eq(schema.messageReactions.messageId, row.id));
          if (Number(count[0]?.n ?? 0) >= 20) return this.send(ws, { type: "error", code: "conflict", message: "Too many distinct reactions" });
          await this.db.insert(schema.messageReactions).values({ messageId: row.id, userId: att.userId, emoji: event.emoji, createdAt: new Date() }).onConflictDoNothing();
        } else {
          await this.db.delete(schema.messageReactions).where(and(eq(schema.messageReactions.messageId, row.id), eq(schema.messageReactions.userId, att.userId), eq(schema.messageReactions.emoji, event.emoji)));
        }
        const reactions = await reactionSummary(this.db, row.id, "");
        this.broadcastToChannel(row.channelId, { type: "reaction.updated", channelId: row.channelId, messageId: row.id, reactions });
        return;
      }

      case "typing.start": {
        if (att.activeChannelId !== event.channelId) return;
        const access = await this.access(att.userId, event.channelId);
        if (!access || !hasPermission(access.permissions, Permission.SEND_MESSAGES)) return;
        const channelTyping = this.typing.get(event.channelId) ?? new Map<string, number>();
        const isNew = !channelTyping.has(att.userId);
        channelTyping.set(att.userId, Date.now() + TYPING_TTL_MS);
        this.typing.set(event.channelId, channelTyping);
        this.scheduleTypingSweep(event.channelId);
        if (isNew) this.broadcastTyping(event.channelId);
        return;
      }

      case "typing.stop":
        this.clearTyping(event.channelId, att.userId);
        return;

      case "channel.read": {
        const access = await this.access(att.userId, event.channelId);
        if (!access) return;
        const sequence = Math.min(event.sequence, Math.max(access.channel.lastSequence, event.sequence));
        await this.db
          .insert(schema.channelReadStates)
          .values({ userId: att.userId, channelId: event.channelId, lastReadSequence: sequence, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [schema.channelReadStates.userId, schema.channelReadStates.channelId],
            set: { lastReadSequence: sql`max(${schema.channelReadStates.lastReadSequence}, ${sequence})`, updatedAt: new Date() },
          });
        for (const other of this.socketsFor(att.userId)) if (other !== ws) this.send(other, { type: "read.updated", channelId: event.channelId, sequence });
        return;
      }

      case "presence.set": {
        for (const s of this.socketsFor(att.userId)) {
          const a = this.attachment(s);
          if (!a) continue;
          a.status = event.status;
          s.serializeAttachment(a);
        }
        att.status = event.status;
        await this.db.update(schema.users).set({ status: event.status }).where(eq(schema.users.id, att.userId));
        this.markPresenceDirty(att.userId);
        return;
      }

      case "voice.state": {
        const previous = att.voice?.channelId ?? null;
        if (event.channelId) {
          const access = await this.access(att.userId, event.channelId);
          if (!access || access.channel.kind !== "voice" || !hasPermission(access.permissions, Permission.CONNECT)) {
            return this.send(ws, { type: "error", code: "forbidden", message: "You cannot join that voice channel" });
          }
          att.voice = {
            channelId: event.channelId,
            userId: att.userId,
            muted: event.muted ?? att.voice?.muted ?? false,
            deafened: event.deafened ?? att.voice?.deafened ?? false,
            video: event.video ?? att.voice?.video ?? false,
            screen: event.screen ?? att.voice?.screen ?? false,
          };
        } else {
          att.voice = null;
        }
        ws.serializeAttachment(att);
        if (previous && previous !== event.channelId) this.broadcastVoice(previous);
        if (event.channelId) this.broadcastVoice(event.channelId);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Message create — the single write path for new messages
  // -------------------------------------------------------------------------

  async createMessage(input: CreateMessageInput): Promise<CreateMessageResult> {
    // Serialize per channel so sequence allocation and insert never interleave.
    const prev = this.channelLocks.get(input.channelId) ?? Promise.resolve();
    const run = prev.then(() => this.createMessageLocked(input), () => this.createMessageLocked(input));
    this.channelLocks.set(input.channelId, run.catch(() => undefined));
    return run;
  }

  private async createMessageLocked(input: CreateMessageInput): Promise<CreateMessageResult> {
    const access = await this.access(input.userId, input.channelId, true);
    if (!access) return { ok: false, status: 404, code: "not_found", message: "Channel not found" };
    if (!hasPermission(access.permissions, Permission.SEND_MESSAGES)) return { ok: false, status: 403, code: "forbidden", message: "You cannot send messages here" };

    const content = input.content.trim();
    if (content.length > MESSAGE_MAX_LENGTH) return { ok: false, status: 400, code: "validation_failed", message: `Messages are limited to ${MESSAGE_MAX_LENGTH} characters` };
    if (content.length === 0 && input.attachmentIds.length === 0) return { ok: false, status: 400, code: "validation_failed", message: "Message is empty" };

    // Idempotency: an identical clientMessageId from this author returns the original.
    const existing = await this.db.query.messages.findFirst({
      where: and(eq(schema.messages.channelId, input.channelId), eq(schema.messages.authorUserId, input.userId), eq(schema.messages.clientMessageId, input.clientMessageId)),
    });
    if (existing) {
      const message = await loadMessage(this.db, existing.id, input.userId);
      if (message) return { ok: true, message, duplicate: true };
    }

    // Moderation rules. Checked after the idempotency lookup so a retry is never blocked.
    const moderationError = await this.checkModeration(access, input.userId, content, true);
    if (moderationError) return moderationError;

    if (input.replyTo) {
      const target = await this.db.query.messages.findFirst({ where: and(eq(schema.messages.id, input.replyTo), eq(schema.messages.channelId, input.channelId)) });
      if (!target) return { ok: false, status: 400, code: "validation_failed", message: "The message you are replying to no longer exists" };
    }

    let attachmentRows: (typeof schema.messageAttachments.$inferSelect)[] = [];
    if (input.attachmentIds.length > 0) {
      if (!hasPermission(access.permissions, Permission.ATTACH_FILES)) return { ok: false, status: 403, code: "forbidden", message: "You cannot attach files here" };
      attachmentRows = await this.db.query.messageAttachments.findMany({ where: sql`${schema.messageAttachments.id} in ${input.attachmentIds}` });
      const valid = attachmentRows.filter((a) => a.uploaderUserId === input.userId && a.channelId === input.channelId && a.messageId === null && a.status === "ready");
      if (valid.length !== new Set(input.attachmentIds).size) return { ok: false, status: 400, code: "validation_failed", message: "One or more attachments are invalid" };
    }

    const sequence = await this.nextSequence(input.channelId, access.channel.lastSequence);
    const id = newId();
    const now = new Date();
    const statements: unknown[] = [
      this.db.insert(schema.messages).values({
        id,
        workspaceId: access.channel.workspaceId,
        channelId: input.channelId,
        channelSequence: sequence,
        authorUserId: input.userId,
        content,
        replyToMessageId: input.replyTo,
        clientMessageId: input.clientMessageId,
        createdAt: now,
      }),
      this.db.update(schema.channels).set({ lastSequence: sequence, lastMessageAt: now }).where(eq(schema.channels.id, input.channelId)),
    ];
    if (attachmentRows.length) {
      statements.push(this.db.update(schema.messageAttachments).set({ messageId: id }).where(sql`${schema.messageAttachments.id} in ${input.attachmentIds}`));
    }
    try {
      await batchAll(this.db, statements);
    } catch (err) {
      // Lost a race on the idempotency index — return the winner.
      if (String(err).includes("UNIQUE")) {
        const winner = await this.db.query.messages.findFirst({
          where: and(eq(schema.messages.channelId, input.channelId), eq(schema.messages.authorUserId, input.userId), eq(schema.messages.clientMessageId, input.clientMessageId)),
        });
        const message = winner ? await loadMessage(this.db, winner.id, input.userId) : null;
        if (message) return { ok: true, message, duplicate: true };
      }
      throw err;
    }

    // Keep the cached channel row's lastSequence fresh for subsequent syncs.
    access.channel.lastSequence = sequence;
    const row = { id, workspaceId: access.channel.workspaceId, channelId: input.channelId, channelSequence: sequence, authorUserId: input.userId, content, replyToMessageId: input.replyTo, clientMessageId: input.clientMessageId, editedAt: null, deletedAt: null, pinnedAt: null, pinnedBy: null, createdAt: now };
    const [message] = await hydrateMessages(this.db, [row], input.userId);
    if (!message) throw new Error("Failed to hydrate message");

    this.clearTyping(input.channelId, input.userId);
    this.broadcastToChannel(input.channelId, { type: "message.created", message, clientMessageId: input.clientMessageId });
    this.broadcastActivity(input.channelId, sequence, input.userId);
    // A direct message notifies the other person; in a community, whoever is mentioned.
    const isDm = access.ctx.workspace.kind === "dm";
    const mentioned = isDm
      ? (await this.db.select({ userId: schema.workspaceMembers.userId }).from(schema.workspaceMembers).where(eq(schema.workspaceMembers.workspaceId, access.channel.workspaceId)))
          .map((m) => m.userId)
          .filter((id) => id !== input.userId)
      : await recordMentions(this.db, row, access.permissions, () => this.onlineUserIds());
    if (mentioned.length) {
      this.ctx.waitUntil(
        notifyUsers(this.env, mentioned, {
          kind: isDm ? "dm" : "mention",
          workspaceId: access.channel.workspaceId,
          workspaceName: access.ctx.workspace.name,
          channelId: input.channelId,
          channelName: access.channel.name,
          messageId: id,
          sequence,
          author: message.author,
          preview: content.slice(0, 140),
          createdAt: now.toISOString(),
        }),
      );
    }
    track(this.env, { name: "message.sent", workspaceId: access.channel.workspaceId, channelId: input.channelId });
    return { ok: true, message, duplicate: false };
  }

  /**
   * Allocates the next channel_sequence. The counter lives in DO storage; on a
   * cold start it is reconciled with D1 so it can never move backwards.
   */
  private async nextSequence(channelId: string, knownLast: number): Promise<number> {
    const key = `seq:${channelId}`;
    let current = await this.ctx.storage.get<number>(key);
    if (current === undefined) {
      const [row] = await this.db.select({ m: max(schema.messages.channelSequence) }).from(schema.messages).where(eq(schema.messages.channelId, channelId));
      current = Math.max(Number(row?.m ?? 0), knownLast);
    }
    const next = Math.max(current, knownLast) + 1;
    await this.ctx.storage.put(key, next);
    return next;
  }

  // -------------------------------------------------------------------------
  // RPC used by REST handlers
  // -------------------------------------------------------------------------

  /** The server owner suspended this account: close its sockets so the client signs out. */
  async disconnectUser(userId: string, reason: string): Promise<void> {
    for (const ws of this.socketsFor(userId)) ws.close(WS_CLOSE.UNAUTHENTICATED, reason);
    this.markPresenceDirty(userId);
  }

  /** Broadcast an event to everyone (channelId null) or to a channel's subscribers. */
  async broadcast(event: ServerEvent, channelId: string | null): Promise<void> {
    if (event.type === "workspace.updated") this.accessCache.clear();
    if (event.type === "member.removed") {
      this.accessCache.clear();
      for (const ws of this.socketsFor(event.userId)) {
        this.send(ws, event);
        ws.close(WS_CLOSE.FORBIDDEN, event.reason);
      }
      this.markPresenceDirty(event.userId);
    }
    if (channelId) this.broadcastToChannel(channelId, event);
    else this.broadcastAll(event);
  }

  /** Online user ids, used by REST handlers that need a presence snapshot. */
  async presence(): Promise<PresenceEntry[]> {
    return this.presenceSnapshot();
  }

  // -------------------------------------------------------------------------
  // Presence, typing, voice
  // -------------------------------------------------------------------------

  private presenceSnapshot(): PresenceEntry[] {
    const byUser = new Map<string, PresenceStatus>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (!att) continue;
      byUser.set(att.userId, effectiveStatus(att.status));
    }
    return [...byUser].filter(([, status]) => status !== "offline").map(([userId, status]) => ({ userId, status }));
  }

  private statusFor(userId: string): PresenceStatus {
    const sockets = this.socketsFor(userId);
    if (sockets.length === 0) return "offline";
    return effectiveStatus(this.attachment(sockets[0]!)?.status ?? "online");
  }

  private markPresenceDirty(userId: string): void {
    this.presenceDirty.add(userId);
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const entries = [...this.presenceDirty].map((id) => ({ userId: id, status: this.statusFor(id) }));
      this.presenceDirty.clear();
      if (entries.length) this.broadcastAll({ type: "presence.updated", entries });
    }, PRESENCE_COALESCE_MS);
  }

  private currentTypers(channelId: string): string[] {
    const map = this.typing.get(channelId);
    if (!map) return [];
    const now = Date.now();
    for (const [userId, expires] of map) if (expires <= now) map.delete(userId);
    return [...map.keys()];
  }

  private clearTyping(channelId: string, userId: string): void {
    const map = this.typing.get(channelId);
    if (!map?.delete(userId)) return;
    this.broadcastTyping(channelId);
  }

  private scheduleTypingSweep(channelId: string): void {
    if (this.typingTimers.has(channelId)) return;
    const timer = setTimeout(() => {
      this.typingTimers.delete(channelId);
      const before = this.typing.get(channelId)?.size ?? 0;
      const after = this.currentTypers(channelId).length;
      if (after !== before) this.broadcastTyping(channelId);
      if (after > 0) this.scheduleTypingSweep(channelId);
    }, TYPING_TTL_MS + 200);
    this.typingTimers.set(channelId, timer);
  }

  private broadcastTyping(channelId: string): void {
    const userIds = this.currentTypers(channelId);
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (att?.activeChannelId !== channelId) continue;
      this.send(ws, { type: "typing.updated", channelId, userIds: userIds.filter((id) => id !== att.userId) });
    }
  }

  private voiceSnapshot(): Record<string, VoiceParticipantState[]> {
    const out: Record<string, Map<string, VoiceParticipantState>> = {};
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (!att?.voice) continue;
      const { channelId, ...state } = att.voice;
      (out[channelId] ??= new Map()).set(att.userId, state);
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v.values()]]));
  }

  private broadcastVoice(channelId: string): void {
    const participants = this.voiceSnapshot()[channelId] ?? [];
    this.broadcastAll({ type: "voice.updated", channelId, participants });
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private async access(userId: string, channelId: string, fresh = false): Promise<ChannelAccess | null> {
    const key = `${userId}:${channelId}`;
    const cached = this.accessCache.get(key);
    if (!fresh && cached && cached.expiresAt > Date.now()) return cached.access;
    const access = await loadChannelAccess(this.db, channelId, userId);
    if (!access || !hasPermission(access.permissions, Permission.VIEW_CHANNEL)) {
      this.accessCache.delete(key);
      return null;
    }
    this.accessCache.set(key, { access, expiresAt: Date.now() + ACCESS_CACHE_MS });
    return access;
  }

  /**
   * The workspace's word filter, and (for new messages) the channel's slow mode.
   * Moderators are exempt from both.
   */
  private async checkModeration(access: ChannelAccess, userId: string, content: string, isNew: boolean): Promise<{ ok: false; status: number; code: ApiErrorCode; message: string } | null> {
    if (hasPermission(access.permissions, Permission.MANAGE_MESSAGES) || hasPermission(access.permissions, Permission.MANAGE_CHANNELS)) return null;
    if (findFilteredTerm(content, access.ctx.workspace.wordFilter)) {
      return { ok: false, status: 400, code: "validation_failed", message: "Your message contains a word or phrase this workspace doesn't allow." };
    }
    const wait = access.channel.slowmodeSeconds;
    if (!isNew || wait <= 0) return null;
    const [last] = await this.db
      .select({ createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(and(eq(schema.messages.channelId, access.channel.id), eq(schema.messages.authorUserId, userId)))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1);
    const remaining = last ? Math.ceil((last.createdAt.getTime() + wait * 1000 - Date.now()) / 1000) : 0;
    if (remaining <= 0) return null;
    return { ok: false, status: 429, code: "rate_limited", message: `Slow mode is on. You can send another message in ${remaining < 60 ? `${remaining}s` : `${Math.ceil(remaining / 60)}m`}.` };
  }

  /** Members connected to this workspace right now, for @here. */
  private onlineUserIds(): string[] {
    return [...new Set(this.ctx.getWebSockets().map((ws) => this.attachment(ws)?.userId).filter((id): id is string => !!id))];
  }

  private attachment(ws: WebSocket): Attachment | null {
    try {
      return (ws.deserializeAttachment() as Attachment | null) ?? null;
    } catch {
      return null;
    }
  }

  private socketsFor(userId: string): WebSocket[] {
    return this.ctx.getWebSockets(userId);
  }

  private send(ws: WebSocket, event: ServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch (err) {
      console.warn("send failed", err);
    }
  }

  private broadcastAll(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* closing */
      }
    }
  }

  private broadcastToChannel(channelId: string, event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      if (this.attachment(ws)?.activeChannelId !== channelId) continue;
      try {
        ws.send(payload);
      } catch {
        /* closing */
      }
    }
  }

  private broadcastActivity(channelId: string, lastSequence: number, authorUserId: string): void {
    const payload = JSON.stringify({ type: "channel.activity", channelId, lastSequence, authorUserId } satisfies ServerEvent);
    for (const ws of this.ctx.getWebSockets()) {
      if (this.attachment(ws)?.activeChannelId === channelId) continue;
      try {
        ws.send(payload);
      } catch {
        /* closing */
      }
    }
  }

  private allowEvent(ws: WebSocket, type: ClientEvent["type"]): boolean {
    const rule = EVENT_LIMITS[type];
    if (!rule) return true;
    let map = this.socketLimits.get(ws);
    if (!map) {
      map = new Map();
      this.socketLimits.set(ws, map);
    }
    const now = Date.now();
    const bucket = map.get(type);
    if (!bucket || bucket.resetAt <= now) {
      map.set(type, { count: 1, resetAt: now + rule.windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= rule.limit;
  }
}

function effectiveStatus(preferred: PreferredStatus): PresenceStatus {
  return preferred === "invisible" ? "offline" : preferred;
}
