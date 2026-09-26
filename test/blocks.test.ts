import { describe, expect, it } from "vitest";
import type { DirectMessage, UserSummary, WorkspaceDetail } from "../shared/types";
import { api, apiRaw, createWorkspace, invite, joinViaInvite, sendMessage, signUp, textChannel } from "./helpers";

async function neighbours() {
  const a = await signUp();
  const b = await signUp();
  const ws = await createWorkspace(a);
  await joinViaInvite(b, (await invite(a, ws.id)).code);
  return { a, b, ws };
}

const post = (cookie: string, channelId: string, content: string) =>
  apiRaw(cookie, `/api/channels/${channelId}/messages`, { method: "POST", json: { content, clientMessageId: crypto.randomUUID() } });

describe("blocking", () => {
  it("makes a DM read-only both ways and stops new ones, until unblocked", async () => {
    const { a, b } = await neighbours();
    const dm = await api<{ workspaceId: string; channelId: string }>(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });
    await sendMessage(b, dm.channelId, "hi");

    await api(a.cookie, `/api/me/blocks/${b.user.id}`, { method: "PUT" });
    expect((await api<UserSummary[]>(a.cookie, "/api/me/blocks")).map((u) => u.id)).toEqual([b.user.id]);
    expect((await post(b.cookie, dm.channelId, "hello?")).status).toBe(403);
    expect((await post(a.cookie, dm.channelId, "bye")).status).toBe(403);
    // History stays readable, and the composer knows it can't send.
    const detail = await api<WorkspaceDetail>(b.cookie, `/api/workspaces/${dm.workspaceId}`);
    expect(detail.channels[0]!.permissions & (1 << 9)).toBe(0);
    expect((await api<UserSummary[]>(b.cookie, "/api/dms/people")).map((u) => u.id)).not.toContain(a.user.id);

    await api(a.cookie, `/api/me/blocks/${b.user.id}`, { method: "DELETE" });
    expect((await post(b.cookie, dm.channelId, "friends again?")).status).toBe(201);
  });

  it("refuses to start a conversation with someone who blocked you", async () => {
    const { a, b } = await neighbours();
    await api(b.cookie, `/api/me/blocks/${a.user.id}`, { method: "PUT" });
    expect((await apiRaw(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } })).status).toBe(403);
  });

  it("stops a blocked person's mentions notifying you", async () => {
    const { a, b, ws } = await neighbours();
    await api(a.cookie, `/api/me/blocks/${b.user.id}`, { method: "PUT" });
    await sendMessage(b, textChannel(ws).id, `@${a.user.username} look at this`);
    const detail = await api<WorkspaceDetail>(a.cookie, `/api/workspaces/${ws.id}`);
    expect(detail.channels.find((c) => c.id === textChannel(ws).id)!.mentionCount).toBe(0);
  });
});

describe("closing a DM", () => {
  it("hides it until someone writes again", async () => {
    const { a, b } = await neighbours();
    const dm = await api<{ workspaceId: string; channelId: string }>(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });
    await sendMessage(b, dm.channelId, "first");
    await api(a.cookie, `/api/dms/${dm.workspaceId}/close`, { method: "POST" });
    expect(await api<DirectMessage[]>(a.cookie, "/api/dms")).toEqual([]);
    await sendMessage(b, dm.channelId, "second");
    expect((await api<DirectMessage[]>(a.cookie, "/api/dms")).map((d) => d.workspaceId)).toEqual([dm.workspaceId]);

    await api(a.cookie, `/api/dms/${dm.workspaceId}/close`, { method: "POST" });
    await api(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });
    expect((await api<DirectMessage[]>(a.cookie, "/api/dms")).map((d) => d.workspaceId)).toEqual([dm.workspaceId]);
  });
});
