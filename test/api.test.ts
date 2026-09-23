import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Permission } from "../shared/permissions";
import type { Channel, MessagePage, WorkspaceDetail } from "../shared/types";
import { api, apiRaw, createChannel, createWorkspace, invite, joinViaInvite, sendMessage, signUp, textChannel } from "./helpers";

describe("authentication", () => {
  it("rejects anonymous API access", async () => {
    const res = await apiRaw(null, "/api/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });

  it("signs up, sets an http-only cookie and returns the profile", async () => {
    const s = await signUp("alice");
    expect(s.user.username).toBe("alice");
    expect(s.cookie).toContain("chat");
  });
});

describe("workspaces and membership", () => {
  it("creates a workspace with defaults and owner role", async () => {
    const s = await signUp();
    const ws = await createWorkspace(s, "Acme");
    expect(ws.channels.map((c) => c.name).sort()).toEqual(["Lounge", "general"]);
    expect(ws.categories).toHaveLength(2);
    expect(ws.roles.some((r) => r.isDefault)).toBe(true);
    expect(ws.myPermissions & Permission.ADMINISTRATOR).toBeTruthy();
  });

  it("hides workspaces from non-members", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const res = await apiRaw(b.cookie, `/api/workspaces/${ws.id}`);
    expect(res.status).toBe(404);
    const ch = await apiRaw(b.cookie, `/api/channels/${textChannel(ws).id}/messages`);
    expect(ch.status).toBe(404);
  });

  it("lets a user join via invite and enforces expiry, max uses and revocation", async () => {
    const a = await signUp();
    const b = await signUp();
    const c = await signUp();
    const ws = await createWorkspace(a);

    const inv = await invite(a, ws.id, { maxUses: 1 });
    const preview = await api<{ workspace: { name: string }; isMember: boolean }>(null, `/api/invites/${inv.code}`);
    expect(preview.workspace.name).toBe("Test Workspace");
    await joinViaInvite(b, inv.code);
    const members = await api<{ userId: string }[]>(b.cookie, `/api/workspaces/${ws.id}/members`);
    expect(members.map((m) => m.userId).sort()).toEqual([a.user.id, b.user.id].sort());

    // Second use exceeds maxUses.
    const exhausted = await apiRaw(c.cookie, `/api/invites/${inv.code}/accept`, { method: "POST" });
    expect(exhausted.status).toBe(410);

    // Expired invite.
    const inv2 = await invite(a, ws.id, { expiresIn: 3600 });
    await env.DB.prepare("UPDATE invites SET expires_at = ? WHERE code = ?").bind(Date.now() - 1000, inv2.code).run();
    const expired = await apiRaw(c.cookie, `/api/invites/${inv2.code}/accept`, { method: "POST" });
    expect(expired.status).toBe(410);

    // Revoked invite.
    const inv3 = await invite(a, ws.id, {});
    await api(a.cookie, `/api/workspaces/${ws.id}/invites/${inv3.code}`, { method: "DELETE" });
    const revoked = await apiRaw(c.cookie, `/api/invites/${inv3.code}/accept`, { method: "POST" });
    expect(revoked.status).toBe(404);
  });

  it("blocks banned users from re-joining", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    await api(a.cookie, `/api/workspaces/${ws.id}/bans/${b.user.id}`, { method: "PUT", json: { reason: "spam" } });
    const res = await apiRaw(b.cookie, `/api/invites/${inv.code}/accept`, { method: "POST" });
    expect(res.status).toBe(403);
    const asB = await apiRaw(b.cookie, `/api/workspaces/${ws.id}`);
    expect(asB.status).toBe(404);
  });

  it("only lets permitted members manage channels and invites", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    const res = await apiRaw(b.cookie, `/api/workspaces/${ws.id}/channels`, { method: "POST", json: { name: "nope", kind: "text" } });
    expect(res.status).toBe(403);
    // Default role includes CREATE_INVITES so this is allowed…
    expect((await apiRaw(b.cookie, `/api/workspaces/${ws.id}/invites`, { method: "POST", json: {} })).status).toBe(201);
    // …until the owner removes it from @everyone.
    const everyone = ws.roles.find((r) => r.isDefault)!;
    await api(a.cookie, `/api/workspaces/${ws.id}/roles/${everyone.id}`, { method: "PATCH", json: { permissions: everyone.permissions & ~Permission.CREATE_INVITES } });
    expect((await apiRaw(b.cookie, `/api/workspaces/${ws.id}/invites`, { method: "POST", json: {} })).status).toBe(403);
  });
});

