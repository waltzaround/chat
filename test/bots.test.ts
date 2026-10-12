import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailableCommand, Bot, BotSecrets, Member, Message, MessagePage, WorkspaceBot } from "../shared/types";
import { Permission } from "../shared/permissions";
import { ORIGIN, api, apiRaw, createWorkspace, invite, joinViaInvite, sendMessage, signUp, textChannel, type Session } from "./helpers";
import { hmacSha256Hex } from "../worker/lib/crypto";
import { DELIVERY_ATTEMPTS, PAUSE_AFTER_FAILURES, deliverBotEvent, type BotEvent } from "../worker/integrations/bot-events";
import { createDb } from "../worker/db";

afterEach(() => vi.restoreAllMocks());

const EVENTS_URL = "https://bot.example.test/events";

function asBot(token: string, path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  return SELF.fetch(`${ORIGIN}${path}`, {
    ...rest,
    headers: { Authorization: `Bot ${token}`, ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers as Record<string, string>) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

/** The first account in a test file owns the server. */
let owner: Session | null = null;
async function serverOwner(): Promise<Session> {
  owner ??= await signUp("owner");
  return owner;
}

/** A workspace admin (not the server owner) with a fresh bot in their workspace. */
async function setup(eventsUrl: string | null = null) {
  const created = await api<BotSecrets>((await serverOwner()).cookie, "/api/server/bots", { method: "POST", json: { name: "Deploy Bot", description: "Ships things" } });
  if (eventsUrl) await env.DB.prepare("UPDATE bots SET events_url = ? WHERE user_id = ?").bind(eventsUrl, created.bot.id).run();
  const me = await signUp();
  const ws = await createWorkspace(me, "Bots");
  const channel = textChannel(ws);
  await api(me.cookie, `/api/workspaces/${ws.id}/bots`, { method: "POST", json: { botId: created.bot.id } });
  return { me, ws, channel, bot: created.bot, token: created.token!, signingSecret: created.signingSecret! };
}

describe("bots", () => {
  it("are created by the server owner only, with a token and signing secret shown once", async () => {
    const me = await serverOwner();
    const created = await api<BotSecrets>(me.cookie, "/api/server/bots", { method: "POST", json: { name: "Helper" } });
    expect(created.token).toMatch(new RegExp(`^${created.bot.id}\\.`));
    expect(created.signingSecret!.length).toBeGreaterThan(30);
    expect(created.bot.username).toBe("helper");
    expect(created.bot.tokenHint).toBe(created.token!.slice(-4));
    const list = await api<Bot[]>(me.cookie, "/api/server/bots");
    expect(list.find((b) => b.id === created.bot.id)).not.toHaveProperty("token");
    const stranger = await signUp();
    expect((await apiRaw(stranger.cookie, "/api/server/bots", { method: "POST", json: { name: "Mine" } })).status).toBe(403);
  });

  it("sign in with their token and reach only the bot routes", async () => {
    const { ws, channel, token } = await setup();
    expect((await asBot(token, "/api/me")).status).toBe(200);
    expect((await asBot(token, `/api/channels/${channel.id}/messages`)).status).toBe(200);
    expect((await asBot(token, `/api/workspaces/${ws.id}/invites`)).status).toBe(403);
    expect((await asBot(token, "/api/workspaces", { method: "POST", json: { name: "x" } })).status).toBe(403);
    expect((await asBot(token, "/api/dms")).status).toBe(403);
    expect((await asBot(`${token}x`, "/api/me")).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/ws/workspaces/${ws.id}`, { headers: { Upgrade: "websocket", Authorization: `Bot ${token}` } })).status).toBe(401);
  });

  it("join workspaces through an admin, and show as apps", async () => {
    const { me, ws, bot } = await setup();
    const members = await api<Member[]>(me.cookie, `/api/workspaces/${ws.id}/members`);
    expect(members.find((m) => m.userId === bot.id)).toMatchObject({ bot: true, displayName: "Deploy Bot" });
    const listed = await api<WorkspaceBot[]>(me.cookie, `/api/workspaces/${ws.id}/bots`);
    expect(listed.find((b) => b.id === bot.id)?.inWorkspace).toBe(true);
    const member = await signUp();
    await joinViaInvite(member, (await invite(me, ws.id)).code);
    expect((await apiRaw(member.cookie, `/api/workspaces/${ws.id}/bots`, { method: "POST", json: { botId: bot.id } })).status).toBe(403);
    await api(me.cookie, `/api/workspaces/${ws.id}/bots/${bot.id}`, { method: "DELETE" });
    expect((await api<Member[]>(me.cookie, `/api/workspaces/${ws.id}/members`)).some((m) => m.userId === bot.id)).toBe(false);
  });

  it("post cards and buttons, which people can't", async () => {
    const { me, channel, token } = await setup();
    const res = await asBot(token, `/api/channels/${channel.id}/messages`, {
      method: "POST",
      json: {
        content: "Ready to ship",
        embeds: [{ title: "v1.3", description: "3 changes", color: 0x8250df }],
        components: [{ type: "row", components: [{ type: "button", style: "success", label: "Ship it", customId: "ship" }, { type: "button", style: "link", label: "Diff", url: "https://example.com/diff" }, { type: "button", style: "primary", label: "No id" }] }],
      },
    });
    expect(res.status).toBe(201);
    const message = (await res.json()) as Message;
    expect(message.author.bot).toBe(true);
    expect(message.embeds).toEqual([{ type: "rich", title: "v1.3", description: "3 changes", color: 0x8250df }]);
    expect(message.components).toEqual([{ type: "row", components: [{ type: "button", style: "success", label: "Ship it", customId: "ship" }, { type: "button", style: "link", label: "Diff", url: "https://example.com/diff" }] }]);
    const edited = await asBot(token, `/api/channels/${channel.id}/messages/${message.id}`, { method: "PATCH", json: { components: [] } });
    expect(((await edited.json()) as Message).components).toEqual([]);
    const human = await apiRaw(me.cookie, `/api/channels/${channel.id}/messages`, { method: "POST", json: { content: "x", clientMessageId: crypto.randomUUID(), embeds: [{ title: "fake" }] } });
    expect(human.status).toBe(403);
  });

  it("register slash commands, which the composer lists", async () => {
    const { me, ws, token } = await setup();
    const res = await asBot(token, "/api/bots/@me/commands", { method: "PUT", json: [{ name: "deploy", description: "Deploy a branch", usage: "<environment>" }] });
    expect(res.status).toBe(200);
    expect((await asBot(token, "/api/bots/@me/commands", { method: "PUT", json: [{ name: "github", description: "mine" }] })).status).toBe(400);
    const commands = await api<AvailableCommand[]>(me.cookie, `/api/workspaces/${ws.id}/commands`);
    expect(commands).toContainEqual(expect.objectContaining({ name: "deploy", usage: "<environment>", bot: expect.objectContaining({ displayName: "Deploy Bot" }) }));
  });

  it("need Manage integrations, which @everyone doesn't have", async () => {
    const { me, ws } = await setup();
    const everyone = ws.roles.find((r) => r.isDefault)!;
    expect(everyone.permissions & Permission.MANAGE_INTEGRATIONS).toBe(0);
    expect((await api<{ myPermissions: number }>(me.cookie, `/api/workspaces/${ws.id}`)).myPermissions & Permission.MANAGE_INTEGRATIONS).toBeTruthy();
  });
});

describe("events URL", () => {
  it("is checked with a signed ping before it's saved", async () => {
    const me = await serverOwner();
    const { bot, signingSecret } = await api<BotSecrets>(me.cookie, "/api/server/bots", { method: "POST", json: { name: "Pinger" } });
    let seen: { headers: Headers; body: string } | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      seen = { headers: new Headers(init?.headers), body: String(init?.body) };
      return String(input) === EVENTS_URL ? new Response(null, { status: 204 }) : new Response("nope", { status: 500 });
    });
    const saved = await api<Bot>(me.cookie, `/api/server/bots/${bot.id}`, { method: "PATCH", json: { eventsUrl: EVENTS_URL } });
    expect(saved.eventsUrl).toBe(EVENTS_URL);
    const { headers, body } = seen!;
    expect(headers.get("x-chat-event")).toBe("ping");
    expect(headers.get("x-chat-signature")).toBe(`sha256=${await hmacSha256Hex(signingSecret!, `${headers.get("x-chat-timestamp")}.${body}`)}`);
    const failing = await apiRaw(me.cookie, `/api/server/bots/${bot.id}`, { method: "PATCH", json: { eventsUrl: "https://bot.example.test/broken" } });
    expect(failing.status).toBe(400);
    expect(((await failing.json()) as { error: { message: string } }).error.message).toContain("answered 500");
    expect((await apiRaw(me.cookie, `/api/server/bots/${bot.id}`, { method: "PATCH", json: { eventsUrl: "http://bot.example.test/x" } })).status).toBe(400);
  });

  it("gets channel messages through the queue, but never the bot's own", async () => {
    const { me, channel, token } = await setup(EVENTS_URL);
    const deliveries: Array<{ type: string; data: { message?: Message } }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === EVENTS_URL) deliveries.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    });
    await asBot(token, `/api/channels/${channel.id}/messages`, { method: "POST", json: { content: "from the bot" } });
    await sendMessage(me, channel.id, "hello bot");
    await vi.waitFor(() => expect(deliveries.some((d) => d.type === "message.created")).toBe(true), { timeout: 15_000, interval: 250 });
    const created = deliveries.filter((d) => d.type === "message.created").map((d) => d.data.message!.content);
    expect(created).toEqual(["hello bot"]);
  });

  it("pauses after repeated failed deliveries, and a success clears the count", async () => {
    const { bot } = await setup(EVENTS_URL);
    const db = createDb(env.DB);
    const event: BotEvent = { id: "e1", type: "ping", workspaceId: "w", channelId: null, createdAt: new Date().toISOString(), data: {} };
    const failing = async () => new Response("down", { status: 503 });
    await expect(deliverBotEvent(env, db, bot.id, event, 1, failing)).rejects.toThrow();
    for (let i = 0; i < PAUSE_AFTER_FAILURES; i++) await deliverBotEvent(env, db, bot.id, event, DELIVERY_ATTEMPTS, failing);
    const paused = await env.DB.prepare("SELECT events_failures, events_paused_at FROM bots WHERE user_id = ?").bind(bot.id).first<{ events_failures: number; events_paused_at: number | null }>();
    expect(paused!.events_failures).toBe(PAUSE_AFTER_FAILURES);
    expect(paused!.events_paused_at).not.toBeNull();
    // Paused: nothing is sent.
    const spy = vi.fn(async () => new Response(null, { status: 200 }));
    await deliverBotEvent(env, db, bot.id, event, 1, spy);
    expect(spy).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE bots SET events_paused_at = NULL WHERE user_id = ?").bind(bot.id).run();
    await deliverBotEvent(env, db, bot.id, event, 1, spy);
    expect((await env.DB.prepare("SELECT events_failures FROM bots WHERE user_id = ?").bind(bot.id).first<{ events_failures: number }>())!.events_failures).toBe(0);
  });
});

describe("slash commands and buttons", () => {
  async function withCommand() {
    const ctx = await setup(EVENTS_URL);
    await asBot(ctx.token, "/api/bots/@me/commands", { method: "PUT", json: [{ name: "deploy", description: "Deploy" }] });
    return ctx;
  }

  function botAnswers(answer: (payload: Record<string, unknown>) => Response | Promise<Response>) {
    const seen: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) !== EVENTS_URL) return new Response(null, { status: 404 });
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (payload.type !== "interaction") return new Response(null, { status: 200 });
      seen.push(payload);
      return answer(payload);
    });
    return seen;
  }

  it("answer privately", async () => {
    const { me, channel } = await withCommand();
    const seen = botAnswers(() => Response.json({ type: "message", content: "Only you see this", ephemeral: true }));
    const result = await api<{ message: Message }>(me.cookie, `/api/channels/${channel.id}/commands`, { method: "POST", json: { name: "deploy", text: "production" } });
    expect(seen[0]).toMatchObject({ type: "interaction", data: { kind: "command", command: "deploy", text: "production", user: { id: me.user.id } } });
    expect(result.message).toMatchObject({ ephemeral: true, content: "Only you see this", interaction: { name: "deploy" } });
    expect((await api<MessagePage>(me.cookie, `/api/channels/${channel.id}/messages`)).messages).toEqual([]);
  });

  it("answer in the channel, or later with the interaction token", async () => {
    const { me, channel } = await withCommand();
    botAnswers(() => Response.json({ type: "message", content: "Deploying production", embeds: [{ title: "Build 7" }] }));
    const posted = await api<{ message: Message }>(me.cookie, `/api/channels/${channel.id}/commands`, { method: "POST", json: { name: "deploy", text: "production" } });
    expect(posted.message).toMatchObject({ content: "Deploying production", interaction: { name: "deploy", user: { id: me.user.id } } });

    vi.restoreAllMocks();
    const seen = botAnswers(() => Response.json({ type: "defer" }));
    const deferred = await api<{ deferred: boolean }>(me.cookie, `/api/channels/${channel.id}/commands`, { method: "POST", json: { name: "deploy", text: "staging" } });
    expect(deferred.deferred).toBe(true);
    const { id, token } = seen[0] as { id: string; token: string };
    const later = await SELF.fetch(`${ORIGIN}/api/interactions/${id}/${token}/respond`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "Staging is live" }) });
    expect(((await later.json()) as { message: Message }).message).toMatchObject({ content: "Staging is live", interaction: { name: "deploy" } });
    expect((await SELF.fetch(`${ORIGIN}/api/interactions/${id}/wrong/respond`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
  });

  it("explain when the bot doesn't answer", async () => {
    const { me, channel } = await withCommand();
    botAnswers(() => new Response("boom", { status: 500 }));
    const res = await apiRaw(me.cookie, `/api/channels/${channel.id}/commands`, { method: "POST", json: { name: "deploy" } });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("Deploy Bot couldn't handle that (it answered 500).");
    expect((await apiRaw(me.cookie, `/api/channels/${channel.id}/commands`, { method: "POST", json: { name: "nope" } })).status).toBe(404);
  });

  it("send button presses to the bot, which can update the message", async () => {
    const { me, channel, token } = await withCommand();
    const sent = (await (await asBot(token, `/api/channels/${channel.id}/messages`, { method: "POST", json: { content: "Ship v2?", components: [{ type: "row", components: [{ type: "button", style: "success", label: "Ship", customId: "ship:v2" }] }] } })).json()) as Message;
    const seen = botAnswers(() => Response.json({ type: "update", content: "Shipped v2", components: [] }));
    const result = await api<{ message: Message }>(me.cookie, `/api/channels/${channel.id}/messages/${sent.id}/buttons`, { method: "POST", json: { customId: "ship:v2" } });
    expect(seen[0]).toMatchObject({ data: { kind: "button", customId: "ship:v2", message: { id: sent.id } } });
    expect(result.message).toMatchObject({ id: sent.id, content: "Shipped v2", components: [] });
    expect((await apiRaw(me.cookie, `/api/channels/${channel.id}/messages/${sent.id}/buttons`, { method: "POST", json: { customId: "not-there" } })).status).toBe(400);
  });
});
