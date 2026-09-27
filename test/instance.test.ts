import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { AuthConfig, CurrentUser, PasswordResetLink, ServerSettings, ServerUser } from "../shared/types";
import { appOrigin, assertMayRegister, authSecret, RegistrationError } from "../worker/instance";
import { createAuth } from "../worker/auth/auth";
import { createDb } from "../worker/db";
import { api, apiRaw, createWorkspace, invite, joinViaInvite, openSocket, signUp, signUpRaw } from "./helpers";

// Tests in this file run in order against one database: a fresh server, then its owner.
describe("zero-config deployment", () => {
  it("generates one auth secret, keeps it in D1, and reuses it from any isolate", async () => {
    const first = await authSecret({ ...env, BETTER_AUTH_SECRET: undefined });
    const second = await authSecret({ ...env, BETTER_AUTH_SECRET: "change-me-to-a-long-random-string" });
    expect(first).toHaveLength(44);
    expect(second).toBe(first);
    const row = await env.DB.prepare("SELECT value FROM instance_settings WHERE key = 'auth_secret'").first<{ value: string }>();
    expect(row?.value).toBe(first);
  });

  it("prefers a configured auth secret", async () => {
    expect(await authSecret({ ...env, BETTER_AUTH_SECRET: "configured-secret" })).toBe("configured-secret");
  });

  it("uses APP_URL when set and the request origin otherwise", () => {
    const request = new Request("https://chat.acme.workers.dev/api/me");
    expect(appOrigin({ ...env, APP_URL: "" }, request)).toBe("https://chat.acme.workers.dev");
    expect(appOrigin({ ...env, APP_URL: undefined }, request)).toBe("https://chat.acme.workers.dev");
    expect(appOrigin({ ...env, APP_URL: "https://chat.example.com/" }, request)).toBe("https://chat.example.com");
  });
});

describe("server owner", () => {
  it("requires the setup link's claim token before an owner exists, when one is configured", async () => {
    const withToken = { ...env, OWNER_CLAIM_TOKEN: "claim-123" };
    await expect(assertMayRegister(withToken, new Headers())).rejects.toBeInstanceOf(RegistrationError);
    await expect(assertMayRegister(withToken, new Headers({ cookie: "chat_claim=wrong" }))).rejects.toThrow(/setup link/);
    await expect(assertMayRegister(withToken, new Headers({ cookie: "chat_claim=claim-123" }))).resolves.toBeUndefined();
    await expect(assertMayRegister(env, new Headers())).resolves.toBeUndefined();
  });

  it("makes the first account the owner and starts the server invite-only", async () => {
    // Undo test/setup.ts, which opens sign-up for the other test files.
    await env.DB.prepare("DELETE FROM instance_settings WHERE key = 'registration'").run();
    const before = await api<AuthConfig>(null, "/api/auth-config");
    expect(before).toMatchObject({ firstRun: true, claimRequired: false });

    const owner = await signUp("owner");
    expect(owner.user.isServerOwner).toBe(true);
    expect(await api<AuthConfig>(null, "/api/auth-config")).toMatchObject({ firstRun: false, registration: "invite" });
  });

  it("only lets people with a working invite sign up to an invite-only server", async () => {
    const owner = await signIn("owner");
    const refused = await signUpRaw();
    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/invite-only/);

    const ws = await createWorkspace(owner);
    const link = await invite(owner, ws.id);
    const guest = await signUp(undefined, `chat_invite=${link.code}`);
    expect(guest.user.isServerOwner).toBe(false);

    await api(owner.cookie, `/api/workspaces/${ws.id}/invites/${link.code}`, { method: "DELETE" });
    expect((await signUpRaw(undefined, `chat_invite=${link.code}`)).status).toBe(403);
  });

  it("lets only the owner change who can sign up", async () => {
    const owner = await signIn("owner");
    const ws = await createWorkspace(owner);
    const link = await invite(owner, ws.id);
    const member = await signUp(undefined, `chat_invite=${link.code}`);

    expect((await apiRaw(member.cookie, "/api/server", { method: "PATCH", json: { registration: "open" } })).status).toBe(403);
    const updated = await api<ServerSettings>(owner.cookie, "/api/server", { method: "PATCH", json: { registration: "open" } });
    expect(updated.registration).toBe("open");
    expect((await signUpRaw()).status).toBe(200);
  });
});

