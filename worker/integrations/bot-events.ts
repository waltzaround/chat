/**
 * Events a bot receives at its events URL, and how they are signed and delivered.
 *
 * Every delivery is a POST of JSON with these headers:
 *   X-Chat-Event:      the event type, e.g. "message.created"
 *   X-Chat-Delivery:   a unique id; the same delivery may arrive more than once
 *   X-Chat-Timestamp:  Unix seconds
 *   X-Chat-Signature:  "sha256=" + hex HMAC-SHA256 of `${timestamp}.${body}` with the
 *                      bot's signing secret
 * A bot should refuse bodies whose signature doesn't match or whose timestamp is more
 * than five minutes old.
 */
import { eq, sql } from "drizzle-orm";
import type { ServerEvent } from "@shared/events";
import type { Message, ReactionSummary, UserSummary } from "@shared/types";
import { newId } from "@shared/id";
import type { Env } from "../env";
import { schema, type Db } from "../db";
import { decryptSecret, hmacSha256Hex } from "../lib/crypto";

export type BotEvent =
  | BotEventBase<"message.created", { message: Message }>
  | BotEventBase<"message.updated", { message: Message }>
  | BotEventBase<"message.deleted", { messageId: string; sequence: number }>
  | BotEventBase<"reaction.updated", { messageId: string; reactions: ReactionSummary[] }>
  | BotEventBase<"member.joined", { user: UserSummary }>
  | BotEventBase<"member.left", { user: UserSummary; reason: "left" | "kicked" | "banned" }>
  /** Sent when the events URL is saved. Any 2xx answer confirms the URL works. */
  | BotEventBase<"ping", Record<string, never>>;

interface BotEventBase<T extends string, D> {
  id: string;
  type: T;
  workspaceId: string;
  channelId: string | null;
  createdAt: string;
  data: D;
}

export function botEventFor(
  workspaceId: string,
  channelId: string,
  event: Extract<ServerEvent, { type: "message.created" | "message.updated" | "message.deleted" | "reaction.updated" }>,
): BotEvent {
  const base = { id: newId(), workspaceId, channelId, createdAt: new Date().toISOString() };
  switch (event.type) {
    case "message.created":
      return { ...base, type: "message.created", data: { message: event.message } };
    case "message.updated":
      return { ...base, type: "message.updated", data: { message: event.message } };
    case "message.deleted":
      return { ...base, type: "message.deleted", data: { messageId: event.messageId, sequence: event.sequence } };
    case "reaction.updated":
      return { ...base, type: "reaction.updated", data: { messageId: event.messageId, reactions: event.reactions } };
  }
}

export function memberEvent(workspaceId: string, type: "member.joined" | "member.left", user: UserSummary, reason: "left" | "kicked" | "banned" = "left"): BotEvent {
  const base = { id: newId(), workspaceId, channelId: null, createdAt: new Date().toISOString() };
  return type === "member.joined" ? { ...base, type, data: { user } } : { ...base, type, data: { user, reason } };
}

/** Signed headers for a delivery body. */
export async function signedHeaders(secret: string, body: string, event: { type: string; id: string }): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    "Content-Type": "application/json",
    "User-Agent": "Chat-Bot-Events/1.0",
    "X-Chat-Event": event.type,
    "X-Chat-Delivery": event.id,
    "X-Chat-Timestamp": timestamp,
    "X-Chat-Signature": `sha256=${await hmacSha256Hex(secret, `${timestamp}.${body}`)}`,
  };
}

/** Attempts per event before it counts as a failed delivery. Matches the queue's retries. */
export const DELIVERY_ATTEMPTS = 3;
/** Failed deliveries in a row before events pause. Saving the URL again resumes them. */
export const PAUSE_AFTER_FAILURES = 10;
const DELIVERY_TIMEOUT_MS = 10_000;

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** POSTs one signed payload to a bot. Throws on network errors and timeouts. */
export async function postToBot(env: Env, bot: { eventsUrl: string; signingSecret: string }, payload: { type: string; id: string }, fetcher: Fetcher = fetch, timeoutMs = DELIVERY_TIMEOUT_MS): Promise<Response> {
  const body = JSON.stringify(payload);
  const secret = await decryptSecret(env, bot.signingSecret);
  return fetcher(bot.eventsUrl, { method: "POST", headers: await signedHeaders(secret, body, payload), body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Queue handler for one event. Throws to have the queue retry; on the last attempt a
 * failure is recorded instead, and enough of them in a row pause the bot's events.
 */
export async function deliverBotEvent(env: Env, db: Db, botUserId: string, event: BotEvent, attempt: number, fetcher: Fetcher = fetch): Promise<void> {
  const bot = await db.query.bots.findFirst({ where: eq(schema.bots.userId, botUserId) });
  if (!bot?.eventsUrl || bot.eventsPausedAt) return;
  let ok = false;
  try {
    const res = await postToBot(env, { eventsUrl: bot.eventsUrl, signingSecret: bot.signingSecret }, event, fetcher);
    await res.body?.cancel();
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (ok) {
    if (bot.eventsFailures > 0) await db.update(schema.bots).set({ eventsFailures: 0 }).where(eq(schema.bots.userId, botUserId));
    return;
  }
  if (attempt < DELIVERY_ATTEMPTS) throw new Error(`Bot ${botUserId} didn't accept ${event.type}`);
  await db
    .update(schema.bots)
    .set({
      eventsFailures: sql`${schema.bots.eventsFailures} + 1`,
      eventsPausedAt: sql`CASE WHEN ${schema.bots.eventsFailures} + 1 >= ${PAUSE_AFTER_FAILURES} THEN ${Date.now()} ELSE ${schema.bots.eventsPausedAt} END`,
    })
    .where(eq(schema.bots.userId, botUserId));
}
