/**
 * WebSocket protocol between the browser and the WorkspaceHub Durable Object.
 * Every frame is a JSON object with a `type` discriminator, validated with Zod
 * on both ends.
 */
import { z } from "zod";
import { emojiSchema, idSchema, messageContentSchema } from "./schemas";
import type { Message, PresenceStatus, ReactionSummary } from "./types";

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export const clientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("channel.subscribe"),
    channelId: idSchema,
    /** Highest sequence the client already has; the hub replies with the gap. */
    sinceSequence: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal("message.create"),
    channelId: idSchema,
    clientMessageId: z.string().min(1).max(64),
    content: messageContentSchema,
    attachmentIds: z.array(idSchema).max(10).optional(),
    replyTo: idSchema.optional(),
  }),
  z.object({ type: z.literal("message.edit"), messageId: idSchema, content: messageContentSchema.min(1) }),
  z.object({ type: z.literal("message.delete"), messageId: idSchema }),
  z.object({ type: z.literal("reaction.add"), messageId: idSchema, emoji: emojiSchema }),
  z.object({ type: z.literal("reaction.remove"), messageId: idSchema, emoji: emojiSchema }),
  z.object({ type: z.literal("typing.start"), channelId: idSchema }),
  z.object({ type: z.literal("typing.stop"), channelId: idSchema }),
  z.object({ type: z.literal("channel.read"), channelId: idSchema, sequence: z.number().int().min(0) }),
  z.object({ type: z.literal("presence.set"), status: z.enum(["online", "idle", "dnd", "invisible"]) }),
  z.object({
    type: z.literal("voice.state"),
    /** null when the client has left voice entirely. */
    channelId: idSchema.nullable(),
    muted: z.boolean().optional(),
    deafened: z.boolean().optional(),
    video: z.boolean().optional(),
    screen: z.boolean().optional(),
  }),
  z.object({ type: z.literal("ping") }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
}

export interface VoiceParticipantState {
  userId: string;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
}

export type ServerEvent =
  | {
      type: "ready";
      sessionId: string;
      userId: string;
      workspaceId: string;
      presence: PresenceEntry[];
      voice: Record<string, VoiceParticipantState[]>;
      serverTime: string;
    }
  | { type: "channel.sync"; channelId: string; messages: Message[]; complete: boolean; lastSequence: number }
  | { type: "message.created"; message: Message; clientMessageId?: string }
  | { type: "message.updated"; message: Message }
  | { type: "message.deleted"; channelId: string; messageId: string; sequence: number }
  | { type: "reaction.updated"; channelId: string; messageId: string; reactions: ReactionSummary[] }
  | { type: "typing.updated"; channelId: string; userIds: string[] }
  | { type: "presence.updated"; entries: PresenceEntry[] }
  | { type: "channel.activity"; channelId: string; lastSequence: number; authorUserId: string }
  | { type: "read.updated"; channelId: string; sequence: number }
  | { type: "voice.updated"; channelId: string; participants: VoiceParticipantState[] }
  | { type: "workspace.updated"; reason: "channels" | "roles" | "members" | "workspace" | "emojis" | "reports" }
  | { type: "member.removed"; userId: string; reason: "kicked" | "banned" | "left" }
  | { type: "ack"; clientMessageId: string; messageId: string; sequence: number }
  | { type: "error"; code: string; message: string; clientMessageId?: string }
  | { type: "pong" };

export type ServerEventType = ServerEvent["type"];

export function parseClientEvent(raw: unknown): ClientEvent | null {
  const result = clientEventSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Close codes used by the hub so the client knows whether to retry. */
export const WS_CLOSE = {
  UNAUTHENTICATED: 4001,
  FORBIDDEN: 4003,
  REPLACED: 4010,
  SERVER_RESTART: 4012,
} as const;
