import type { Env } from "../env";
import { ApiError } from "../lib/errors";

/**
 * Verifies a Turnstile token with Cloudflare. When no secret is configured the
 * check is skipped (useful for tests) but a warning is logged once.
 */
let warned = false;
export async function verifyTurnstile(env: Env, token: string | undefined | null, remoteIp: string | null): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY) {
    if (!warned) {
      console.warn("TURNSTILE_SECRET_KEY is not set; skipping Turnstile verification");
      warned = true;
    }
    return;
  }
  if (!token) throw new ApiError(400, "turnstile_required", "Please complete the verification challenge");

  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; "error-codes"?: string[] };
  if (!data.success) {
    throw new ApiError(400, "turnstile_failed", "Verification failed, please try again", data["error-codes"]);
  }
}

export function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
