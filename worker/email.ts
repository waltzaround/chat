import type { Env } from "./env";

/**
 * Optional outbound email through Cloudflare Email Service. It needs the Workers
 * Paid plan and a sender domain on Cloudflare DNS, so it is off unless both the
 * `EMAIL` send_email binding and `EMAIL_FROM` are configured (npm run setup adds them).
 */
export function emailEnabled(env: Env): boolean {
  return !!env.EMAIL && !!env.EMAIL_FROM?.trim();
}

export async function sendPasswordResetEmail(env: Env, to: { email: string; name: string }, link: string): Promise<void> {
  if (!emailEnabled(env)) throw new Error("Email is not configured on this server");
  const greeting = to.name ? `Hi ${to.name},` : "Hi,";
  await env.EMAIL!.send({
    from: env.EMAIL_FROM!.trim(),
    to: to.email,
    subject: "Reset your password",
    text: `${greeting}\n\nSomeone asked to reset your password. Open this link within an hour to choose a new one:\n\n${link}\n\nIf it wasn't you, ignore this email and your password stays the same.`,
    html: `<p>${escapeHtml(greeting)}</p><p>Someone asked to reset your password. Open this link within an hour to choose a new one:</p><p><a href="${escapeHtml(link)}">Choose a new password</a></p><p>If it wasn't you, ignore this email and your password stays the same.</p>`,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
