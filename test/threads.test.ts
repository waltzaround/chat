import { describe, expect, it } from "vitest";
import type { Message, MessagePage, WorkspaceDetail } from "../shared/types";
import { api, apiRaw, createWorkspace, invite, joinViaInvite, openUserSocket, sendMessage, signUp, textChannel } from "./helpers";

const reply = (cookie: string, channelId: string, threadRootId: string, content: string) =>
  api<Message>(cookie, `/api/channels/${channelId}/messages`, { method: "POST", json: { content, clientMessageId: crypto.randomUUID(), threadRootId } });

describe("threads", () => {
  it("keeps replies out of the channel, counts them on the root, and notifies its author", async () => {
    const a = await signUp();
    const b = await signUp();
    const ws = await createWorkspace(a);
    await joinViaInvite(b, (await invite(a, ws.id)).code);
    const ch = textChannel(ws).id;
    const root = await sendMessage(a, ch, "Launch plan: thoughts?");
    const inbox = await openUserSocket(a);

    const first = await reply(b.cookie, ch, root.id, "Looks good");
    expect(first.threadRootId).toBe(root.id);
    expect(await inbox.waitFor((e) => e.type === "notification")).toMatchObject({ notification: { threadRootId: root.id, preview: "Looks good" } });
    inbox.close();
    await reply(b.cookie, ch, root.id, "One question though");
    await sendMessage(b, ch, "unrelated channel message");

    const channelPage = await api<MessagePage>(a.cookie, `/api/channels/${ch}/messages`);
    expect(channelPage.messages.map((m) => m.content)).toEqual(["Launch plan: thoughts?", "unrelated channel message"]);
    expect(channelPage.messages[0]!.thread).toMatchObject({ replyCount: 2 });
    const threadPage = await api<MessagePage>(a.cookie, `/api/channels/${ch}/messages?thread=${root.id}`);
    expect(threadPage.messages.map((m) => m.content)).toEqual(["Looks good", "One question though"]);

    const detail = await api<WorkspaceDetail>(a.cookie, `/api/workspaces/${ws.id}`);
    expect(detail.channels.find((c) => c.id === ch)!.mentionCount).toBe(2);

    await api(b.cookie, `/api/channels/${ch}/messages/${first.id}`, { method: "DELETE" });
    const after = await api<MessagePage>(a.cookie, `/api/channels/${ch}/messages`);
    expect(after.messages[0]!.thread).toMatchObject({ replyCount: 1 });
  });

  it("refuses threads inside threads and threads on missing messages", async () => {
    const a = await signUp();
    const ws = await createWorkspace(a);
    const ch = textChannel(ws).id;
    const root = await sendMessage(a, ch, "root");
    const inThread = await reply(a.cookie, ch, root.id, "reply");
    const post = (threadRootId: string) =>
      apiRaw(a.cookie, `/api/channels/${ch}/messages`, { method: "POST", json: { content: "x", clientMessageId: crypto.randomUUID(), threadRootId } });
    expect((await post(inThread.id)).status).toBe(400);
    await api(a.cookie, `/api/channels/${ch}/messages/${root.id}`, { method: "DELETE" });
    expect((await post(root.id)).status).toBe(400);
  });
});