describe("password recovery", () => {
  it("lets the owner find accounts and hand out a one-time reset link", async () => {
    const owner = await signIn("owner");
    const member = await signUp("forgetful");
    const found = await api<ServerUser[]>(owner.cookie, "/api/server/users?q=forget");
    expect(found.map((u) => u.username)).toEqual(["forgetful"]);
    expect((await apiRaw(member.cookie, "/api/server/users")).status).toBe(403);
    expect((await apiRaw(member.cookie, `/api/server/users/${member.user.id}/password-reset`, { method: "POST" })).status).toBe(403);

    const link = await api<PasswordResetLink>(owner.cookie, `/api/server/users/${member.user.id}/password-reset`, { method: "POST" });
    expect(link.url).toMatch(/^http:\/\/localhost\/reset-password\?token=/);
    const token = new URL(link.url).searchParams.get("token")!;

    const reset = await apiRaw(null, "/api/auth/reset-password", { method: "POST", json: { token, newPassword: "brand-new-password" } });
    expect(reset.status).toBe(200);
    // One-time, signs out existing sessions, and the new password works.
    expect((await apiRaw(null, "/api/auth/reset-password", { method: "POST", json: { token, newPassword: "another-password" } })).status).toBe(400);
    // Sessions are deleted; the 5-minute session cookie cache is dropped here to check that.
    const sessionOnly = member.cookie.split("; ").filter((c) => !c.includes("session_data")).join("; ");
    expect((await apiRaw(sessionOnly, "/api/me")).status).toBe(401);
    expect((await signIn("forgetful", "brand-new-password")).user.id).toBe(member.user.id);
  });

  it("emails a reset link only when email is set up", async () => {
    const sent: Array<{ to: string; text: string }> = [];
    const EMAIL = { send: async (message: { to: string; text: string }) => void sent.push(message) } as unknown as SendEmail;
    const secret = await authSecret(env);
    const withEmail = createAuth({ ...env, EMAIL, EMAIL_FROM: "chat@example.com" }, createDb(env.DB), "https://chat.example.com", secret);
    await withEmail.api.requestPasswordReset({ body: { email: "forgetful@example.com" } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("forgetful@example.com");
    expect(sent[0]!.text).toMatch(/https:\/\/chat\.example\.com\/reset-password\?token=/);
    expect((await api<AuthConfig>(null, "/api/auth-config")).passwordResetEmail).toBe(false);
  });
});

describe("owner moderation", () => {
  it("suspends an account at once and restores it on unsuspend", async () => {
    const owner = await signIn("owner");
    const member = await signUp("troublemaker");

    expect((await apiRaw(owner.cookie, `/api/server/users/${owner.user.id}/suspension`, { method: "POST" })).status).toBe(400);
    expect((await apiRaw(member.cookie, `/api/server/users/${owner.user.id}/suspension`, { method: "POST" })).status).toBe(403);
    expect((await apiRaw(owner.cookie, `/api/server/users/${member.user.id}/suspension`, { method: "POST" })).status).toBe(204);

    // Even with the cached session cookie, the account is signed out right away.
    expect((await apiRaw(member.cookie, "/api/me")).status).toBe(401);
    const refused = await apiRaw(null, "/api/auth/sign-in/email", { method: "POST", json: { email: "troublemaker@example.com", password: "password123" } });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/suspended/);
    const listed = await api<ServerUser[]>(owner.cookie, "/api/server/users?q=troublemaker");
    expect(listed[0]?.suspended).toBe(true);

    expect((await apiRaw(owner.cookie, `/api/server/users/${member.user.id}/suspension`, { method: "DELETE" })).status).toBe(204);
    expect((await signIn("troublemaker")).user.id).toBe(member.user.id);
  });

  it("closes a suspended account's open connections", async () => {
    const owner = await signIn("owner");
    const member = await signUp();
    const ws = await createWorkspace(owner, "Live");
    await joinViaInvite(member, (await invite(owner, ws.id)).code);
    const socket = await openSocket(member, ws.id);
    await socket.waitFor((e) => e.type === "ready");
    const closed = new Promise<{ code: number; reason: string }>((resolve) => socket.ws.addEventListener("close", (ev) => resolve({ code: ev.code, reason: ev.reason })));
    await api(owner.cookie, `/api/server/users/${member.user.id}/suspension`, { method: "POST" });
    expect(await closed).toEqual({ code: 4001, reason: "suspended" });
  });

  it("can limit workspace creation to the owner", async () => {
    const owner = await signIn("owner");
    const member = await signUp();
    await api(owner.cookie, "/api/server", { method: "PATCH", json: { workspaceCreation: "owner" } });

    expect((await api<CurrentUser>(member.cookie, "/api/me")).canCreateWorkspace).toBe(false);
    expect((await apiRaw(member.cookie, "/api/workspaces", { method: "POST", json: { name: "Mine" } })).status).toBe(403);
    expect((await api<CurrentUser>(owner.cookie, "/api/me")).canCreateWorkspace).toBe(true);
    await createWorkspace(owner, "Owner's");

    const settings = await api<ServerSettings>(owner.cookie, "/api/server", { method: "PATCH", json: { workspaceCreation: "everyone" } });
    expect(settings).toMatchObject({ workspaceCreation: "everyone", registration: "open" });
    await createWorkspace(member, "Mine");
  });
});

async function signIn(username: string, password = "password123"): Promise<{ cookie: string; user: CurrentUser }> {
  const res = await apiRaw(null, "/api/auth/sign-in/email", { method: "POST", json: { email: `${username}@example.com`, password } });
  expect(res.status).toBe(200);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]!).join("; ");
  return { cookie, user: await api<CurrentUser>(cookie, "/api/me") };
}

