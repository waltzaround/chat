import { SELF, env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GitHubAppStatus, GitHubSubscription, Message, MessagePage } from "../shared/types";
import { ORIGIN, api, apiRaw, createWorkspace, invite, joinViaInvite, signUp, textChannel } from "./helpers";
import { encryptSecret, hmacSha256Hex } from "../worker/lib/crypto";
import { appJwt, pkcs1ToPkcs8, saveGitHubApp, type GitHubAppConfig } from "../worker/integrations/github-app";
import { formatGitHubEvent } from "../worker/integrations/github-format";
import { githubLinkPreview } from "../worker/integrations/github-links";

afterEach(() => vi.restoreAllMocks());

const WEBHOOK_SECRET = "app-webhook-secret";
const INSTALLATION_ID = 4242;
let config: GitHubAppConfig;
let publicKey: CryptoKey;

/** Reads one DER length at `offset`; returns [length, bytes used]. */
function derLength(bytes: Uint8Array, offset: number): [number, number] {
  const first = bytes[offset]!;
  if (first < 0x80) return [first, 1];
  const count = first & 0x7f;
  let n = 0;
  for (let i = 1; i <= count; i++) n = (n << 8) | bytes[offset + i]!;
  return [n, 1 + count];
}

/** The PKCS#1 key inside a PKCS#8 one, the form GitHub hands out. */
function pkcs8ToPkcs1(pkcs8: Uint8Array): Uint8Array {
  let offset = 1 + derLength(pkcs8, 1)[1]; // outer SEQUENCE
  offset += 3; // INTEGER 0
  offset += 1 + derLength(pkcs8, offset + 1)[1] + derLength(pkcs8, offset + 1)[0]; // algorithm SEQUENCE
  const [length, used] = derLength(pkcs8, offset + 1); // OCTET STRING
  return pkcs8.slice(offset + 1 + used, offset + 1 + used + length);
}

const pem = (label: string, der: Uint8Array) => `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n")}\n-----END ${label}-----\n`;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  config = { appId: 99, slug: "chat-test", name: "Chat test", htmlUrl: "https://github.com/apps/chat-test", clientId: "Iv1.test", clientSecret: "client-secret", privateKey: pem("RSA PRIVATE KEY", pkcs8ToPkcs1(pkcs8)), webhookSecret: WEBHOOK_SECRET };
  await saveGitHubApp(env, config);
});

async function appDelivery(event: string, payload: unknown, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  return SELF.fetch(`${ORIGIN}/api/github/app/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-GitHub-Event": event, "X-GitHub-Delivery": crypto.randomUUID(), "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(secret, body)}` },
    body,
  });
}

/** Fakes the parts of GitHub's API these tests touch. */
function fakeGitHub(overrides: Record<string, (init: RequestInit | undefined) => Response> = {}) {
  const calls: Array<{ url: string; method: string; body: string | null; auth: string | null }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? String(init.body) : null, auth: new Headers(init?.headers).get("authorization") });
    const key = `${method} ${url.replace("https://api.github.com", "")}`;
    if (overrides[key]) return overrides[key]!(init);
    if (key === `POST /app/installations/${INSTALLATION_ID}/access_tokens`) return Response.json({ token: "ghs_installation", expires_at: new Date(Date.now() + 3600_000).toISOString() }, { status: 201 });
    if (key === "GET /repos/acme/app") return Response.json({ full_name: "acme/app" });
    return Response.json({ message: "Not Found" }, { status: 404 });
  });
  return calls;
}

const issuePayload = (action: string, number = 5) => ({
  action,
  issue: { number, title: "Login button does nothing", html_url: `https://github.com/acme/app/issues/${number}`, body: "Steps:\n1. Click\n<!-- template -->", state: action === "closed" ? "closed" : "open" },
  repository: { full_name: "Acme/App", html_url: "https://github.com/acme/app" },
  sender: { login: "octocat", html_url: "https://github.com/octocat", avatar_url: "https://avatars.githubusercontent.com/u/1" },
});

async function setup() {
  const admin = await signUp();
  const ws = await createWorkspace(admin, "GitHub");
  const channel = textChannel(ws);
  const run = (text: string, who = admin) => api<{ message: Message }>(who.cookie, `/api/channels/${channel.id}/commands`, { method: "POST", json: { name: "github", text } });
  const latest = async () => (await api<MessagePage>(admin.cookie, `/api/channels/${channel.id}/messages?limit=10`)).messages;
  return { admin, ws, channel, run, latest };
}

