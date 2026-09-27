import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { InstanceInfo, AuthConfig } from "../shared/types";
import { apiRaw, extractCookies, ORIGIN, signUp } from "./helpers";

async function signIn(email: string): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: "password123" }) });
  return extractCookies(res.headers);
}

const publicInfo = async () => ((await (await SELF.fetch("http://localhost/api/instance")).json()) as InstanceInfo).server;

describe("server branding", () => {
  it("shows the owner's name, description and icon before sign-in", async () => {
    // First sign-up in this file's database is the owner.
    const owner = await signUp("brandowner");
    const member = await signUp("brandmember");
    expect(await publicInfo()).toEqual({ name: null, description: null, iconUrl: null });

    await env.UPLOADS.put(`workspace-icons/${owner.user.id}/icon1`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { httpMetadata: { contentType: "image/png" } });
    expect((await apiRaw(member.cookie, "/api/server", { method: "PATCH", json: { name: "Mine now" } })).status).toBe(403);
    expect((await apiRaw(owner.cookie, "/api/server", { method: "PATCH", json: { iconKey: "workspace-icons/someone-else/x" } })).status).toBe(400);
    const res = await apiRaw(owner.cookie, "/api/server", {
      method: "PATCH",
      json: { name: "Kiwi Devs", description: "NZ developers hanging out", iconKey: `workspace-icons/${owner.user.id}/icon1` },
    });
    expect(res.status).toBe(200);

    const info = await publicInfo();
    expect(info).toMatchObject({ name: "Kiwi Devs", description: "NZ developers hanging out" });
    const icon = await SELF.fetch(`http://localhost${info.iconUrl}`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/png");
    const config = (await (await SELF.fetch("http://localhost/api/auth-config")).json()) as AuthConfig;
    expect(config.server.name).toBe("Kiwi Devs");

    // Clearing a field removes it; the others stay.
    await apiRaw(owner.cookie, "/api/server", { method: "PATCH", json: { description: null } });
    expect(await publicInfo()).toMatchObject({ name: "Kiwi Devs", description: null });
  });
});

describe("privacy policy and terms", () => {
  it("serve the template until the owner writes their own", async () => {
    const res = await SELF.fetch("http://localhost/api/policies");
    const policies = (await res.json()) as { privacyPolicy: string; terms: string; customPrivacy: boolean };
    expect(policies.customPrivacy).toBe(false);
    expect(policies.privacyPolicy).toContain("# Privacy policy");
    expect(policies.privacyPolicy).not.toContain("{server}");
    expect(policies.terms).toContain("# Terms of use");
  });

  it("let only the owner replace them, and go back to the template", async () => {
    // The first sign-up in this file ("brandowner", above) owns the server.
    const owner = await signIn("brandowner@example.com");
    const member = await signUp("policymember");
    expect((await apiRaw(member.cookie, "/api/server", { method: "PATCH", json: { terms: "mine" } })).status).toBe(403);
    expect((await apiRaw(owner, "/api/server", { method: "PATCH", json: { privacyPolicy: "# Ours\n\nRun by {owner}." } })).status).toBe(200);
    const custom = (await (await SELF.fetch("http://localhost/api/policies")).json()) as { privacyPolicy: string; customPrivacy: boolean };
    expect(custom.customPrivacy).toBe(true);
    expect(custom.privacyPolicy).toBe("# Ours\n\nRun by brandowner.");
    await apiRaw(owner, "/api/server", { method: "PATCH", json: { privacyPolicy: null } });
    expect(((await (await SELF.fetch("http://localhost/api/policies")).json()) as { customPrivacy: boolean }).customPrivacy).toBe(false);
  });
});
