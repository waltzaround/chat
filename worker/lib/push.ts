import type { NotificationPayload } from "@shared/events";
import type { Env } from "../env";

/**
 * Web Push without payloads: we send an empty push signed with this server's VAPID
 * key, and the service worker asks /api/push/pending what to show. That avoids
 * payload encryption entirely. Keys are generated on first use and kept in D1.
 */

interface VapidKeys {
  privateJwk: JsonWebKey;
  /** Uncompressed P-256 public key, base64url: what browsers call applicationServerKey. */
  publicKey: string;
}

const cache = new WeakMap<object, Promise<VapidKeys>>();

export function vapidKeys(env: Env): Promise<VapidKeys> {
  let pending = cache.get(env);
  if (!pending) {
    pending = loadOrCreateKeys(env.DB);
    cache.set(env, pending);
    pending.catch(() => cache.delete(env));
  }
  return pending;
}

async function loadOrCreateKeys(db: D1Database): Promise<VapidKeys> {
  const stored = await db.prepare("SELECT value FROM instance_settings WHERE key = 'vapid_keys'").first<{ value: string }>();
  if (stored) return JSON.parse(stored.value) as VapidKeys;
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const publicKey = base64url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
  // First writer wins if two isolates race.
  await db.prepare("INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('vapid_keys', ?)").bind(JSON.stringify({ privateJwk, publicKey })).run();
  const row = await db.prepare("SELECT value FROM instance_settings WHERE key = 'vapid_keys'").first<{ value: string }>();
  return JSON.parse(row!.value) as VapidKeys;
}

/** `Authorization` header for one push service (RFC 8292). */
export async function vapidAuthorization(env: Env, endpoint: string, subject: string): Promise<string> {
  const keys = await vapidKeys(env);
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`;
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned)));
  return `vapid t=${unsigned}.${base64url(signature)}, k=${keys.publicKey}`;
}

export interface PushTarget {
  endpoint: string;
  origin: string;
  mutedWorkspaces: string;
}

/**
 * Push to every subscribed browser of one user that hasn't muted this workspace.
 * Subscriptions the push service says are gone (404/410) are deleted.
 */
export async function pushToUser(env: Env, userId: string, notification: NotificationPayload, fetcher: typeof fetch = fetch): Promise<number> {
  const { results } = await env.DB.prepare("SELECT endpoint, origin, muted_workspaces AS mutedWorkspaces FROM push_subscriptions WHERE user_id = ?").bind(userId).all<PushTarget>();
  let sent = await pushToDevices(env, userId, fetcher);
  await Promise.all(
    results.map(async (sub) => {
      if ((JSON.parse(sub.mutedWorkspaces) as string[]).includes(notification.workspaceId)) return;
      const res = await fetcher(sub.endpoint, {
        method: "POST",
        headers: { Authorization: await vapidAuthorization(env, sub.endpoint, sub.origin), TTL: "86400", Urgency: "high", "Content-Length": "0" },
      }).catch(() => null);
      if (res?.status === 404 || res?.status === 410) await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
      else if (res?.ok) sent += 1;
    }),
  );
  return sent;
}

interface DeviceTarget {
  id: string;
  relay: string;
  pushKey: string;
  origin: string;
}

/**
 * Push to the user's phones through their push relays. The relay only learns which
 * server and which device to wake; the app fetches /api/push/pending itself. A relay
 * answering 410 means the phone is gone (app deleted, token expired).
 */
async function pushToDevices(env: Env, userId: string, fetcher: typeof fetch): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, relay, push_key AS pushKey, origin FROM push_devices WHERE user_id = ?").bind(userId).all<DeviceTarget>();
  let sent = 0;
  await Promise.all(
    results.map(async (device) => {
      const res = await fetcher(`${device.relay}/v1/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pushKey: device.pushKey, server: device.origin, device: device.id }),
      }).catch(() => null);
      if (res?.status === 410) await env.DB.prepare("DELETE FROM push_devices WHERE id = ?").bind(device.id).run();
      else if (res?.ok) sent += 1;
    }),
  );
  return sent;
}

/** What the service worker (or an app) shows for a notification. */
export function toPushItem(n: NotificationPayload, hideText = false) {
  return {
    title: n.kind === "dm" ? n.author.displayName : `${n.author.displayName} in #${n.channelName}`,
    body: hideText ? (n.kind === "dm" ? "Sent you a message" : `Mentioned you in ${n.workspaceName}`) : n.preview || "Sent an attachment",
    kind: n.kind,
    workspaceId: n.workspaceId,
    channelId: n.channelId,
    channelName: n.channelName,
    messageId: n.messageId,
    author: n.author,
    icon: n.author.avatarUrl,
    url: n.threadRootId ? `/w/${n.workspaceId}/c/${n.channelId}?thread=${n.threadRootId}` : `/w/${n.workspaceId}/c/${n.channelId}?m=${n.sequence}`,
    createdAt: n.createdAt,
  };
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
