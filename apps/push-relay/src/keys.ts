/**
 * Push keys: the phone's APNs/FCM token, encrypted with the relay's key. Chat servers
 * only ever hold these, so they never see device tokens, and a key only works with
 * the relay that issued it.
 */
export interface Device {
  platform: "ios" | "android";
  token: string;
}

const AAD = new TextEncoder().encode("chat-push-v1");

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("RELAY_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealDevice(secret: string, device: Device): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify({ p: device.platform, t: device.token }));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await aesKey(secret), data));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return base64url(out);
}

/** Null for anything this relay didn't issue. */
export async function openDevice(secret: string, pushKey: string): Promise<Device | null> {
  try {
    const bytes = fromBase64url(pushKey);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: AAD }, await aesKey(secret), bytes.slice(12));
    const { p, t } = JSON.parse(new TextDecoder().decode(plain)) as { p: string; t: string };
    return (p === "ios" || p === "android") && typeof t === "string" ? { platform: p, token: t } : null;
  } catch {
    return null;
  }
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** A signed JWT (ES256 for Apple, RS256 for Google). */
export async function signJwt(header: object, claims: object, key: CryptoKey, alg: "ES256" | "RS256"): Promise<string> {
  const enc = (v: object) => base64url(new TextEncoder().encode(JSON.stringify(v)));
  const unsigned = `${enc(header)}.${enc(claims)}`;
  const params = alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
  const sig = new Uint8Array(await crypto.subtle.sign(params, key, new TextEncoder().encode(unsigned)));
  return `${unsigned}.${base64url(sig)}`;
}

/** A PKCS#8 PEM (Apple's .p8, Google's private_key) as a signing key. */
export function importPem(pem: string, alg: "ES256" | "RS256"): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const params = alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  return crypto.subtle.importKey("pkcs8", der, params, false, ["sign"]);
}
