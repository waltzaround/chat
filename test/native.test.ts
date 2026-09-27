import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import type { CurrentUser, InstanceInfo } from "../shared/types";
import { APP_VERSION } from "../shared/version";
import { ORIGIN, createWorkspace, signUp } from "./helpers";

// Native apps have no Origin header and no cookies: just a bearer token.
const native = (path: string, init: RequestInit = {}) => SELF.fetch(`${ORIGIN}${path}`, init);

describe("native app support", () => {
  it("identifies the server before sign-in", async () => {
    const info = (await (await native("/api/instance")).json()) as InstanceInfo;
    expect(info).toMatchObject({ software: "chat", version: pkg.version, apiVersion: 1 });
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("signs in with a token and uses it for the API and the realtime socket", async () => {
    const web = await signUp("nativeuser");
    const ws = await createWorkspace(web, "Native");

    const res = await native("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nativeuser@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const token = res.headers.get("set-auth-token")!;
    expect(token).toContain(".");
    const auth = { Authorization: `Bearer ${token}` };

    const me = (await (await native("/api/me", { headers: auth })).json()) as CurrentUser;
    expect(me.username).toBe("nativeuser");
    const socket = await native(`/ws/workspaces/${ws.id}`, { headers: { ...auth, Upgrade: "websocket" } });
    expect(socket.status).toBe(101);
    socket.webSocket!.accept();
    socket.webSocket!.close();

    // An unsigned token is refused.
    expect((await native("/api/me", { headers: { Authorization: `Bearer ${token.split(".")[0]}` } })).status).toBe(401);

    // Signing out ends the session.
    expect((await native("/api/auth/sign-out", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}" })).status).toBe(200);
    expect((await native("/api/me", { headers: auth })).status).toBe(401);
  });
});
