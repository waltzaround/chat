import type { ServerEvent } from "@shared/events";
import type { Env } from "../env";
import type { WorkspaceHub } from "../durable-objects/workspace-hub";

export function hubFor(env: Env, workspaceId: string): DurableObjectStub<WorkspaceHub> {
  return env.WORKSPACE_HUB.get(env.WORKSPACE_HUB.idFromName(workspaceId));
}

/**
 * Fire-and-forget broadcast from a REST handler to everyone connected to the
 * workspace. Failures are logged, never surfaced to the HTTP caller.
 */
export async function notifyWorkspace(env: Env, workspaceId: string, event: ServerEvent, channelId?: string): Promise<void> {
  try {
    await hubFor(env, workspaceId).broadcast(event, channelId ?? null);
  } catch (err) {
    console.error("hub broadcast failed", err);
  }
}
