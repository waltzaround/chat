import type { Env } from "../env";

export type AnalyticsEvent =
  | { name: "message.sent"; workspaceId: string; channelId: string }
  | { name: "ws.connect"; workspaceId: string; reconnect: boolean }
  | { name: "ws.disconnect"; workspaceId: string; durationMs: number }
  | { name: "voice.join"; workspaceId: string; channelId: string }
  | { name: "voice.leave"; workspaceId: string; channelId: string; durationMs: number }
  | { name: "upload.complete"; workspaceId: string; bytes: number; mimeType: string }
  | { name: "workspace.created"; workspaceId: string }
  | { name: "api.request"; route: string; status: number; durationMs: number }
  | { name: "api.error"; route: string; code: string };

/**
 * Writes an operational event to Workers Analytics Engine.
 * Never includes message bodies or personal data. Silently no-ops when the
 * binding is absent (local tests).
 */
export function track(env: Env, event: AnalyticsEvent): void {
  if (!env.ANALYTICS) return;
  try {
    const { name, ...rest } = event as AnalyticsEvent & Record<string, unknown>;
    const blobs: string[] = [name];
    const doubles: number[] = [];
    for (const [k, v] of Object.entries(rest)) {
      if (typeof v === "number") doubles.push(v);
      else if (typeof v === "boolean") doubles.push(v ? 1 : 0);
      else blobs.push(`${k}=${String(v)}`);
    }
    const index = "workspaceId" in rest && typeof rest.workspaceId === "string" ? rest.workspaceId : name;
    env.ANALYTICS.writeDataPoint({ blobs, doubles, indexes: [index] });
  } catch (err) {
    console.warn("analytics write failed", err);
  }
}
