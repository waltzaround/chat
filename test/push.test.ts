import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { pushToUser, vapidAuthorization, vapidKeys } from "../worker/lib/push";
import { api, apiRaw, createWorkspace, invite, joinViaInvite, sendMessage, signUp, textChannel } from "./helpers";

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (ch) => ch.charCodeAt(0));

describe("web push", () => {
  it("signs a VAPID token that verifies against the published key", async () => {
    const keys = await vapidKeys(env);
    expect((await vapidKeys({ ...env })).publicKey).toBe(keys.publicKey);
    const header = await vapidAuthorization(env, "https://fcm.googleapis.com/fcm/send/abc", "https://chat.example.com");
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, p, sig] = token!.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64url(p!)))).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://chat.example.com" });
    const publicKey = await crypto.subtle.importKey("raw", fromB64url(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64url(sig!), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
  });

  it("only accepts real push services as endpoints", async () => {
    const me = await signUp();
    const subscribe = (endpoint: string) => apiRaw(me.cookie, "/api/push/subscriptions", { method: "POST", json: { endpoint, mutedWorkspaces: [] } });
    expect((await subscribe("https://evil.example.com/hook")).status).toBe(400);
    expect((await subscribe("http://fcm.googleapis.com/fcm/send/x")).status).toBe(400);
    expect((await subscribe("https://fcm.googleapis.com/fcm/send/device-1")).status).toBe(204);
    expect((await apiRaw(me.cookie, "/api/push/subscriptions", { method: "DELETE", json: { endpoint: "https://fcm.googleapis.com/fcm/send/device-1" } })).status).toBe(204);
  });

  it("pushes to each device that hasn't muted the workspace, and forgets dead ones", async () => {
    const me = await signUp();
    const insert = (endpoint: string, muted: string[]) =>
      env.DB.prepare("INSERT INTO push_subscriptions (endpoint, user_id, origin, muted_workspaces, created_at) VALUES (?, ?, 'https://chat.example.com', ?, 0)").bind(endpoint, me.user.id, JSON.stringify(muted)).run();
    await insert("https://fcm.googleapis.com/fcm/send/phone", []);
    await insert("https://fcm.googleapis.com/fcm/send/laptop", ["w1"]);
    await insert("https://fcm.googleapis.com/fcm/send/old", []);
    const calls: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^vapid t=/);
      return new Response(null, { status: url.endsWith("/old") ? 410 : 201 });
    }) as unknown as typeof fetch;
    const notification = { kind: "mention" as const, workspaceId: "w1", workspaceName: "W", channelId: "c1", channelName: "general", messageId: "m1", sequence: 1, threadRootId: null, author: { id: "u", username: "u", displayName: "U", avatarUrl: null }, preview: "hi", createdAt: new Date().toISOString() };
    expect(await pushToUser(env, me.user.id, notification, fetcher)).toBe(1);
    expect(calls.sort()).toEqual(["https://fcm.googleapis.com/fcm/send/old", "https://fcm.googleapis.com/fcm/send/phone"]);
    const left = await env.DB.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ?").bind(me.user.id).all<{ endpoint: string }>();
    expect(left.results.map((r) => r.endpoint).sort()).toEqual(["https://fcm.googleapis.com/fcm/send/laptop", "https://fcm.googleapis.com/fcm/send/phone"]);
  });

  it("gives the service worker what to show after a push", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    await joinViaInvite(b, (await invite(a, ws.id)).code);
    const msg = await sendMessage(a, textChannel(ws).id, `@${b.user.username} ping`);
    const items = await api<Array<{ title: string; body: string; url: string }>>(b.cookie, "/api/push/pending");
    expect(items.at(-1)).toMatchObject({ title: `${a.user.displayName} in #general`, body: `@${b.user.username} ping`, url: `/w/${ws.id}/c/${textChannel(ws).id}?m=${msg.sequence}` });

    // A device that hides message text gets only who and where.
    const endpoint = "https://fcm.googleapis.com/fcm/send/private-phone";
    await api(b.cookie, "/api/push/subscriptions", { method: "POST", json: { endpoint, mutedWorkspaces: [], hideText: true } });
    const hidden = await api<Array<{ body: string }>>(b.cookie, `/api/push/pending?endpoint=${encodeURIComponent(endpoint)}`);
    expect(hidden.at(-1)?.body).toBe(`Mentioned you in ${ws.name}`);
  });
});

describe("phone push (through a push relay)", () => {
  const relay = "https://push.example.org";
  const register = (cookie: string, pushKey: string, relayUrl = relay) =>
    apiRaw(cookie, "/api/push/devices", { method: "POST", json: { platform: "ios", relay: relayUrl, pushKey } });

  it("registers a phone per session, and only with https relays", async () => {
    const me = await signUp();
    expect((await register(me.cookie, "key-that-is-long-enough", "http://evil.example.com")).status).toBe(400);
    const first = await register(me.cookie, "key-that-is-long-enough");
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    // Registering the same phone again keeps its id.
    expect(((await (await register(me.cookie, "key-that-is-long-enough")).json()) as { id: string }).id).toBe(id);

    // Signing out removes it, so a signed-out phone gets nothing.
    await apiRaw(me.cookie, "/api/auth/sign-out", { method: "POST", json: {} });
    const left = await env.DB.prepare("SELECT id FROM push_devices WHERE id = ?").bind(id).first();
    expect(left).toBeNull();
  });

  it("wakes each phone through its relay without message text, and forgets gone ones", async () => {
    const me = await signUp();
    const phone = ((await (await register(me.cookie, "phone-key-0123456789")).json()) as { id: string }).id;
    await register(me.cookie, "gone-key-0123456789");
    const bodies: Array<Record<string, string>> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      expect(url).toBe(`${relay}/v1/notify`);
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      bodies.push(body);
      return new Response(null, { status: body.pushKey?.startsWith("gone") ? 410 : 202 });
    }) as unknown as typeof fetch;
    const notification = { kind: "dm" as const, workspaceId: "w1", workspaceName: "W", channelId: "c1", channelName: "dm", messageId: "m1", sequence: 1, threadRootId: null, author: { id: "u", username: "u", displayName: "U", avatarUrl: null }, preview: "secret text", createdAt: new Date().toISOString() };
    expect(await pushToUser(env, me.user.id, notification, fetcher)).toBe(1);
    expect(bodies.find((b) => b.pushKey === "phone-key-0123456789")).toEqual({ pushKey: "phone-key-0123456789", server: "http://localhost", device: phone });
    expect(JSON.stringify(bodies)).not.toContain("secret text");
    const left = await env.DB.prepare("SELECT push_key FROM push_devices WHERE user_id = ?").bind(me.user.id).all<{ push_key: string }>();
    expect(left.results.map((r) => r.push_key)).toEqual(["phone-key-0123456789"]);
  });
});

describe("phone push hardening", () => {
  it("won't hand a device registered to one account to another", async () => {
    const a = await signUp();
    const b = await signUp();
    const body = { platform: "android", relay: "https://push.example.org", pushKey: "shared-key-0123456789" };
    expect((await apiRaw(a.cookie, "/api/push/devices", { method: "POST", json: body })).status).toBe(201);
    expect((await apiRaw(b.cookie, "/api/push/devices", { method: "POST", json: body })).status).toBe(409);
    const row = await env.DB.prepare("SELECT user_id FROM push_devices WHERE push_key = ?").bind(body.pushKey).first<{ user_id: string }>();
    expect(row?.user_id).toBe(a.user.id);
  });
});