describe("channel permission overwrites", () => {
  it("hides a private channel from members without VIEW_CHANNEL", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    const secret = await createChannel(a, ws.id, "secret");
    const everyone = ws.roles.find((r) => r.isDefault)!;
    await api(a.cookie, `/api/channels/${secret.id}/overwrites`, { method: "PUT", json: { targetType: "role", targetId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL } });

    const asB = await api<WorkspaceDetail>(b.cookie, `/api/workspaces/${ws.id}`);
    expect(asB.channels.some((c) => c.id === secret.id)).toBe(false);
    expect((await apiRaw(b.cookie, `/api/channels/${secret.id}/messages`)).status).toBe(404);
    expect((await apiRaw(b.cookie, `/api/channels/${secret.id}/messages`, { method: "POST", json: { content: "hi", clientMessageId: "x" } })).status).toBe(404);

    // Owner still sees it (administrator bypass).
    const asA = await api<WorkspaceDetail>(a.cookie, `/api/workspaces/${ws.id}`);
    expect(asA.channels.some((c) => c.id === secret.id)).toBe(true);

    // A member-specific allow re-grants access.
    await api(a.cookie, `/api/channels/${secret.id}/overwrites`, { method: "PUT", json: { targetType: "user", targetId: b.user.id, allow: Permission.VIEW_CHANNEL, deny: 0 } });
    expect((await apiRaw(b.cookie, `/api/channels/${secret.id}/messages`)).status).toBe(200);
  });

  it("search never returns messages from hidden channels", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    const secret = await createChannel(a, ws.id, "secret");
    const everyone = ws.roles.find((r) => r.isDefault)!;
    await api(a.cookie, `/api/channels/${secret.id}/overwrites`, { method: "PUT", json: { targetType: "role", targetId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL } });
    await sendMessage(a, secret.id, "the launch codes are pineapple");
    await sendMessage(a, textChannel(ws).id, "pineapple on pizza is fine");

    const asA = await api<{ total: number }>(a.cookie, `/api/workspaces/${ws.id}/search?q=pineapple`);
    expect(asA.total).toBe(2);
    const asB = await api<{ total: number; results: { message: { channelId: string } }[] }>(b.cookie, `/api/workspaces/${ws.id}/search?q=pineapple`);
    expect(asB.total).toBe(1);
    expect(asB.results[0]!.message.channelId).toBe(textChannel(ws).id);
  });
});

