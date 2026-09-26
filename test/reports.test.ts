import { describe, expect, it } from "vitest";
import type { MessagePage, ReportedMessage } from "../shared/types";
import { api, apiRaw, createWorkspace, invite, joinViaInvite, sendMessage, signUp, textChannel } from "./helpers";

describe("message reports", () => {
  it("lets members flag a message and moderators remove or dismiss it", async () => {
    const owner = await signUp();
    const ws = await createWorkspace(owner);
    const general = textChannel(ws);
    const link = await invite(owner, ws.id);
    const [spammer, a, b] = [await signUp(), await signUp(), await signUp()];
    for (const s of [spammer, a, b]) await joinViaInvite(s, link.code);

    const spam = await sendMessage(spammer, general.id, "buy cheap followers");
    const fine = await sendMessage(spammer, general.id, "hello all");
    const report = (s: typeof a, messageId: string, reason = "spam") =>
      apiRaw(s.cookie, `/api/channels/${general.id}/messages/${messageId}/report`, { method: "POST", json: { reason, note: "again" } });

    expect((await report(spammer, spam.id)).status).toBe(400);
    expect((await report(a, spam.id)).status).toBe(204);
    expect((await report(a, spam.id)).status).toBe(204); // repeat is a no-op
    expect((await report(b, spam.id, "harassment")).status).toBe(204);
    expect((await report(b, fine.id, "other")).status).toBe(204);

    // Members without Manage Messages cannot see the queue.
    expect((await apiRaw(a.cookie, `/api/workspaces/${ws.id}/reports`)).status).toBe(403);
    const queue = await api<ReportedMessage[]>(owner.cookie, `/api/workspaces/${ws.id}/reports`);
    const flagged = queue.find((r) => r.messageId === spam.id)!;
    expect(flagged.reports.map((r) => r.reason).sort()).toEqual(["harassment", "spam"]);
    expect(flagged.content).toBe("buy cheap followers");
    expect(flagged.author?.id).toBe(spammer.user.id);

    await api(owner.cookie, `/api/workspaces/${ws.id}/reports/${spam.id}/resolve`, { method: "POST", json: { action: "remove" } });
    await api(owner.cookie, `/api/workspaces/${ws.id}/reports/${fine.id}/resolve`, { method: "POST", json: { action: "dismiss" } });
    expect(await api<ReportedMessage[]>(owner.cookie, `/api/workspaces/${ws.id}/reports`)).toEqual([]);

    const page = await api<MessagePage>(a.cookie, `/api/channels/${general.id}/messages`);
    expect(page.messages.map((m) => m.id)).not.toContain(spam.id);
    expect(page.messages.map((m) => m.id)).toContain(fine.id);
  });
});
