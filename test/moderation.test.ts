import { describe, expect, it } from "vitest";
import type { WorkspaceDetail } from "../shared/types";
import { findFilteredTerm } from "../shared/moderation";
import { api, apiRaw, createWorkspace, invite, joinViaInvite, sendMessage, signUp, textChannel } from "./helpers";

const post = (cookie: string, channelId: string, content: string) =>
  apiRaw(cookie, `/api/channels/${channelId}/messages`, { method: "POST", json: { content, clientMessageId: crypto.randomUUID() } });

async function setup() {
  const owner = await signUp();
  const member = await signUp();
  const ws = await createWorkspace(owner);
  await joinViaInvite(member, (await invite(owner, ws.id)).code);
  return { owner, member, ws, ch: textChannel(ws).id };
}

describe("word filter", () => {
  it("matches whole words and phrases, ignoring case", () => {
    expect(findFilteredTerm("That class was great", "ass")).toBeNull();
    expect(findFilteredTerm("what an ASS.", "ass")).toBe("ass");
    expect(findFilteredTerm("no spoilers please", "spoiler")).toBeNull();
    expect(findFilteredTerm("big Bad Phrase here", "bad phrase")).toBe("bad phrase");
  });

  it("rejects filtered messages and edits from members, not moderators", async () => {
    const { owner, member, ws, ch } = await setup();
    await api(owner.cookie, `/api/workspaces/${ws.id}`, { method: "PATCH", json: { wordFilter: "spoiler\n  Bad Phrase \n\n" } });
    expect((await api<WorkspaceDetail>(owner.cookie, `/api/workspaces/${ws.id}`)).wordFilter).toBe("spoiler\nbad phrase");
    expect((await api<WorkspaceDetail>(member.cookie, `/api/workspaces/${ws.id}`)).wordFilter).toBe("");

    const refused = await post(member.cookie, ch, "huge SPOILER: it was him");
    expect(refused.status).toBe(400);
    expect(await refused.text()).toMatch(/doesn't allow/);
    expect((await post(member.cookie, ch, "no spoilers please")).status).toBe(201);
    expect((await post(owner.cookie, ch, "mods can say spoiler")).status).toBe(201);

    const fine = await sendMessage(member, ch, "hello");
    expect((await apiRaw(member.cookie, `/api/channels/${ch}/messages/${fine.id}`, { method: "PATCH", json: { content: "a bad phrase" } })).status).toBe(400);
  });
});

describe("slow mode", () => {
  it("limits how often members post, not moderators", async () => {
    const { owner, member, ws, ch } = await setup();
    await api(owner.cookie, `/api/channels/${ch}`, { method: "PATCH", json: { slowmodeSeconds: 30 } });
    expect((await api<WorkspaceDetail>(member.cookie, `/api/workspaces/${ws.id}`)).channels.find((c) => c.id === ch)!.slowmodeSeconds).toBe(30);
    expect((await apiRaw(owner.cookie, `/api/channels/${ch}`, { method: "PATCH", json: { slowmodeSeconds: 7 } })).status).toBe(400);

    expect((await post(member.cookie, ch, "first")).status).toBe(201);
    const second = await post(member.cookie, ch, "second");
    expect(second.status).toBe(429);
    expect(await second.text()).toMatch(/Slow mode is on/);
    expect((await post(owner.cookie, ch, "one")).status).toBe(201);
    expect((await post(owner.cookie, ch, "two")).status).toBe(201);
  });
});
