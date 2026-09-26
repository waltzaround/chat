import type { NotificationPayload } from "@shared/events";
import type { Env } from "../env";

/** Small fan-outs go straight to each UserHub; big ones (@everyone) go through the queue. */
const DIRECT_LIMIT = 25;

export function userHub(env: Env, userId: string) {
  return env.USER_HUB.get(env.USER_HUB.idFromName(userId));
}

export async function notifyUsers(env: Env, userIds: string[], notification: NotificationPayload): Promise<void> {
  if (userIds.length === 0) return;
  if (userIds.length <= DIRECT_LIMIT) {
    await deliver(env, userIds, notification);
    return;
  }
  const jobs = [];
  for (let i = 0; i < userIds.length; i += 100) jobs.push({ body: { type: "notify.users" as const, userIds: userIds.slice(i, i + 100), notification } });
  for (let i = 0; i < jobs.length; i += 100) await env.BACKGROUND_QUEUE.sendBatch(jobs.slice(i, i + 100));
}

export async function deliver(env: Env, userIds: string[], notification: NotificationPayload): Promise<void> {
  await Promise.all(userIds.map((id) => userHub(env, id).notify({ type: "notification", notification }, id).catch((err) => console.error("notify failed", err))));
}
