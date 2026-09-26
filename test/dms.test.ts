import { describe, expect, it } from "vitest";
import type { DirectMessage, ReportedMessage, WorkspaceDetail, WorkspaceSummary } from "../shared/types";
import { api, apiRaw, createWorkspace, invite, joinViaInvite, openUserSocket, sendMessage, signUp } from "./helpers";

// First sign-up in this file is the server owner, who handles reports about DMs.
const owner = await signUp("dmowner");

async function neighbours() {
  const a = await signUp();
  const b = await signUp();
  const ws = await createWorkspace(a);
  await joinViaInvite(b, (await invite(a, ws.id)).code);
  return { a, b };
}

describe("direct messages", () => {
  it("opens one conversation per pair, only with people you share a workspace with", async () => {
    const { a, b } = await neighbours();
    const stranger = await signUp();
    const first = await apiRaw(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });
    expect(first.status).toBe(201);
    const opened = (await first.json()) as { workspaceId: string; channelId: string };
    expect(await api(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } })).toEqual(opened);
    expect(await api(b.cookie, "/api/dms", { method: "POST", json: { userId: a.user.id } })).toEqual(opened);
    expect((await apiRaw(a.cookie, "/api/dms", { method: "POST", json: { userId: stranger.user.id } })).status).toBe(403);
    expect((await apiRaw(a.cookie, "/api/dms", { method: "POST", json: { userId: a.user.id } })).status).toBe(400);
    const people = await api<Array<{ id: string }>>(a.cookie, "/api/dms/people");
    expect(people.map((p) => p.id)).toContain(b.user.id);
    expect(people.map((p) => p.id)).not.toContain(stranger.user.id);
  });

  it("notifies, counts unread, and stays out of the workspace list", async () => {
    const { a, b } = await neighbours();
    const dm = await api<{ workspaceId: string; channelId: string }>(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });
    const inbox = await openUserSocket(b);
    await sendMessage(a, dm.channelId, "psst");
    expect(await inbox.waitFor((e) => e.type === "notification")).toMatchObject({ notification: { kind: "dm", workspaceId: dm.workspaceId, preview: "psst" } });
    inbox.close();

    const list = await api<DirectMessage[]>(b.cookie, "/api/dms");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ workspaceId: dm.workspaceId, unreadCount: 1, peer: { id: a.user.id } });
    const sent = await api<{ messages: Array<{ sequence: number }> }>(b.cookie, `/api/channels/${dm.channelId}/messages`);
    await api(b.cookie, `/api/channels/${dm.channelId}/read`, { method: "POST", json: { sequence: sent.messages.at(-1)!.sequence } });
    expect((await api<DirectMessage[]>(b.cookie, "/api/dms"))[0]?.unreadCount).toBe(0);
    const workspaces = await api<WorkspaceSummary[]>(b.cookie, "/api/me/workspaces");
    expect(workspaces.some((w) => w.id === dm.workspaceId)).toBe(false);
    const detail = await api<WorkspaceDetail>(b.cookie, `/api/workspaces/${dm.workspaceId}`);
    expect(detail).toMatchObject({ kind: "dm", dmPeer: { id: a.user.id } });
  });

  it("allows chatting but no management or moderation", async () => {
    const { a, b } = await neighbours();
    const dm = await api<{ workspaceId: string; channelId: string }>(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });
    for (const [method, path, json] of [
      ["PATCH", `/api/workspaces/${dm.workspaceId}`, { name: "hijack" }],
      ["POST", `/api/workspaces/${dm.workspaceId}/invites`, {}],
      ["POST", `/api/workspaces/${dm.workspaceId}/channels`, { name: "more", kind: "text" }],
      ["DELETE", `/api/workspaces/${dm.workspaceId}`, undefined],
    ] as const) {
      expect((await apiRaw(a.cookie, path, { method, json })).status, `${method} ${path}`).toBe(403);
    }
    const theirs = await sendMessage(b, dm.channelId, "mine");
    expect((await apiRaw(a.cookie, `/api/channels/${dm.channelId}/messages/${theirs.id}`, { method: "DELETE" })).status).toBe(403);
  });

  it("sends reports about direct messages to the server owner", async () => {
    const { a, b } = await neighbours();
    const dm = await api<{ workspaceId: string; channelId: string }>(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });
    const rude = await sendMessage(a, dm.channelId, "rude words");
    await api(b.cookie, `/api/channels/${dm.channelId}/messages/${rude.id}/report`, { method: "POST", json: { reason: "harassment" } });
    expect((await apiRaw(b.cookie, "/api/server/reports")).status).toBe(403);
    const queue = await api<ReportedMessage[]>(owner.cookie, "/api/server/reports");
    expect(queue.map((r) => r.messageId)).toContain(rude.id);
    await api(owner.cookie, `/api/server/reports/${rude.id}/resolve`, { method: "POST", json: { action: "remove" } });
    expect((await api<ReportedMessage[]>(owner.cookie, "/api/server/reports")).map((r) => r.messageId)).not.toContain(rude.id);
  });

  it("does not block deleting an account that started conversations", async () => {
    const { a, b } = await neighbours();
    await api(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });
    // a owns the community workspace from neighbours(); hand it over first.
    const ws = (await api<WorkspaceSummary[]>(a.cookie, "/api/me/workspaces"))[0]!;
    await api(a.cookie, `/api/workspaces/${ws.id}/owner`, { method: "POST", json: { userId: b.user.id } });
    expect((await apiRaw(a.cookie, "/api/me", { method: "DELETE", json: { confirmUsername: a.user.username, password: "password123" } })).status).toBe(204);
    const list = await api<DirectMessage[]>(b.cookie, "/api/dms");
    expect(list[0]?.peer.displayName).toBe("Deleted user");
  });
});
