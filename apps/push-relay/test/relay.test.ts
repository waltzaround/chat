import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/index";
import { fromBase64url, openDevice, sealDevice } from "../src/keys";
import { resetProviderTokens, type Env } from "../src/senders";

const RELAY_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

async function pem(key: CryptoKey): Promise<string> {
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", key)) as ArrayBuffer);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
}

const apple = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const google = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;

const env: Env = {
  RELAY_KEY,
  APNS_KEY: await pem(apple.privateKey),
  APNS_KEY_ID: "KEY123",
  APNS_TEAM_ID: "TEAM123",
  APNS_TOPIC: "chat.app.ios",
  APNS_SANDBOX: "1",
  FCM_SERVICE_ACCOUNT: JSON.stringify({ client_email: "relay@proj.iam.gserviceaccount.com", private_key: await pem(google.privateKey), project_id: "proj" }),
};

const post = (path: string, body: unknown) => new Request(`https://relay.test${path}`, { method: "POST", body: JSON.stringify(body) });

async function register(platform: string, token: string): Promise<string> {
  const res = await handle(post("/v1/register", { platform, token }), env);
  return ((await res.json()) as { pushKey: string }).pushKey;
}

beforeEach(resetProviderTokens);

describe("push keys", () => {
  it("seal the device token so only this relay can read it", async () => {
    const key = await sealDevice(RELAY_KEY, { platform: "ios", token: "abc123token" });
    expect(key).not.toContain("abc123token");
    expect(await openDevice(RELAY_KEY, key)).toEqual({ platform: "ios", token: "abc123token" });
    const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    expect(await openDevice(other, key)).toBeNull();
    expect(await openDevice(RELAY_KEY, "not-a-key")).toBeNull();
  });
});

describe("relay", () => {
  it("wakes an iPhone through APNs with a signed token and no message text", async () => {
    const pushKey = await register("ios", "a1b2c3d4e5f6");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const res = await handle(post("/v1/notify", { pushKey, server: "https://chat.example.com", device: "dev1" }), env, fetcher);
    expect(res.status).toBe(202);
    expect(calls[0]!.url).toBe("https://api.sandbox.push.apple.com/3/device/a1b2c3d4e5f6");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["apns-topic"]).toBe("chat.app.ios");
    const [h, p, s] = headers.authorization!.replace("bearer ", "").split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(h!)))).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(p!)))).toMatchObject({ iss: "TEAM123" });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, apple.publicKey, fromBase64url(s!), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({ aps: { alert: { title: "Chat", body: "New message" }, sound: "default", "mutable-content": 1 }, server: "https://chat.example.com", device: "dev1" });
  });

  it("wakes an Android phone through FCM with a data message", async () => {
    const pushKey = await register("android", "fcm-token-xyz");
    const urls: string[] = [];
    let message: unknown;
    const fetcher = (async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.startsWith("https://oauth2")) return Response.json({ access_token: "ya29.token", expires_in: 3600 });
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ya29.token");
      message = JSON.parse(String(init.body));
      return Response.json({ name: "projects/proj/messages/1" });
    }) as unknown as typeof fetch;
    expect((await handle(post("/v1/notify", { pushKey, server: "https://chat.example.com", device: "dev2" }), env, fetcher)).status).toBe(202);
    expect(urls).toEqual(["https://oauth2.googleapis.com/token", "https://fcm.googleapis.com/v1/projects/proj/messages:send"]);
    expect(message).toEqual({ message: { token: "fcm-token-xyz", data: { server: "https://chat.example.com", device: "dev2" }, android: { priority: "HIGH", ttl: "86400s" } } });
  });

  it("tells servers to forget phones that are gone, and keys it didn't issue", async () => {
    const pushKey = await register("ios", "deadbeef00");
    const gone = (async () => Response.json({ reason: "Unregistered" }, { status: 410 })) as unknown as typeof fetch;
    expect((await handle(post("/v1/notify", { pushKey, server: "https://a", device: "d" }), env, gone)).status).toBe(410);
    expect((await handle(post("/v1/notify", { pushKey: "forged-key-000000000000", server: "https://a", device: "d" }), env)).status).toBe(410);
  });

  it("rejects bad input and limits floods", async () => {
    expect((await handle(post("/v1/register", { platform: "windows", token: "x" }), env)).status).toBe(400);
    const pushKey = await register("ios", "flood-token-1");
    const ok = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await handle(post("/v1/notify", { pushKey, server: "https://a", device: "d" }), env, ok)).status);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
  });
});
