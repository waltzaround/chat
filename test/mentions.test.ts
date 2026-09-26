import { describe, expect, it } from "vitest";
import { Permission } from "../shared/permissions";
import type { WorkspaceDetail, WorkspaceSummary } from "../shared/types";
import { parseMentions } from "../worker/lib/mentions";
import { api, createChannel, createWorkspace, invite, joinViaInvite, openUserSocket, sendMessage, signUp, textChannel, type Session } from "./helpers";

async function mentionsIn(s: Session, workspaceId: string, channelId: string): Promise<number> {
  const ws = await api<WorkspaceDetail>(s.cookie, `/api/workspaces/${workspaceId}`);
  return ws.channels.find((c) => c.id === channelId)!.mentionCount;
}

async function setup() {
  const owner = await signUp();
  const ws = await createWorkspace(owner);
  const link = await invite(owner, ws.id);
  const [amy, ben] = [await signUp(), await signUp()];
  await joinViaInvite(amy, link.code);
  await joinViaInvite(ben, link.code);
  return { owner, ws, amy, ben, general: textChannel(ws) };
}

describe("parsing", () => {
  it("finds @usernames, @everyone and @here outside code", () => {
    expect(parseMentions("hi @Amy_1 and @ben.b. see `@notme` and ```\n@nor_me\n``` email a@b.com")).toEqual({ usernames: ["amy_1", "ben.b"], everyone: false, here: false });
    expect(parseMentions("@everyone look")).toMatchObject({ everyone: true, here: false });
    expect(parseMentions("(@here)")).toMatchObject({ here: true });
  });
});

describe("mentions", () => {
  it("counts unread mentions until the channel is read, and notifies on /ws/me", async () => {
    const { owner, ws, amy, general } = await setup();
    const inbox = await openUserSocket(amy);
    const msg = await sendMessage(owner, general.id, `hey @${amy.user.username}, look`);

    const note = await inbox.waitFor((e) => e.type === "notification");
    expect(note).toMatchObject({ notification: { kind: "mention", channelId: general.id, messageId: msg.id, preview: `hey @${amy.user.username}, look` } });
    expect(await mentionsIn(amy, ws.id, general.id)).toBe(1);
    const summary = (await api<WorkspaceSummary[]>(amy.cookie, "/api/me/workspaces")).find((w) => w.id === ws.id)!;
    expect(summary.mentionCount).toBe(1);

    await api(amy.cookie, `/api/channels/${general.id}/read`, { method: "POST", json: { sequence: msg.sequence } });
    expect(await mentionsIn(amy, ws.id, general.id)).toBe(0);
    inbox.close();
  });

  it("skips people who cannot see the channel", async () => {
    const { owner, ws, amy } = await setup();
    const secret = await createChannel(owner, ws.id, "secret");
    const everyoneRole = ws.roles.find((r) => r.isDefault)!;
    await api(owner.cookie, `/api/channels/${secret.id}/overwrites`, { method: "PUT", json: { targetType: "role", targetId: everyoneRole.id, allow: 0, deny: Permission.VIEW_CHANNEL } });
    await sendMessage(owner, secret.id, `@${amy.user.username} you can't see this`);
    const detail = await api<WorkspaceDetail>(amy.cookie, `/api/workspaces/${ws.id}`);
    expect(detail.channels.some((c) => c.id === secret.id)).toBe(false);
    expect((await api<WorkspaceSummary[]>(amy.cookie, "/api/me/workspaces")).find((w) => w.id === ws.id)!.mentionCount).toBe(0);
  });

  it("needs Mention Everyone for @everyone, and counts replies", async () => {
    const { owner, ws, amy, ben, general } = await setup();
    await sendMessage(amy, general.id, "@everyone free pizza"); // members lack the permission
    expect(await mentionsIn(ben, ws.id, general.id)).toBe(0);
    await sendMessage(owner, general.id, "@everyone meeting at 3"); // the owner has every permission
    expect(await mentionsIn(amy, ws.id, general.id)).toBe(1);
    expect(await mentionsIn(ben, ws.id, general.id)).toBe(1);
    expect(await mentionsIn(owner, ws.id, general.id)).toBe(0);

    const question = await sendMessage(ben, general.id, "anyone?");
    await api(amy.cookie, `/api/channels/${general.id}/messages`, { method: "POST", json: { content: "me!", clientMessageId: crypto.randomUUID(), replyTo: question.id } });
    expect(await mentionsIn(ben, ws.id, general.id)).toBe(2);
  });

  it("updates mentions when a message is edited, without notifying again", async () => {
    const { owner, ws, amy, general } = await setup();
    const msg = await sendMessage(owner, general.id, "hello");
    const inbox = await openUserSocket(amy);
    await api(owner.cookie, `/api/channels/${general.id}/messages/${msg.id}`, { method: "PATCH", json: { content: `hello @${amy.user.username}` } });
    expect(await mentionsIn(amy, ws.id, general.id)).toBe(1);
    await expect(inbox.waitFor((e) => e.type === "notification", 300)).rejects.toThrow(/Timed out/);
    inbox.close();
  });
});
