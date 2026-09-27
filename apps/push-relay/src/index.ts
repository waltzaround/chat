import { openDevice, sealDevice } from "./keys";
import { apnsConfigured, fcmConfigured, send, type Env } from "./senders";

/**
 * Chat push relay.
 *
 *   POST /v1/register {platform, token, server} from the app: returns {pushKey}
 *   POST /v1/notify   {pushKey, server, device} from a Chat server: wakes the phone
 *
 * Phones register their APNs/FCM token and get back a push key (the token, sealed
 * with RELAY_KEY). The app gives that key to each Chat server it signs in to. Servers
 * send only "wake up, ask <server> as <device>", so neither this relay nor Apple or
 * Google see messages.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
// Best effort, per isolate: stops one server flooding a phone.
const recent = new Map<string, number[]>();

function limited(key: string): boolean {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 10_000) recent.clear();
  return hits.length > MAX_PER_WINDOW;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function handle(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return json({ software: "chat-push-relay", ios: apnsConfigured(env), android: fcmConfigured(env) });
  }
  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Expected JSON" }, 400);

  if (url.pathname === "/v1/register") {
    const { platform, token, server } = body;
    // APNs tokens are hex; FCM tokens are URL-safe base64 with colons.
    const valid = platform === "ios" ? typeof token === "string" && /^[0-9a-f]{32,200}$/i.test(token) : platform === "android" && typeof token === "string" && /^[A-Za-z0-9_:-]{20,4096}$/.test(token);
    if (!valid) return json({ error: "Expected platform (ios or android) and a valid token" }, 400);
    if (typeof server !== "string" || !/^https?:\/\/[^/]+$/.test(server)) return json({ error: "Expected the server's origin" }, 400);
    // One key per server: a server you've left can't keep waking your phone with it.
    return json({ pushKey: await sealDevice(env.RELAY_KEY, { platform, token: token as string, server }) });
  }

  if (url.pathname === "/v1/notify") {
    const { pushKey, server, device } = body;
    if (typeof pushKey !== "string" || typeof server !== "string" || typeof device !== "string" || server.length > 200 || device.length > 100) {
      return json({ error: "Expected pushKey, server and device" }, 400);
    }
    const target = await openDevice(env.RELAY_KEY, pushKey);
    // Not ours (or the relay key changed): tell the server to forget it.
    if (!target) return json({ error: "Unknown push key" }, 410);
    if (target.server && target.server !== server) return json({ error: "This key is for another server" }, 403);
    if (limited(pushKey)) return json({ error: "Too many pushes" }, 429);
    const result = await send(env, target, { server, device }, fetcher);
    if (result === "gone") return json({ error: "Device is gone" }, 410);
    return result === "sent" ? json({ ok: true }, 202) : json({ error: "Push failed" }, 502);
  }

  return json({ error: "Not found" }, 404);
}

export default { fetch: (request, env) => handle(request, env) } satisfies ExportedHandler<Env>;
