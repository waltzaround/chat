import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { WorkspaceSummary } from "../shared/types";
import { ORIGIN, apiRaw, createWorkspace, signUp, textChannel } from "./helpers";

const OTHER = "https://chat.other.example";

async function link(cookie: string, linkedTo: string) {
  return apiRaw(cookie, "/api/me/linked-sessions", { method: "POST", json: { linkedTo }, headers: { Origin: ORIGIN } });
}

const fromOther = (path: string, token: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { ...init, headers: { Origin: OTHER, Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) } });

describe("linked sessions (other servers' rails)", () => {
  it("read the rail summary cross-origin, and nothing else", async () => {
    const s = await signUp("linkme");
    const ws = await createWorkspace(s, "Linked");
    const res = await link(s.cookie, OTHER);
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string };

    const list = await fromOther("/api/me/workspaces", token);
    expect(list.status).toBe(200);
    expect(list.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await list.json()) as WorkspaceSummary[]).map((w) => w.id)).toContain(ws.id);
    expect((await fromOther("/api/dms", token)).status).toBe(200);

    // Preflight for the allowed routes only.
    const preflight = await SELF.fetch(`${ORIGIN}/api/me/workspaces`, {
      method: "OPTIONS",
      headers: { Origin: OTHER, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    // No messages, no posting, no settings, no sockets, no account management, no more tokens.
    const channel = textChannel(ws);
    expect((await fromOther(`/api/channels/${channel.id}/messages`, token)).status).toBe(403);
    expect((await fromOther(`/api/workspaces/${ws.id}`, token)).status).toBe(403);
    expect((await fromOther("/api/auth/list-sessions", token)).status).toBe(403);
    expect((await SELF.fetch(`${ORIGIN}/api/me/linked-sessions`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ linkedTo: OTHER }) })).status).toBe(403);
    expect((await SELF.fetch(`${ORIGIN}/ws/me`, { headers: { Authorization: `Bearer ${token}`, Upgrade: "websocket" } })).status).toBe(401);
    const blocked = await fromOther(`/api/channels/${channel.id}/messages`, token);
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();

    // Unlinking revokes it.
    expect((await fromOther("/api/me/linked-session", token, { method: "DELETE" })).status).toBe(204);
    expect((await fromOther("/api/me/workspaces", token)).status).toBe(401);
  });

  it("can only be created by this server's own pages", async () => {
    const s = await signUp("linkcsrf");
    const res = await apiRaw(s.cookie, "/api/me/linked-sessions", { method: "POST", json: { linkedTo: OTHER }, headers: { Origin: OTHER } });
    expect(res.status).toBe(403);
    expect((await link(s.cookie, "desktop")).status).toBe(201);
    expect((await link(s.cookie, "javascript:alert(1)")).status).toBe(400);
  });
});
