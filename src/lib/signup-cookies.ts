/**
 * Short-lived cookies the server checks when an account is created (see
 * worker/instance.ts). Cookies rather than headers, so Google/GitHub sign-up,
 * which returns through a redirect, carries them too.
 */
const CLAIM = "chat_claim";
const INVITE = "chat_invite";

function write(name: string, value: string, maxAgeSeconds: number) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax${secure}`;
}

function read(name: string): string | null {
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** From the setup link printed by `npm run setup` (`/register?claim=…`). */
export function rememberClaimToken(token: string) {
  write(CLAIM, token, 60 * 60 * 24);
}

export function hasClaimToken(): boolean {
  return !!read(CLAIM);
}

/** Set when someone opens an invite link, so they can sign up on an invite-only server. */
export function rememberInvite(code: string) {
  write(INVITE, code, 60 * 60 * 24);
}

export function hasInvite(): boolean {
  return !!read(INVITE);
}
