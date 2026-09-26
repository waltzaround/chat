import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createAuth } from "../worker/auth/auth";
import { createDb } from "../worker/db";
import { authSecret } from "../worker/instance";
import { apiRaw, signUp, signUpRaw } from "./helpers";

const signIn = (username: string) => apiRaw(null, "/api/auth/sign-in/email", { method: "POST", json: { email: `${username}@example.com`, password: "password123" } });

describe("email verification", () => {
  it("can only be required when email is set up", async () => {
    const owner = await signUp("verifyowner");
    const res = await apiRaw(owner.cookie, "/api/server", { method: "PATCH", json: { requireVerifiedEmail: true } });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Set up email first/);
  });

  it("emails a confirmation link on sign-up when email is set up", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const EMAIL = { send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) } as unknown as SendEmail;
    const auth = createAuth({ ...env, EMAIL, EMAIL_FROM: "chat@example.com" }, createDb(env.DB), "https://chat.example.com", await authSecret(env));
    await auth.api.signUpEmail({ body: { email: "newbie@example.com", password: "password123", name: "Newbie", username: "newbie" } });
    expect(sent[0]).toMatchObject({ to: "newbie@example.com", subject: "Confirm your email" });
    expect(sent[0]!.text).toMatch(/https:\/\/chat\.example\.com\/api\/auth\/verify-email\?token=/);
  });

  it("blocks sign-in for new unverified accounts only", async () => {
    await signUp("before");
    // Turned on by the owner (the API refuses without email, so set it directly).
    await env.DB.prepare("INSERT INTO instance_settings (key, value) VALUES ('require_verified_email_since', ?)").bind(String(Date.now())).run();

    const fresh = await signUpRaw("after");
    expect(fresh.status).toBe(403);
    expect(await fresh.text()).toMatch(/Confirm your email/);
    expect((await signIn("after")).status).toBe(403);
    expect((await signIn("before")).status).toBe(200);

    await env.DB.prepare("UPDATE users SET email_verified = 1 WHERE username = 'after'").run();
    expect((await signIn("after")).status).toBe(200);
  });
});
