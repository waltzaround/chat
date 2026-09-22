import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { checkRateLimit } from "../security/ratelimit";
import { track } from "../analytics/track";
import { Permission, hasPermission, requireChannelAccess } from "../permissions/resolve";
import { addParticipant, createMeeting, realtimekitConfigured } from "../realtimekit/client";
import { avatarUrl } from "../lib/serialize";
import type { VoiceJoinResponse } from "@shared/types";

export const voiceRoutes = new Hono<AppEnv>();
voiceRoutes.use("*", requireUser);

/**
 * Issues a RealtimeKit participant token for a voice channel. Our permission
 * system is authoritative: the preset handed to RealtimeKit is derived from
 * the caller's resolved SPEAK/VIDEO/SCREEN_SHARE permissions.
 */
voiceRoutes.post("/:channelId/voice/join", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  checkRateLimit(`voice-join:${user.id}`, 10, 60_000);

  // Authorisation first: non-members and members without CONNECT never learn whether voice is configured.
  const { channel, permissions, ctx } = await requireChannelAccess(db, c.req.param("channelId"), user.id, Permission.CONNECT);
  if (channel.kind !== "voice") throw ApiError.validation(undefined, "This is not a voice channel");
  if (!realtimekitConfigured(c.env)) throw ApiError.notConfigured("Voice (RealtimeKit)");

  const canSpeak = hasPermission(permissions, Permission.SPEAK);
  const presetName = canSpeak ? c.env.REALTIMEKIT_PRESET_FULL ?? "chat_full" : c.env.REALTIMEKIT_PRESET_LISTEN ?? "chat_listen";

  let mapping = await db.query.voiceChannelMeetings.findFirst({ where: eq(schema.voiceChannelMeetings.channelId, channel.id) });
  if (!mapping) {
    const meetingId = await createMeeting(c.env, `${ctx.workspace.name} / ${channel.name}`);
    const now = new Date();
    await db
      .insert(schema.voiceChannelMeetings)
      .values({ channelId: channel.id, realtimekitMeetingId: meetingId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: schema.voiceChannelMeetings.channelId, set: { realtimekitMeetingId: meetingId, updatedAt: now } });
    mapping = { channelId: channel.id, realtimekitMeetingId: meetingId, createdAt: now, updatedAt: now };
  }

  const displayName = ctx.member.nickname ?? user.displayName;
  const participant = { name: displayName, presetName, customParticipantId: user.id, picture: avatarUrl(user)?.startsWith("http") ? avatarUrl(user) : null };
  let result = await addParticipant(c.env, { meetingId: mapping.realtimekitMeetingId, ...participant });
  if ("notFound" in result) {
    // The meeting was removed upstream — create a fresh one and retry once.
    const meetingId = await createMeeting(c.env, `${ctx.workspace.name} / ${channel.name}`);
    await db.update(schema.voiceChannelMeetings).set({ realtimekitMeetingId: meetingId, updatedAt: new Date() }).where(eq(schema.voiceChannelMeetings.channelId, channel.id));
    mapping.realtimekitMeetingId = meetingId;
    result = await addParticipant(c.env, { meetingId, ...participant });
    if ("notFound" in result) throw new ApiError(502, "upstream_error", "Could not join the voice room");
  }

  track(c.env, { name: "voice.join", workspaceId: channel.workspaceId, channelId: channel.id });
  const body: VoiceJoinResponse = { authToken: result.token, meetingId: mapping.realtimekitMeetingId, channelId: channel.id, permissions };
  return c.json(body);
});

voiceRoutes.post("/:channelId/voice/leave", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const { channel } = await requireChannelAccess(db, c.req.param("channelId"), user.id);
  const body = (await c.req.json().catch(() => ({}))) as { durationMs?: number };
  track(c.env, { name: "voice.leave", workspaceId: channel.workspaceId, channelId: channel.id, durationMs: Number(body.durationMs ?? 0) });
  return c.json({ ok: true });
});
