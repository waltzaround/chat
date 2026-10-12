/**
 * Workspace-wide bot events (members joining and leaving), queued for each bot in the
 * workspace that takes events. Channel events go through the WorkspaceHub instead,
 * which also checks each bot can see the channel.
 */
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { Env } from "../env";
import { schema, type Db } from "../db";
import { memberEvent, type BotEvent } from "./bot-events";
import { toUserSummary } from "../lib/serialize";

export async function dispatchWorkspaceEvent(env: Env, db: Db, workspaceId: string, event: BotEvent, exceptUserId?: string): Promise<void> {
  const rows = await db
    .select({ userId: schema.bots.userId })
    .from(schema.bots)
    .innerJoin(schema.workspaceMembers, and(eq(schema.workspaceMembers.userId, schema.bots.userId), eq(schema.workspaceMembers.workspaceId, workspaceId)))
    .where(and(isNotNull(schema.bots.eventsUrl), isNull(schema.bots.eventsPausedAt), eq(schema.workspaceMembers.status, "active"), exceptUserId ? ne(schema.bots.userId, exceptUserId) : undefined));
  const subject = "user" in event.data ? (event.data as { user: { id: string } }).user.id : null;
  const jobs = rows.filter((r) => r.userId !== subject).map((r) => ({ body: { type: "bot.event" as const, botUserId: r.userId, event } }));
  if (jobs.length === 0) return;
  try {
    await env.BACKGROUND_QUEUE.sendBatch(jobs);
  } catch (err) {
    console.error("bot event enqueue failed", err);
  }
}

/** Tells a workspace's bots that someone joined, or left, was kicked or was banned. */
export async function dispatchMemberEvent(env: Env, db: Db, workspaceId: string, userId: string, change: "joined" | "left" | "kicked" | "banned"): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) return;
  const summary = toUserSummary(user);
  const event = change === "joined" ? memberEvent(workspaceId, "member.joined", summary) : memberEvent(workspaceId, "member.left", summary, change);
  await dispatchWorkspaceEvent(env, db, workspaceId, event);
}
