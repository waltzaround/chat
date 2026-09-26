import { describe, expect, it } from "vitest";
import { Permission } from "../shared/permissions";
import type { SearchResponse } from "../shared/types";
import { api, createChannel, createWorkspace, invite, joinViaInvite, sendMessage, signUp, textChannel } from "./helpers";

describe("search everywhere", () => {
  it("finds messages across your workspaces and DMs, never in channels you can't see", async () => {
    const a = await signUp();
    const b = await signUp();
    const mine = await createWorkspace(a, "Mine");
    const theirs = await createWorkspace(b, "Theirs");
    await joinViaInvite(a, (await invite(b, theirs.id)).code);
    const secret = await createChannel(b, theirs.id, "secret");
    const everyone = theirs.roles.find((r) => r.isDefault)!;
    await api(b.cookie, `/api/channels/${secret.id}/overwrites`, { method: "PUT", json: { targetType: "role", targetId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL } });
    const dm = await api<{ channelId: string }>(a.cookie, "/api/dms", { method: "POST", json: { userId: b.user.id } });

    await sendMessage(a, textChannel(mine).id, "banana bread recipe");
    await sendMessage(b, textChannel(theirs).id, "banana split party");
    await sendMessage(b, secret.id, "banana secret plans");
    await sendMessage(b, dm.channelId, "want some banana?");

    const found = await api<SearchResponse>(a.cookie, "/api/search?q=banana");
    expect(found.total).toBe(3);
    const where = found.results.map((r) => (r.workspace!.kind === "dm" ? `dm:${r.workspace!.dmPeerName}` : `${r.workspace!.name}#${r.channelName}`)).sort();
    expect(where).toEqual([`Mine#general`, `Theirs#general`, `dm:${b.user.displayName}`].sort());

    const byB = await api<SearchResponse>(a.cookie, `/api/search?q=banana&authorId=${b.user.id}`);
    expect(byB.total).toBe(2);
  });

  it("copes with more channels than D1 allows query parameters", async () => {
    const a = await signUp();
    const ws = await createWorkspace(a, "Busy");
    for (let i = 0; i < 105; i++) await createChannel(a, ws.id, `room-${i}`);
    await sendMessage(a, textChannel(ws).id, "needle in a haystack");
    expect((await api<SearchResponse>(a.cookie, "/api/search?q=needle")).total).toBe(1);
  });
});
