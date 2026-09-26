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
