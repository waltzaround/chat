import { SELF } from "cloudflare:test";
import { expect } from "vitest";
import type { Channel, CurrentUser, Invite, Message, WorkspaceDetail } from "../shared/types";

export const ORIGIN = "http://localhost";

export interface Session {
  cookie: string;
  user: CurrentUser;
}

let counter = 0;

/** Registers a fresh user through Better Auth and returns its session cookie. */
export async function signUp(username?: string, requestCookie?: string): Promise<Session> {
  const res = await signUpRaw(username, requestCookie);
  expect(res.status, await res.clone().text()).toBe(200);
  const cookie = extractCookies(res.headers);
  const me = await api<CurrentUser>(cookie, "/api/me");
  return { cookie, user: me };
}

/** Sign-up request without assertions. `cookie` carries e.g. an invite or claim cookie. */
export async function signUpRaw(username?: string, cookie?: string): Promise<Response> {
  counter += 1;
  const name = username ?? `user${counter}_${Math.random().toString(36).slice(2, 6)}`;
  // Each simulated user comes from its own IP so per-IP abuse limits behave as in production.
  return SELF.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "CF-Connecting-IP": `10.0.${Math.floor(counter / 250)}.${counter % 250}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ email: `${name}@example.com`, password: "password123", name: name, username: name }),
  });
}

export function extractCookies(headers: Headers): string {
  const raw = headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]!).join("; ");
}

export async function apiRaw(cookie: string | null, path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, headers, ...rest } = init;
  return SELF.fetch(`${ORIGIN}${path}`, {
    ...rest,
    headers: {
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

export async function api<T>(cookie: string | null, path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await apiRaw(cookie, path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function createWorkspace(s: Session, name = "Test Workspace"): Promise<WorkspaceDetail> {
  return api<WorkspaceDetail>(s.cookie, "/api/workspaces", { method: "POST", json: { name } });
}

export async function createChannel(s: Session, workspaceId: string, name: string, kind: "text" | "voice" = "text"): Promise<Channel> {
  return api<Channel>(s.cookie, `/api/workspaces/${workspaceId}/channels`, { method: "POST", json: { name, kind } });
}

export async function invite(s: Session, workspaceId: string, opts: Record<string, unknown> = {}): Promise<Invite> {
  return api<Invite>(s.cookie, `/api/workspaces/${workspaceId}/invites`, { method: "POST", json: opts });
}

export async function joinViaInvite(s: Session, code: string): Promise<void> {
  await api(s.cookie, `/api/invites/${code}/accept`, { method: "POST" });
}

export async function sendMessage(s: Session, channelId: string, content: string, clientMessageId = crypto.randomUUID()): Promise<Message> {
  return api<Message>(s.cookie, `/api/channels/${channelId}/messages`, { method: "POST", json: { content, clientMessageId } });
}

export function textChannel(ws: WorkspaceDetail): Channel {
  return ws.channels.find((c) => c.kind === "text")!;
}

/** Opens an authenticated WebSocket to a workspace hub, collecting events from the very first frame. */
export async function openSocket(s: Session, workspaceId: string): Promise<Collected & { ws: WebSocket }> {
  const res = await SELF.fetch(`${ORIGIN}/ws/workspaces/${workspaceId}`, { headers: { Upgrade: "websocket", Cookie: s.cookie, Origin: ORIGIN } });
  if (res.status !== 101) throw new Error(`WebSocket upgrade failed: ${res.status} ${await res.text()}`);
  const ws = res.webSocket!;
  // Listeners must be attached before accept() or early frames (e.g. `ready`) are lost.
  const collected = collect(ws);
  ws.accept();
  return { ...collected, ws };
}

export interface Collected {
  events: Array<{ type: string } & Record<string, unknown>>;
  waitFor: <T = Record<string, unknown>>(pred: (e: { type: string } & Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<T & { type: string }>;
  close: () => void;
}

/** The per-user socket that carries mention and DM notifications. */
export async function openUserSocket(s: Session): Promise<Collected & { ws: WebSocket }> {
  const res = await SELF.fetch(`${ORIGIN}/ws/me`, { headers: { Upgrade: "websocket", Cookie: s.cookie, Origin: ORIGIN } });
  if (res.status !== 101) throw new Error(`WebSocket upgrade failed: ${res.status} ${await res.text()}`);
  const ws = res.webSocket!;
  const collected = collect(ws);
  ws.accept();
  return { ...collected, ws };
}

export function collect(ws: WebSocket): Collected {
  const events: Array<{ type: string } & Record<string, unknown>> = [];
  const waiters: Array<{ pred: (e: { type: string } & Record<string, unknown>) => boolean; resolve: (e: never) => void }> = [];
  ws.addEventListener("message", (ev) => {
    const data = JSON.parse(String(ev.data)) as { type: string } & Record<string, unknown>;
    events.push(data);
    for (const w of [...waiters]) {
      if (w.pred(data)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(data as never);
      }
    }
  });
  return {
    events,
    waitFor: (pred, timeoutMs = 5000) =>
      new Promise((resolve, reject) => {
        const existing = events.find(pred);
        if (existing) return resolve(existing as never);
        const t = setTimeout(() => reject(new Error(`Timed out waiting for event. Seen: ${events.map((e) => e.type).join(", ")}`)), timeoutMs);
        waiters.push({
          pred,
          resolve: (e) => {
            clearTimeout(t);
            resolve(e);
          },
        });
      }),
    close: () => ws.close(1000, "test done"),
  };
}

export function send(ws: WebSocket, event: unknown): void {
  ws.send(JSON.stringify(event));
}
