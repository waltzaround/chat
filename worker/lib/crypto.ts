/**
 * Small Web Crypto helpers for integrations: tokens, hashes, HMAC signatures, and
 * encrypting secrets at rest with a key derived from the server's auth secret.
 */
import type { Env } from "../env";
import { authSecret } from "../instance";

const encoder = new TextEncoder();

/** A random URL-safe token with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(message)));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return toHex(await hmacSha256(secret, message));
}

/** Compares two strings without leaking where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Secrets at rest
// ---------------------------------------------------------------------------

const keys = new WeakMap<object, Promise<CryptoKey>>();

/** AES-GCM key derived from the auth secret, so a database copy alone can't reveal secrets. */
function storageKey(env: Env): Promise<CryptoKey> {
  let key = keys.get(env);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey("raw", encoder.encode(await authSecret(env)), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: encoder.encode("chat-integrations"), info: encoder.encode("secrets-at-rest") },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    keys.set(env, key);
    key.catch(() => keys.delete(env));
  }
  return key;
}

/** "v1.<iv>.<ciphertext>", base64url. */
export async function encryptSecret(env: Env, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await storageKey(env), encoder.encode(plaintext));
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(sealed))}`;
}

export async function decryptSecret(env: Env, stored: string): Promise<string> {
  const [version, iv, data] = stored.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("Unrecognised secret format");
  const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) }, await storageKey(env), fromBase64Url(data));
  return new TextDecoder().decode(opened);
}
