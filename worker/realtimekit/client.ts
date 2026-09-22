import type { Env } from "../env";
import { ApiError } from "../lib/errors";

/**
 * Thin client for the Cloudflare RealtimeKit REST API. Credentials never leave
 * the Worker; the browser only ever receives a per-participant auth token.
 */
export function realtimekitConfigured(env: Env): boolean {
  return !!(env.CLOUDFLARE_ACCOUNT_ID && env.REALTIMEKIT_APP_ID && env.CLOUDFLARE_REALTIME_API_TOKEN);
}

function baseUrl(env: Env): string {
  return `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/realtime/kit/${env.REALTIMEKIT_APP_ID}`;
}

async function call<T>(env: Env, path: string, init: RequestInit): Promise<{ status: number; data: T | null; raw: unknown }> {
  const res = await fetch(`${baseUrl(env)}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.CLOUDFLARE_REALTIME_API_TOKEN}`, ...(init.headers ?? {}) },
  });
  const raw = (await res.json().catch(() => null)) as { success?: boolean; data?: T } | null;
  return { status: res.status, data: raw?.data ?? null, raw };
}

export async function createMeeting(env: Env, title: string): Promise<string> {
  const { status, data, raw } = await call<{ id: string }>(env, "/meetings", {
    method: "POST",
    body: JSON.stringify({ title: title.slice(0, 100), record_on_start: false }),
  });
  if (status >= 300 || !data?.id) {
    console.error("RealtimeKit createMeeting failed", status, raw);
    throw new ApiError(502, "upstream_error", "Could not create the voice room");
  }
  return data.id;
}

export interface AddParticipantInput {
  meetingId: string;
  name: string;
  presetName: string;
  customParticipantId: string;
  picture?: string | null;
}

export async function addParticipant(env: Env, input: AddParticipantInput): Promise<{ token: string } | { notFound: true }> {
  const { status, data, raw } = await call<{ token: string }>(env, `/meetings/${input.meetingId}/participants`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name.slice(0, 100),
      preset_name: input.presetName,
      custom_participant_id: input.customParticipantId,
      ...(input.picture ? { picture: input.picture } : {}),
    }),
  });
  if (status === 404) return { notFound: true };
  if (status >= 300 || !data?.token) {
    console.error("RealtimeKit addParticipant failed", status, raw);
    throw new ApiError(502, "upstream_error", "Could not join the voice room");
  }
  return { token: data.token };
}
