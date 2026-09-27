import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { InstanceInfo, AuthConfig } from "../shared/types";
import { apiRaw, signUp } from "./helpers";

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