describe("the server's GitHub App", () => {
  it("signs app JWTs with the key GitHub issued", async () => {
    const jwt = await appJwt(config);
    const [header, payload, signature] = jwt.split(".") as [string, string, string];
    const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(decode(payload)))).toMatchObject({ iss: "99" });
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, decode(signature), new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
    expect(pkcs1ToPkcs8(new Uint8Array([1, 2, 3]))[0]).toBe(0x30);
  });

  it("records installations from its deliveries, and refuses unsigned ones", async () => {
    expect((await appDelivery("installation", { action: "created", installation: { id: INSTALLATION_ID, account: { login: "acme", type: "Organization" } } }, "wrong")).status).toBe(401);
    expect((await appDelivery("installation", { action: "created", installation: { id: INSTALLATION_ID, account: { login: "acme", type: "Organization" } } })).status).toBe(204);
    const someone = await signUp();
    const status = await api<GitHubAppStatus>(someone.cookie, "/api/github/status");
    expect(status).toMatchObject({ configured: true, slug: "chat-test", installUrl: "https://github.com/apps/chat-test/installations/new", installations: [{ id: INSTALLATION_ID, account: "acme", type: "Organization" }] });
  });

  it("subscribes channels with /github, for people who manage integrations", async () => {
    await appDelivery("installation", { action: "created", installation: { id: INSTALLATION_ID, account: { login: "acme", type: "Organization" } } });
    const { admin, ws, run } = await setup();
    const calls = fakeGitHub();
    const reply = await run("subscribe https://github.com/Acme/App issues pulls");
    expect(reply.message).toMatchObject({ ephemeral: true, author: { displayName: "GitHub", bot: true }, interaction: { name: "github" } });
    expect(reply.message.content).toContain("Subscribed to **acme/app**");
    expect(calls.find((c) => c.url.endsWith("/repos/acme/app"))?.auth).toBe("Bearer ghs_installation");
    expect((await run("list")).message.content).toContain("**acme/app**: issues, pulls");
    expect((await run("subscribe acme/app sparkles")).message.content).toContain(`I don't know "sparkles"`);
    expect((await run("subscribe nobody/else")).message.content).toContain("isn't installed on nobody");

    const member = await signUp();
    await joinViaInvite(member, (await invite(admin, ws.id)).code);
    expect((await run("subscribe acme/app", member)).message.content).toContain("Manage integrations");
    const listed = await api<GitHubSubscription[]>(admin.cookie, `/api/workspaces/${ws.id}/github/subscriptions`);
    expect(listed).toMatchObject([{ repo: "acme/app", events: ["issues", "pulls"] }]);
  });

  it("posts subscribed activity with Close and Reopen buttons that act as the person who pressed them", async () => {
    await appDelivery("installation", { action: "created", installation: { id: INSTALLATION_ID, account: { login: "acme", type: "Organization" } } });
    const { admin, channel, run, latest } = await setup();
    fakeGitHub();
    await run("subscribe acme/app issues");
    vi.restoreAllMocks();

    const res = await appDelivery("issues", issuePayload("opened"));
    // Earlier tests' channels subscribe to acme/app too.
    expect(((await res.json()) as { posted: number }).posted).toBeGreaterThanOrEqual(1);
    // Pushes aren't in this subscription.
    expect(await (await appDelivery("push", { ref: "refs/heads/main", commits: [{ id: "abc", message: "x", url: "https://github.com/acme/app/commit/abc" }], repository: { full_name: "acme/app" } })).json()).toEqual({ posted: 0 });

    const [post] = await latest();
    expect(post).toMatchObject({ author: { displayName: "GitHub", bot: true }, embeds: [{ title: "[Acme/App] Issue opened: #5 Login button does nothing", description: "Steps:\n1. Click" }] });
    expect(post!.components).toEqual([{ type: "row", components: [{ type: "button", style: "danger", label: "Close issue", customId: "gh:close:acme/app:5" }] }]);

    const press = () => api<{ message: Message }>(admin.cookie, `/api/channels/${channel.id}/messages/${post!.id}/buttons`, { method: "POST", json: { customId: "gh:close:acme/app:5" } });
    expect((await press()).message.content).toContain("Link your GitHub account first");

    await env.DB.prepare("INSERT INTO github_accounts (user_id, github_login, access_token, created_at) VALUES (?, 'walt', ?, 0)").bind(admin.user.id, await encryptSecret(env, "ghu_person")).run();
    const calls = fakeGitHub({ "PATCH /repos/acme/app/issues/5": () => Response.json({ state: "closed" }) });
    expect((await press()).message).toMatchObject({ ephemeral: true, content: "Closed acme/app#5." });
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ auth: "Bearer ghu_person", body: JSON.stringify({ state: "closed" }) });
  });

  it("won't act on GitHub for buttons from anyone but the GitHub integration", async () => {
    const owner = await signUp();
    const ws = await createWorkspace(owner, "Spoof");
    const channel = textChannel(ws);
    // A webhook can't add buttons at all, and a bot's gh: button goes to the bot, never to GitHub.
    const hook = await api<{ url: string }>(owner.cookie, `/api/workspaces/${ws.id}/webhooks`, { method: "POST", json: { channelId: channel.id, name: "Spoof" } });
    await SELF.fetch(hook.url.replace(/^https?:\/\/[^/]+/, ORIGIN), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "click me", components: [{ type: 1, components: [{ type: 2, style: 4, label: "Close", custom_id: "gh:close:acme/app:1" }] }] }) });
    const [message] = (await api<MessagePage>(owner.cookie, `/api/channels/${channel.id}/messages`)).messages;
    expect(message!.components).toEqual([]);
    expect((await apiRaw(owner.cookie, `/api/channels/${channel.id}/messages/${message!.id}/buttons`, { method: "POST", json: { customId: "gh:close:acme/app:1" } })).status).toBe(400);
  });

  it("previews issue and pull request links", async () => {
    await appDelivery("installation", { action: "created", installation: { id: INSTALLATION_ID, account: { login: "acme", type: "Organization" } } });
    fakeGitHub({
      "GET /repos/acme/app/issues/9": () =>
        Response.json({ number: 9, title: "Faster search", html_url: "https://github.com/acme/app/pull/9", state: "closed", comments: 3, body: "Speeds up search.", draft: false, user: { login: "mona", html_url: "https://github.com/mona", avatar_url: "https://avatars.githubusercontent.com/u/2" }, labels: [{ name: "perf" }], pull_request: { merged_at: "2026-09-01T00:00:00Z" } }),
    });
    const card = await githubLinkPreview(env, "https://github.com/acme/app/pull/9");
    expect(card).toMatchObject({
      type: "link",
      title: "Faster search · #9",
      color: 0x8250df,
      fields: [{ name: "Pull request", value: "Merged", inline: true }, { name: "Comments", value: "3", inline: true }, { name: "Labels", value: "perf", inline: true }],
      provider: { name: "GitHub" },
    });
    expect(await githubLinkPreview(env, "https://github.com/acme/app")).toBeNull();
  });
});

