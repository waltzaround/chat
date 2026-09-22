import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Message, MessagePage } from "../shared/types";
import { api, createWorkspace, invite, joinViaInvite, openSocket, send, signUp, textChannel } from "./helpers";

describe("WorkspaceHub realtime", () => {
  it("A sends → persisted → B receives; B reconnects and catches up with no gaps or duplicates", async () => {
    const a = await signUp("alpha");
    const b = await signUp("bravo");
    const ws = await createWorkspace(a, "Realtime");
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    const ch = textChannel(ws);

    // Both connect and subscribe to #general.
    const A = await openSocket(a, ws.id);
    const B = await openSocket(b, ws.id);
    const wsA = A.ws;
    const wsB = B.ws;
    await A.waitFor((e) => e.type === "ready");
    await B.waitFor((e) => e.type === "ready");
    send(wsA, { type: "channel.subscribe", channelId: ch.id, sinceSequence: 0 });
    send(wsB, { type: "channel.subscribe", channelId: ch.id, sinceSequence: 0 });
    await A.waitFor((e) => e.type === "channel.sync");
    await B.waitFor((e) => e.type === "channel.sync");

    // B sees A come online.
    await B.waitFor((e) => e.type === "presence.updated" && (e.entries as { userId: string }[]).some((p) => p.userId === a.user.id));

    // A types, B sees the indicator, then A sends.
    send(wsA, { type: "typing.start", channelId: ch.id });
    const typing = await B.waitFor<{ userIds: string[] }>((e) => e.type === "typing.updated");
    expect(typing.userIds).toEqual([a.user.id]);

    send(wsA, { type: "message.create", channelId: ch.id, clientMessageId: "c1", content: "hello from A" });
    const ack = await A.waitFor<{ messageId: string; sequence: number }>((e) => e.type === "ack" && e.clientMessageId === "c1");
    expect(ack.sequence).toBe(1);
    const created = await B.waitFor<{ message: Message }>((e) => e.type === "message.created");
    expect(created.message.content).toBe("hello from A");
    expect(created.message.id).toBe(ack.messageId);
    // Typing is cleared once the message lands.
    await B.waitFor((e) => e.type === "typing.updated" && (e.userIds as string[]).length === 0);

    // Persisted in D1.
    const row = await env.DB.prepare("SELECT channel_sequence FROM messages WHERE id = ?").bind(ack.messageId).first<{ channel_sequence: number }>();
    expect(row?.channel_sequence).toBe(1);

    // Resending the same clientMessageId does not create a duplicate.
    send(wsA, { type: "message.create", channelId: ch.id, clientMessageId: "c1", content: "hello from A" });
    const ack2 = await A.waitFor<{ messageId: string }>((e) => e.type === "ack" && e.clientMessageId === "c1" && e !== ack);
    expect(ack2.messageId).toBe(ack.messageId);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM messages WHERE channel_id = ?").bind(ch.id).first<{ n: number }>();
    expect(count?.n).toBe(1);

    // B drops offline; A keeps talking.
    B.close();
    await A.waitFor((e) => e.type === "presence.updated" && (e.entries as { userId: string; status: string }[]).some((p) => p.userId === b.user.id && p.status === "offline"));
    send(wsA, { type: "message.create", channelId: ch.id, clientMessageId: "c2", content: "second" });
    send(wsA, { type: "message.create", channelId: ch.id, clientMessageId: "c3", content: "third" });
    await A.waitFor((e) => e.type === "ack" && e.clientMessageId === "c3");

    // B reconnects and asks for everything after sequence 1.
    const B2 = await openSocket(b, ws.id);
    const wsB2 = B2.ws;
    await B2.waitFor((e) => e.type === "ready");
    send(wsB2, { type: "channel.subscribe", channelId: ch.id, sinceSequence: 1 });
    const sync = await B2.waitFor<{ messages: Message[]; complete: boolean; lastSequence: number }>((e) => e.type === "channel.sync");
    expect(sync.messages.map((m) => m.sequence)).toEqual([2, 3]);
    expect(sync.messages.map((m) => m.content)).toEqual(["second", "third"]);
    expect(sync.complete).toBe(true);
    expect(sync.lastSequence).toBe(3);

    // Full history agrees: exactly three messages, strictly increasing.
    const history = await api<MessagePage>(b.cookie, `/api/channels/${ch.id}/messages`);
    expect(history.messages.map((m) => m.sequence)).toEqual([1, 2, 3]);
    expect(new Set(history.messages.map((m) => m.id)).size).toBe(3);

    // Live events resume after reconnect.
    send(wsA, { type: "message.create", channelId: ch.id, clientMessageId: "c4", content: "fourth" });
    const live = await B2.waitFor<{ message: Message }>((e) => e.type === "message.created");
    expect(live.message.sequence).toBe(4);

    A.close();
    B2.close();
  });

  it("rejects socket upgrades from non-members and unauthenticated users", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const { SELF } = await import("cloudflare:test");
    const anon = await SELF.fetch(`http://localhost/ws/workspaces/${ws.id}`, { headers: { Upgrade: "websocket" } });
    expect(anon.status).toBe(401);
    const stranger = await SELF.fetch(`http://localhost/ws/workspaces/${ws.id}`, { headers: { Upgrade: "websocket", Cookie: b.cookie } });
    expect(stranger.status).toBe(403);
  });

  it("enforces permissions on socket events and validates frames", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    const ch = textChannel(ws);
    const everyone = ws.roles.find((r) => r.isDefault)!;
    // B may read but not send.
    await api(a.cookie, `/api/channels/${ch.id}/overwrites`, { method: "PUT", json: { targetType: "role", targetId: everyone.id, allow: 0, deny: 1 << 9 } });

    const B = await openSocket(b, ws.id);
    const wsB = B.ws;
    await B.waitFor((e) => e.type === "ready");
    send(wsB, "not json");
    await B.waitFor((e) => e.type === "error" && e.code === "validation_failed");
    send(wsB, { type: "message.create", channelId: ch.id, clientMessageId: "nope", content: "sneaky" });
    const err = await B.waitFor<{ code: string; clientMessageId: string }>((e) => e.type === "error" && e.clientMessageId === "nope");
    expect(err.code).toBe("forbidden");
    const count = await env.DB.prepare("SELECT count(*) AS n FROM messages WHERE channel_id = ?").bind(ch.id).first<{ n: number }>();
    expect(count?.n).toBe(0);
    B.close();
  });

  it("closes a kicked member's sockets", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    const B = await openSocket(b, ws.id);
    const wsB = B.ws;
    await B.waitFor((e) => e.type === "ready");
    const closed = new Promise<number>((resolve) => wsB.addEventListener("close", (ev) => resolve(ev.code)));
    await api(a.cookie, `/api/workspaces/${ws.id}/members/${b.user.id}`, { method: "DELETE" });
    await B.waitFor((e) => e.type === "member.removed");
    expect(await closed).toBe(4003);
  });
});
