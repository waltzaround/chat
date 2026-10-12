import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message, MessagePage, Webhook, WebhookSecrets } from "../shared/types";
import { ORIGIN, api, apiRaw, createWorkspace, invite, joinViaInvite, signUp, textChannel } from "./helpers";
import { hmacSha256Hex } from "../worker/lib/crypto";

afterEach(() => vi.restoreAllMocks());

/** The webhook URL on the test origin. */
const local = (url: string) => url.replace(/^https?:\/\/[^/]+/, ORIGIN);

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch(local(url), { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

async function setup() {
  const owner = await signUp();
  const ws = await createWorkspace(owner, "Hooks");
  const channel = textChannel(ws);
  const hook = await api<WebhookSecrets>(owner.cookie, `/api/workspaces/${ws.id}/webhooks`, { method: "POST", json: { channelId: channel.id, name: "Deploys" } });
  const latest = async () => (await api<MessagePage>(owner.cookie, `/api/channels/${channel.id}/messages?limit=5`)).messages;
  return { owner, ws, channel, hook, latest };
}

describe("incoming webhooks", () => {
  it("need Manage integrations to create", async () => {
    const { owner, ws, channel } = await setup();
    const member = await signUp();
    await joinViaInvite(member, (await invite(owner, ws.id)).code);
    const res = await apiRaw(member.cookie, `/api/workspaces/${ws.id}/webhooks`, { method: "POST", json: { channelId: channel.id, name: "Nope" } });
    expect(res.status).toBe(403);
    expect((await apiRaw(member.cookie, `/api/workspaces/${ws.id}/webhooks`)).status).toBe(403);
    const list = await api<Webhook[]>(owner.cookie, `/api/workspaces/${ws.id}/webhooks`);
    expect(list.map((w) => w.name)).toEqual(["Deploys"]);
  });

  it("post Discord-format messages with cards, a name and an avatar", async () => {
    const { hook, latest } = await setup();
    expect(hook.url).toMatch(/\/api\/webhooks\/[^/]+\/[^/]+$/);
    const res = await post(`${hook.url}?wait=true`, {
      content: "Deployed **v1.2**",
      username: "CI",
      avatar_url: "https://example.com/ci.png",
      embeds: [{ title: "Build 42", url: "https://ci.example.com/42", color: 0x1f883d, fields: [{ name: "Branch", value: "main", inline: true }], footer: { text: "ci", icon_url: "javascript:alert(1)" } }],
    });
    expect(res.status).toBe(200);
    const [message] = await latest();
    expect(message!.content).toBe("Deployed **v1.2**");
    expect(message!.author.bot).toBe(true);
    expect(message!.author.displayName).toBe("CI");
    expect(message!.author.avatarUrl).toMatch(/^\/api\/media\?u=https%3A%2F%2Fexample\.com%2Fci\.png&s=/);
    expect(message!.webhookId).toBe(hook.webhook.id);
    expect(message!.embeds).toEqual([
      { type: "rich", title: "Build 42", url: "https://ci.example.com/42", color: 0x1f883d, fields: [{ name: "Branch", value: "main", inline: true }], footer: { text: "ci" } },
    ]);
  });

  it("answer 204 without wait, and refuse empty messages and bad tokens like Discord", async () => {
    const { hook, latest } = await setup();
    expect((await post(hook.url, { content: "hi" })).status).toBe(204);
    const empty = await post(hook.url, { content: "  " });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { code: number }).code).toBe(50006);
    const bad = await post(hook.url.replace(/[^/]+$/, "wrong-token"), { content: "hi" });
    expect(bad.status).toBe(404);
    expect(((await bad.json()) as { message: string }).message).toBe("Unknown Webhook");
    expect((await latest()).map((m) => m.content)).toEqual(["hi"]);
  });

  it("take Slack-format messages", async () => {
    const { hook, latest } = await setup();
    const res = await post(hook.slackUrl, {
      text: "*Alert* firing: <https://grafana.example.com/d/1|CPU high> ~resolved~",
      attachments: [{ color: "danger", title: "CPU", text: "95% on *web-1*", fields: [{ title: "Host", value: "web-1", short: true }] }],
    });
    expect(res.status).toBe(204);
    const [message] = await latest();
    expect(message!.content).toBe("**Alert** firing: [CPU high](https://grafana.example.com/d/1) ~~resolved~~");
    expect(message!.embeds[0]).toMatchObject({ title: "CPU", description: "95% on **web-1**", color: 0xe01e5a, fields: [{ name: "Host", value: "web-1", inline: true }] });
  });

  it("don't notify anyone when allowed_mentions is empty, and never @everyone without permission", async () => {
    const { owner, ws, hook } = await setup();
    const member = await signUp("pingme");
    await joinViaInvite(member, (await invite(owner, ws.id)).code);
    await post(hook.url, { content: "hey @pingme", allowed_mentions: { parse: [] } });
    const quiet = await env.DB.prepare("SELECT count(*) AS n FROM message_mentions WHERE user_id = ?").bind(member.user.id).first<{ n: number }>();
    expect(quiet!.n).toBe(0);
    await post(hook.url, { content: "hey @pingme" });
    const loud = await env.DB.prepare("SELECT count(*) AS n FROM message_mentions WHERE user_id = ?").bind(member.user.id).first<{ n: number }>();
    expect(loud!.n).toBe(1);
  });

  it("edit and delete their own messages with the token", async () => {
    const { hook, latest } = await setup();
    const sent = (await (await post(`${hook.url}?wait=true`, { content: "Deploying…" })).json()) as Message;
    const edited = await SELF.fetch(`${local(hook.url)}/messages/${sent.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "Deployed", embeds: [{ title: "Done" }] }) });
    expect(edited.status).toBe(200);
    expect((await latest())[0]).toMatchObject({ content: "Deployed", embeds: [{ title: "Done" }] });
    expect((await SELF.fetch(`${local(hook.url)}/messages/${sent.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await latest()).toEqual([]);
  });

  it("stop working when the URL is replaced or the webhook deleted, and keep their messages", async () => {
    const { owner, ws, hook, latest } = await setup();
    await post(hook.url, { content: "before" });
    const fresh = await api<WebhookSecrets>(owner.cookie, `/api/workspaces/${ws.id}/webhooks/${hook.webhook.id}/regenerate`, { method: "POST" });
    expect((await post(hook.url, { content: "old url" })).status).toBe(404);
    expect((await post(fresh.url, { content: "new url" })).status).toBe(204);
    expect((await apiRaw(owner.cookie, `/api/workspaces/${ws.id}/webhooks/${hook.webhook.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await post(fresh.url, { content: "gone" })).status).toBe(404);
    const messages = await latest();
    expect(messages.map((m) => m.content)).toEqual(["before", "new url"]);
    expect(messages[0]!.author.displayName).toBe("Deploys");
  });

  it("are rate limited per webhook", async () => {
    const { hook } = await setup();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await post(hook.url, { content: `n${i}` })).status);
    expect(statuses.slice(0, 30).every((s) => s === 204)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("can't be used to sign in or be messaged", async () => {
    const { owner, hook } = await setup();
    const row = await env.DB.prepare("SELECT user_id FROM webhooks WHERE id = ?").bind(hook.webhook.id).first<{ user_id: string }>();
    const user = await env.DB.prepare("SELECT kind, email FROM users WHERE id = ?").bind(row!.user_id).first<{ kind: string; email: string }>();
    expect(user!.kind).toBe("webhook");
    expect(user!.email).toMatch(/@webhooks\.invalid$/);
    expect((await apiRaw(owner.cookie, "/api/dms", { method: "POST", json: { userId: row!.user_id } })).status).toBe(403);
  });
});

describe("GitHub deliveries to a webhook", () => {
  const push = {
    ref: "refs/heads/main",
    compare: "https://github.com/acme/app/compare/a...b",
    repository: { full_name: "acme/app", html_url: "https://github.com/acme/app" },
    sender: { login: "octocat", html_url: "https://github.com/octocat", avatar_url: "https://avatars.githubusercontent.com/u/1" },
    commits: [
      { id: "abcdef1234567", message: "Fix [the] *build*\n\nLonger body", url: "https://github.com/acme/app/commit/abcdef1", author: { username: "octocat" } },
      { id: "1234567abcdef", message: "Add tests", url: "https://github.com/acme/app/commit/1234567", author: { name: "Mona" } },
    ],
  };

  async function deliver(url: string, secret: string, event: string, payload: unknown, delivery = crypto.randomUUID()) {
    const body = JSON.stringify(payload);
    return post(url, body, { "X-GitHub-Event": event, "X-GitHub-Delivery": delivery, "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(secret, body)}` });
  }

  it("need the secret's signature", async () => {
    const { hook } = await setup();
    const unsigned = await post(hook.githubUrl, push, { "X-GitHub-Event": "push" });
    expect(unsigned.status).toBe(401);
    const wrong = await deliver(hook.githubUrl, "not-the-secret", "push", push);
    expect(wrong.status).toBe(401);
  });

  it("post pushes as a card, once per delivery", async () => {
    const { hook, latest } = await setup();
    const delivery = crypto.randomUUID();
    expect((await deliver(hook.githubUrl, hook.secret, "push", push, delivery)).status).toBe(204);
    expect((await deliver(hook.githubUrl, hook.secret, "push", push, delivery)).status).toBe(204);
    const messages = await latest();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.embeds[0]).toMatchObject({
      title: "[acme/app:main] 2 new commits",
      url: "https://github.com/acme/app/compare/a...b",
      description: "[`abcdef1`](https://github.com/acme/app/commit/abcdef1) Fix \\[the\\] \\*build\\* - octocat\n[`1234567`](https://github.com/acme/app/commit/1234567) Add tests - Mona",
      author: { name: "octocat", url: "https://github.com/octocat" },
    });
    // A webhook's GitHub posts have no buttons: those need the GitHub App.
    expect(messages[0]!.components).toEqual([]);
  });

  it("confirm the connection on ping and skip events it doesn't post", async () => {
    const { hook, latest } = await setup();
    await deliver(hook.githubUrl, hook.secret, "ping", { zen: "Keep it logically awesome.", repository: { full_name: "acme/app" } });
    expect((await deliver(hook.githubUrl, hook.secret, "issues", { action: "labeled", issue: { number: 1 }, repository: { full_name: "acme/app" } })).status).toBe(204);
    expect((await latest()).map((m) => m.content)).toEqual(["GitHub is connected. Activity from acme/app will appear here."]);
  });
});
