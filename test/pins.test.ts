import { describe, expect, it } from "vitest";
import type { Message } from "../shared/types";
import { api, apiRaw, createWorkspace, invite, joinViaInvite, sendMessage, signUp, textChannel } from "./helpers";

describe("pinned messages", () => {
  it("lets moderators pin in channels, newest pin first, and drops deleted ones", async () => {
    const owner = await signUp();
    const member = await signUp();
    const ws = await createWorkspace(owner);
    await joinViaInvite(member, (await invite(owner, ws.id)).code);
    const ch = textChannel(ws).id;
    const first = await sendMessage(member, ch, "rules: be kind");
    const second = await sendMessage(member, ch, "schedule: fridays");

    expect((await apiRaw(member.cookie, `/api/channels/${ch}/messages/${first.id}/pin`, { method: "PUT" })).status).toBe(403);
    const pinned = await api<Message>(owner.cookie, `/api/channels/${ch}/messages/${first.id}/pin`, { method: "PUT" });
    expect(pinned.pinnedAt).not.toBeNull();
    await api(owner.cookie, `/api/channels/${ch}/messages/${second.id}/pin`, { method: "PUT" });
    expect((await api<Message[]>(member.cookie, `/api/channels/${ch}/pins`)).map((m) => m.id)).toEqual([second.id, first.id]);

    await api(owner.cookie, `/api/channels/${ch}/messages/${second.id}/pin`, { method: "DELETE" });
    await api(member.cookie, `/api/channels/${ch}/messages/${first.id}`, { method: "DELETE" });
    expect(await api<Message[]>(member.cookie, `/api/channels/${ch}/pins`)).toEqual([]);
  });

  it("lets both people pin in a DM", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    await joinViaInvite(b, (await invite(a, ws.id)).code);
    const dm = await api<{ channelId: string }>(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });
    const msg = await sendMessage(a, dm.channelId, "address: 1 Main St");
    await api(b.cookie, `/api/channels/${dm.channelId}/messages/${msg.id}/pin`, { method: "PUT" });
    expect((await api<Message[]>(a.cookie, `/api/channels/${dm.channelId}/pins`)).map((m) => m.id)).toEqual([msg.id]);
  });
});
