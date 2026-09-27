import type { Auth } from "./auth";

/**
 * Linked sessions let another Chat server (in a browser) or the desktop app show this
 * account in its server rail: the workspaces, DM list and unread counts, nothing more.
 * Whoever runs the other server can see that summary, so these sessions can't read
 * messages, post, change settings or open realtime sockets.
 */
export const LINKED_SCOPE = "linked";

/** Everything a linked session may call. All read-only, apart from revoking itself. */
const LINKED_ROUTES: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/api\/me$/ },
  { method: "GET", path: /^\/api\/me\/workspaces$/ },
  { method: "GET", path: /^\/api\/dms$/ },
  { method: "GET", path: /^\/api\/files\/(avatars|workspace-icons)\/[^?]+$/ },
  { method: "DELETE", path: /^\/api\/me\/linked-session$/ },
];

export function linkedSessionMayCall(method: string, path: string): boolean {
  return LINKED_ROUTES.some((r) => r.method === method && r.path.test(path));
}

/** Routes other origins may call with fetch(): the linked routes, and the public instance check. */
export function allowsCrossOrigin(method: string, path: string): boolean {
  if (method === "GET" && path === "/api/instance") return true;
  return linkedSessionMayCall(method, path);
}

/**
 * A new linked session for this user, as the signed token the bearer plugin accepts
 * (the same form native apps get in set-auth-token).
 */
export async function createLinkedSession(auth: Auth, userId: string, label: string): Promise<string> {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId, false, { scope: LINKED_SCOPE, userAgent: label });
  return signToken(session.token, ctx.secret);
}

/** `token.signature`, signed the way Better Auth signs its session cookie. */
async function signToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
  return `${token}.${btoa(String.fromCharCode(...signature))}`;
}