describe("GitHub event formatting", () => {
  it("covers the common events and skips noise", () => {
    expect(formatGitHubEvent("pull_request", { action: "closed", pull_request: { number: 3, title: "Fix", html_url: "u", merged: true }, repository: { full_name: "a/b" } })).toMatchObject({ feature: "pulls", embeds: [{ title: "[a/b] Pull request merged: #3 Fix", color: 0x8250df }], components: undefined });
    expect(formatGitHubEvent("pull_request", { action: "synchronize", pull_request: { number: 3 } })).toBeNull();
    expect(formatGitHubEvent("pull_request_review", { action: "submitted", review: { state: "approved", html_url: "r" }, pull_request: { number: 3, title: "Fix" }, sender: { login: "mona" }, repository: { full_name: "a/b" } })).toMatchObject({ feature: "reviews", embeds: [{ title: "[a/b] mona approved #3 Fix" }] });
    expect(formatGitHubEvent("workflow_run", { action: "completed", workflow_run: { conclusion: "success" } })).toBeNull();
    expect(formatGitHubEvent("workflow_run", { action: "completed", workflow_run: { conclusion: "failure", name: "CI", head_branch: "main", html_url: "w", head_commit: { message: "Break it" } }, repository: { full_name: "a/b" } })).toMatchObject({ feature: "workflows", embeds: [{ title: "[a/b] CI failed on main", description: "Break it" }] });
    expect(formatGitHubEvent("release", { action: "published", release: { tag_name: "v2", name: "Two", html_url: "r", body: "Notes" }, repository: { full_name: "a/b" } })).toMatchObject({ feature: "releases", embeds: [{ title: "[a/b] Release published: v2: Two" }] });
    expect(formatGitHubEvent("push", { ref: "refs/tags/v2", commits: [] })).toBeNull();
    expect(formatGitHubEvent("create", { ref_type: "branch", ref: "feature", repository: { full_name: "a/b", html_url: "h" } })).toMatchObject({ feature: "branches" });
  });
});
