import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { MessagePage } from "../shared/types";
import { deleteUserMessagesBatch } from "../worker/lib/accounts";
import { createDb } from "../worker/db";
import { api, apiRaw, createWorkspace, invite, joinViaInvite, sendMessage, signUp, signUpRaw, textChannel } from "./helpers";

// The first sign-up in this file is the server owner.
const owner = await signUp("accountsowner");

async function signInStatus(username: string, password = "password123"): Promise<number> {
  const res = await apiRaw(null, "/api/auth/sign-in/email", { method: "POST", json: { email: `${username}@example.com`, password } });
  return res.status;
}

describe("data export", () => {
  it("downloads profile, memberships and messages as JSON", async () => {
    const me = await signUp("exporter");
    const ws = await createWorkspace(me, "Export Club");
    await sendMessage(me, textChannel(ws).id, "first thing I said");
    await sendMessage(me, textChannel(ws).id, "second thing");
    const res = await apiRaw(me.cookie, "/api/me/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="chat-export-exporter-/);
    const data = (await res.json()) as { profile: { email: string }; workspaces: Array<{ name: string }>; messages: Array<{ content: string; channel: string }>; signInMethods: Array<{ provider: string }> };
    expect(data.profile.email).toBe("exporter@example.com");
    expect(data.workspaces.map((w) => w.name)).toEqual(["Export Club"]);
    expect(data.messages.map((m) => m.content)).toEqual(["first thing I said", "second thing"]);
    expect(data.signInMethods[0]?.provider).toBe("credential");
  });
});

describe("account deletion", () => {
  it("asks for confirmation, needs owned workspaces handed over, then anonymises the account", async () => {
    const leaver = await signUp("leaver");
    const friend = await signUp("friend");
    const ws = await createWorkspace(leaver, "Leaver's Place");
    await joinViaInvite(friend, (await invite(leaver, ws.id)).code);
    const said = await sendMessage(leaver, textChannel(ws).id, "goodbye everyone");

    const del = (body: Record<string, unknown>) => apiRaw(leaver.cookie, "/api/me", { method: "DELETE", json: body });
    expect((await del({ confirmUsername: "someone-else", password: "password123" })).status).toBe(400);
    expect((await del({ confirmUsername: "leaver", password: "wrong-password" })).status).toBe(400);
    const blocked = await del({ confirmUsername: "leaver", password: "password123" });
    expect(blocked.status).toBe(409);
    expect(await blocked.text()).toMatch(/Leaver's Place/);

    // Only the owner can transfer, and only to a member.
    expect((await apiRaw(friend.cookie, `/api/workspaces/${ws.id}/owner`, { method: "POST", json: { userId: friend.user.id } })).status).toBe(403);
    await api(leaver.cookie, `/api/workspaces/${ws.id}/owner`, { method: "POST", json: { userId: friend.user.id } });

    expect((await del({ confirmUsername: "Leaver", password: "password123" })).status).toBe(204);
    expect((await apiRaw(leaver.cookie, "/api/me")).status).toBe(401);
    expect(await signInStatus("leaver")).toBe(401);

    // The message stays, now from "Deleted user"; the email and username are free again.
    const page = await api<MessagePage>(friend.cookie, `/api/channels/${textChannel(ws).id}/messages`);
    const kept = page.messages.find((m) => m.id === said.id)!;
    expect(kept.content).toBe("goodbye everyone");
    expect(kept.author?.displayName).toBe("Deleted user");
    expect((await signUpRaw("leaver")).status).toBe(200);
  });

  it("lets the server owner delete another account, with its messages", async () => {
    const spammer = await signUp("spammer2");
    const ws = await createWorkspace(owner, "Owner's Place");
    await joinViaInvite(spammer, (await invite(owner, ws.id)).code);
    const spam = await sendMessage(spammer, textChannel(ws).id, "spam spam spam");

    expect((await apiRaw(spammer.cookie, `/api/server/users/${owner.user.id}`, { method: "DELETE", json: {} })).status).toBe(403);
    expect((await apiRaw(owner.cookie, `/api/server/users/${owner.user.id}`, { method: "DELETE", json: {} })).status).toBe(400);
    expect((await apiRaw(owner.cookie, "/api/me", { method: "DELETE", json: { confirmUsername: "accountsowner", password: "password123" } })).status).toBe(409);
    expect((await apiRaw(owner.cookie, `/api/server/users/${spammer.user.id}`, { method: "DELETE", json: { deleteMessages: true } })).status).toBe(204);

    // The queue job deletes the messages in batches; run one batch directly.
    await deleteUserMessagesBatch(env, createDb(env.DB), spammer.user.id);
    const page = await api<MessagePage>(owner.cookie, `/api/channels/${textChannel(ws).id}/messages`);
    expect(page.messages.map((m) => m.id)).not.toContain(spam.id);
  });
});
