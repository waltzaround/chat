import { importPem, signJwt, type Device } from "./keys";

export interface Env {
  RELAY_KEY: string;
  APNS_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_TOPIC: string;
  APNS_SANDBOX?: string;
  FCM_SERVICE_ACCOUNT?: string;
}

/** What a push says: which server to ask, as which device. Never message text. */
export interface Wake {
  server: string;
  device: string;
}

export type SendResult = "sent" | "gone" | "failed";

// Provider tokens, reused while valid (per isolate).
let apnsJwt: { token: string; at: number } | null = null;
let fcmAccess: { token: string; until: number } | null = null;

export const apnsConfigured = (env: Env) => !!(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID);
export const fcmConfigured = (env: Env) => !!env.FCM_SERVICE_ACCOUNT;

export function send(env: Env, device: Device, wake: Wake, fetcher: typeof fetch = fetch): Promise<SendResult> {
  return device.platform === "ios" ? sendApns(env, device.token, wake, fetcher) : sendFcm(env, device.token, wake, fetcher);
}

/**
 * An alert with mutable-content: the app's notification service extension fetches
 * the real title and text from the server before it's shown. Without the extension
 * running (e.g. no network), the placeholder shows.
 */
export async function sendApns(env: Env, token: string, wake: Wake, fetcher: typeof fetch): Promise<SendResult> {
  if (!apnsConfigured(env)) return "failed";
  // Apple wants the provider token refreshed between 20 and 60 minutes.
  if (!apnsJwt || Date.now() - apnsJwt.at > 40 * 60 * 1000) {
    const key = await importPem(env.APNS_KEY!, "ES256");
    apnsJwt = { token: await signJwt({ alg: "ES256", kid: env.APNS_KEY_ID }, { iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }, key, "ES256"), at: Date.now() };
  }
  const host = env.APNS_SANDBOX === "1" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const res = await fetcher(`https://${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${apnsJwt.token}`,
      "apns-topic": env.APNS_TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 86400),
    },
    body: JSON.stringify({ aps: { alert: { title: "Chat", body: "New message" }, sound: "default", "mutable-content": 1 }, server: wake.server, device: wake.device }),
  }).catch(() => null);
  if (!res) return "failed";
  if (res.ok) return "sent";
  if (res.status === 410) return "gone";
  const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason;
  return reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic" ? "gone" : "failed";
}

/** A high-priority data message: the app fetches and shows the notification itself. */
export async function sendFcm(env: Env, token: string, wake: Wake, fetcher: typeof fetch): Promise<SendResult> {
  if (!fcmConfigured(env)) return "failed";
  const account = JSON.parse(env.FCM_SERVICE_ACCOUNT!) as { client_email: string; private_key: string; project_id: string };
  if (!fcmAccess || Date.now() > fcmAccess.until) {
    const now = Math.floor(Date.now() / 1000);
    const assertion = await signJwt(
      { alg: "RS256", typ: "JWT" },
      { iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
      await importPem(account.private_key, "RS256"),
      "RS256",
    );
    const res = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!res.ok) return "failed";
    const body = (await res.json()) as { access_token: string; expires_in: number };
    fcmAccess = { token: body.access_token, until: Date.now() + (body.expires_in - 120) * 1000 };
  }
  const res = await fetcher(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fcmAccess.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token, data: { server: wake.server, device: wake.device }, android: { priority: "HIGH", ttl: "86400s" } } }),
  }).catch(() => null);
  if (!res) return "failed";
  if (res.ok) return "sent";
  const status = ((await res.json().catch(() => ({}))) as { error?: { status?: string } }).error?.status;
  return res.status === 404 || status === "UNREGISTERED" ? "gone" : "failed";
}

/** For tests: forget cached provider tokens. */
export function resetProviderTokens() {
  apnsJwt = null;
  fcmAccess = null;
}