describe("messages", () => {
  it("assigns monotonically increasing sequences and paginates by sequence", async () => {
    const s = await signUp();
    const ws = await createWorkspace(s);
    const ch = textChannel(ws);
    const sent = [];
    for (let i = 1; i <= 7; i++) sent.push(await sendMessage(s, ch.id, `message ${i}`));
    expect(sent.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const page1 = await api<MessagePage>(s.cookie, `/api/channels/${ch.id}/messages?limit=3`);
    expect(page1.messages.map((m) => m.sequence)).toEqual([5, 6, 7]);
    expect(page1.hasMore).toBe(true);
    const page2 = await api<MessagePage>(s.cookie, `/api/channels/${ch.id}/messages?limit=3&before=5`);
    expect(page2.messages.map((m) => m.sequence)).toEqual([2, 3, 4]);
    const page3 = await api<MessagePage>(s.cookie, `/api/channels/${ch.id}/messages?limit=3&before=2`);
    expect(page3.messages.map((m) => m.sequence)).toEqual([1]);
    expect(page3.hasMore).toBe(false);
    const after = await api<MessagePage>(s.cookie, `/api/channels/${ch.id}/messages?after=5`);
    expect(after.messages.map((m) => m.sequence)).toEqual([6, 7]);
  });

  it("is idempotent on clientMessageId", async () => {
    const s = await signUp();
    const ws = await createWorkspace(s);
    const ch = textChannel(ws);
    const first = await sendMessage(s, ch.id, "once", "client-1");
    const again = await sendMessage(s, ch.id, "once", "client-1");
    expect(again.id).toBe(first.id);
    expect(again.sequence).toBe(first.sequence);
    const rows = await env.DB.prepare("SELECT count(*) AS n FROM messages WHERE channel_id = ?").bind(ch.id).first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("rejects empty and oversized messages", async () => {
    const s = await signUp();
    const ws = await createWorkspace(s);
    const ch = textChannel(ws);
    expect((await apiRaw(s.cookie, `/api/channels/${ch.id}/messages`, { method: "POST", json: { content: "   ", clientMessageId: "e" } })).status).toBe(400);
    expect((await apiRaw(s.cookie, `/api/channels/${ch.id}/messages`, { method: "POST", json: { content: "x".repeat(2001), clientMessageId: "big" } })).status).toBe(400);
  });

  it("enforces edit and delete authorization", async () => {
    const a = await signUp();
    const b = await signUp();
    const c = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    await joinViaInvite(c, inv.code);
    const ch = textChannel(ws);
    const msg = await sendMessage(b, ch.id, "original");

    // Others cannot edit.
    expect((await apiRaw(c.cookie, `/api/channels/${ch.id}/messages/${msg.id}`, { method: "PATCH", json: { content: "hijack" } })).status).toBe(403);
    // Author can edit.
    const edited = await api<{ content: string; editedAt: string | null }>(b.cookie, `/api/channels/${ch.id}/messages/${msg.id}`, { method: "PATCH", json: { content: "fixed" } });
    expect(edited.content).toBe("fixed");
    expect(edited.editedAt).not.toBeNull();
    // Plain member cannot delete someone else's message.
    expect((await apiRaw(c.cookie, `/api/channels/${ch.id}/messages/${msg.id}`, { method: "DELETE" })).status).toBe(403);
    // Give C MANAGE_MESSAGES via a role — now allowed and audited.
    const role = await api<{ id: string }>(a.cookie, `/api/workspaces/${ws.id}/roles`, { method: "POST", json: { name: "Mods", permissions: Permission.MANAGE_MESSAGES } });
    await api(a.cookie, `/api/workspaces/${ws.id}/members/${c.user.id}/roles`, { method: "PUT", json: { roleIds: [role.id] } });
    expect((await apiRaw(c.cookie, `/api/channels/${ch.id}/messages/${msg.id}`, { method: "DELETE" })).status).toBe(204);
    const history = await api<MessagePage>(a.cookie, `/api/channels/${ch.id}/messages`);
    expect(history.messages.some((m) => m.id === msg.id)).toBe(false);
    const audit = await api<{ action: string }[]>(a.cookie, `/api/workspaces/${ws.id}/audit-log`);
    expect(audit.some((e) => e.action === "message.deleted_by_moderator")).toBe(true);
  });

  it("reactions are unique per user and emoji", async () => {
    const s = await signUp();
    const ws = await createWorkspace(s);
    const ch = textChannel(ws);
    const msg = await sendMessage(s, ch.id, "react to me");
    await api(s.cookie, `/api/channels/${ch.id}/messages/${msg.id}/reactions`, { method: "PUT", json: { emoji: "👍" } });
    const twice = await api<{ emoji: string; count: number; me: boolean }[]>(s.cookie, `/api/channels/${ch.id}/messages/${msg.id}/reactions`, { method: "PUT", json: { emoji: "👍" } });
    expect(twice).toEqual([{ emoji: "👍", count: 1, me: true, userIds: [s.user.id] }]);
    const removed = await api<unknown[]>(s.cookie, `/api/channels/${ch.id}/messages/${msg.id}/reactions/${encodeURIComponent("👍")}`, { method: "DELETE" });
    expect(removed).toEqual([]);
  });
});

describe("uploads", () => {
  it("authorises uploads only with ATTACH_FILES and a safe filename", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    const ch = textChannel(ws);

    const ok = await api<{ attachmentId: string; mode: string; uploadUrl: string }>(b.cookie, "/api/uploads/authorize", { method: "POST", json: { channelId: ch.id, filename: "photo.png", mimeType: "image/png", byteSize: 1234 } });
    expect(ok.attachmentId).toBeTruthy();
    expect(ok.mode).toBe("proxy"); // no R2 credentials in tests

    const blocked = await apiRaw(b.cookie, "/api/uploads/authorize", { method: "POST", json: { channelId: ch.id, filename: "virus.exe", mimeType: "application/octet-stream", byteSize: 10 } });
    expect(blocked.status).toBe(400);

    const tooBig = await apiRaw(b.cookie, "/api/uploads/authorize", { method: "POST", json: { channelId: ch.id, filename: "big.zip", mimeType: "application/zip", byteSize: 999_999_999 } });
    expect(tooBig.status).toBe(400);

    const everyone = ws.roles.find((r) => r.isDefault)!;
    await api(a.cookie, `/api/channels/${ch.id}/overwrites`, { method: "PUT", json: { targetType: "role", targetId: everyone.id, allow: 0, deny: Permission.ATTACH_FILES } });
    const denied = await apiRaw(b.cookie, "/api/uploads/authorize", { method: "POST", json: { channelId: ch.id, filename: "photo.png", mimeType: "image/png", byteSize: 1234 } });
    expect(denied.status).toBe(403);
  });

  it("completes a proxied upload, sniffs the real type and serves it only to members", async () => {
    const a = await signUp();
    const outsider = await signUp();
    const ws = await createWorkspace(a);
    const ch = textChannel(ws);
    const auth = await api<{ attachmentId: string; uploadUrl: string }>(a.cookie, "/api/uploads/authorize", { method: "POST", json: { channelId: ch.id, filename: "fake.png", mimeType: "image/png", byteSize: 4 } });
    // Declared as PNG but the bytes are a PDF header.
    const put = await apiRaw(a.cookie, auth.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: "%PDF-1.4 fake" });
    expect(put.status).toBe(200);
    const done = await api<{ mimeType: string; url: string }>(a.cookie, "/api/uploads/complete", { method: "POST", json: { attachmentId: auth.attachmentId } });
    expect(done.mimeType).toBe("application/pdf");
    const file = await apiRaw(a.cookie, done.url);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("application/pdf");
    expect((await apiRaw(outsider.cookie, done.url)).status).toBe(404);
    expect((await apiRaw(null, done.url)).status).toBe(401);
  });
});

describe("voice", () => {
  it("guards the token endpoint: auth, membership, channel kind, configuration", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const lounge = ws.channels.find((c) => c.kind === "voice")!;
    expect((await apiRaw(null, `/api/channels/${lounge.id}/voice/join`, { method: "POST" })).status).toBe(401);
    expect((await apiRaw(b.cookie, `/api/channels/${lounge.id}/voice/join`, { method: "POST" })).status).toBe(404);
    // Configured credentials are absent in tests → explicit 503 before any upstream call.
    const res = await apiRaw(a.cookie, `/api/channels/${lounge.id}/voice/join`, { method: "POST" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_configured");
  });

  it("denies CONNECT when the channel overwrite removes it", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    const lounge = ws.channels.find((c) => c.kind === "voice")!;
    const everyone = ws.roles.find((r) => r.isDefault)!;
    await api(a.cookie, `/api/channels/${lounge.id}/overwrites`, { method: "PUT", json: { targetType: "role", targetId: everyone.id, allow: 0, deny: Permission.CONNECT } });
    const asB = await api<WorkspaceDetail>(b.cookie, `/api/workspaces/${ws.id}`);
    const ch = asB.channels.find((c) => c.id === lounge.id) as Channel;
    expect(ch.permissions & Permission.CONNECT).toBe(0);
    // Permission check happens before the configuration check, so this is a 403 not a 503.
    expect((await apiRaw(b.cookie, `/api/channels/${lounge.id}/voice/join`, { method: "POST" })).status).toBe(403);
  });
});

describe("custom emojis", () => {
  it("lets managers upload and name emojis, members list them, and enforces limits", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    const inv = await invite(a, ws.id, {});
    await joinViaInvite(b, inv.code);
    // 1x1 PNG
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

    // Plain members lack MANAGE_EMOJIS.
    const denied = await apiRaw(b.cookie, "/api/uploads/authorize", { method: "POST", json: { channelId: "none", workspaceId: ws.id, filename: "wave.png", mimeType: "image/png", byteSize: png.length, purpose: "emoji" } });
    expect(denied.status).toBe(403);

    const auth = await api<{ attachmentId: string; uploadUrl: string }>(a.cookie, "/api/uploads/authorize", { method: "POST", json: { channelId: "none", workspaceId: ws.id, filename: "wave.png", mimeType: "image/png", byteSize: png.length, purpose: "emoji" } });
    expect(auth.attachmentId.startsWith(`emojis/${ws.id}/`)).toBe(true);
    expect((await apiRaw(a.cookie, auth.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png })).status).toBe(200);
    const done = await api<{ key: string }>(a.cookie, "/api/uploads/complete", { method: "POST", json: { attachmentId: auth.attachmentId } });

    // Invalid names are rejected; valid ones created once.
    expect((await apiRaw(a.cookie, `/api/workspaces/${ws.id}/emojis`, { method: "POST", json: { name: "Bad Name!", key: done.key } })).status).toBe(400);
    const created = await api<{ id: string; name: string; url: string }>(a.cookie, `/api/workspaces/${ws.id}/emojis`, { method: "POST", json: { name: "party_wave", key: done.key } });
    expect(created.url).toBe(`/api/files/${done.key}`);
    expect((await apiRaw(a.cookie, `/api/workspaces/${ws.id}/emojis`, { method: "POST", json: { name: "party_wave", key: done.key } })).status).toBe(409);
    // A key from another workspace prefix is refused.
    expect((await apiRaw(a.cookie, `/api/workspaces/${ws.id}/emojis`, { method: "POST", json: { name: "other", key: "emojis/not-this-workspace/x" } })).status).toBe(403);

    // Members can list and load the image; outsiders cannot.
    const list = await api<{ name: string }[]>(b.cookie, `/api/workspaces/${ws.id}/emojis`);
    expect(list.map((e) => e.name)).toEqual(["party_wave"]);
    expect((await apiRaw(b.cookie, created.url)).status).toBe(200);
    const outsider = await signUp();
    expect((await apiRaw(outsider.cookie, created.url)).status).toBe(404);
    expect((await apiRaw(outsider.cookie, `/api/workspaces/${ws.id}/emojis`)).status).toBe(404);

    // Reactions accept the shortcode form.
    const ch = textChannel(ws);
    const msg = await sendMessage(b, ch.id, "hello :party_wave:");
    const reactions = await api<{ emoji: string; count: number }[]>(b.cookie, `/api/channels/${ch.id}/messages/${msg.id}/reactions`, { method: "PUT", json: { emoji: ":party_wave:" } });
    expect(reactions).toEqual([{ emoji: ":party_wave:", count: 1, me: true, userIds: [b.user.id] }]);

    // Delete requires the permission and removes the emoji.
    expect((await apiRaw(b.cookie, `/api/workspaces/${ws.id}/emojis/${created.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await apiRaw(a.cookie, `/api/workspaces/${ws.id}/emojis/${created.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await api<unknown[]>(a.cookie, `/api/workspaces/${ws.id}/emojis`)).toEqual([]);
  });
});
