import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { schema } from "@db/schema";
import { newId } from "@shared/id";
import { usernameSchema } from "@shared/schemas";
import type { Env } from "../env";
import type { Db } from "../db";
import { assertMayRegister, claimOwnership, RegistrationError, verifiedEmailRequiredSince } from "../instance";
import { emailEnabled, sendPasswordResetEmail, sendVerificationEmail } from "../email";

export type Auth = ReturnType<typeof buildAuth>;

const cache = new WeakMap<object, Map<string, Auth>>();

/**
 * Better Auth instance bound to this Worker's D1 database and public origin.
 * Cached per `env` object and origin so that a single isolate builds it once
 * per hostname it is served on.
 */
export function createAuth(env: Env, db: Db, origin: string, secret: string): Auth {
  let byOrigin = cache.get(env);
  if (!byOrigin) {
    byOrigin = new Map();
    cache.set(env, byOrigin);
  }
  const cached = byOrigin.get(origin);
  if (cached) return cached;
  const auth = buildAuth(env, db, origin, secret);
  byOrigin.set(origin, auth);
  return auth;
}

function buildAuth(env: Env, db: Db, origin: string, secret: string) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }

  const auth = betterAuth({
    appName: "Chat",
    baseURL: origin,
    basePath: "/api/auth",
    secret,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, { provider: "sqlite", schema, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // A new password signs the account out everywhere else.
      revokeSessionsOnPasswordReset: true,
      // "Forgot password?" by email only exists when email is set up (Workers Paid plan).
      // Without it, the server owner hands out reset links instead (api/server.ts).
      ...(emailEnabled(env)
        ? {
            sendResetPassword: async ({ user, token }: { user: { email: string; name: string }; token: string }) => {
              await sendPasswordResetEmail(env, user, resetPasswordUrl(origin, token));
            },
          }
        : {}),
    },
    socialProviders,
    // Native apps sign in with a token (sent back in the set-auth-token header) instead
    // of a cookie. Only signed tokens are accepted.
    plugins: [bearer({ requireSignature: true })],
    // With email set up, every new account gets a link to confirm its address.
    ...(emailEnabled(env)
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url }: { user: { email: string; name: string }; url: string }) => {
              await sendVerificationEmail(env, user, url);
            },
          },
        }
      : {}),
    user: {
      fields: { name: "displayName" },
      additionalFields: {
        username: { type: "string", required: false, input: true },
        bio: { type: "string", required: false, input: false },
        status: { type: "string", required: false, input: false, defaultValue: "online" },
        avatarKey: { type: "string", required: false, input: false },
      },
    },
    session: {
      additionalFields: {
        scope: { type: "string", required: false, input: false },
      },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      database: { generateId: () => newId() },
      cookiePrefix: "chat",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true, path: "/" },
    },
    databaseHooks: {
      session: {
        create: {
          // Covers every way in: email, Google, GitHub.
          before: async (session) => {
            const row = await env.DB.prepare("SELECT suspended_at, email_verified, created_at FROM users WHERE id = ?")
              .bind(session.userId)
              .first<{ suspended_at: number | null; email_verified: number; created_at: number }>();
            if (row?.suspended_at) {
              throw new APIError("FORBIDDEN", { message: "This account is suspended. Contact the server owner.", code: "account_suspended" });
            }
            const since = await verifiedEmailRequiredSince(env.DB);
            if (row && since !== null && !row.email_verified && row.created_at >= since) {
              throw new APIError("FORBIDDEN", { message: "Confirm your email first: open the link we sent you, then sign in.", code: "email_not_verified" });
            }
          },
        },
      },
      user: {
        create: {
          before: async (user, context) => {
            try {
              await assertMayRegister(env, context?.headers ?? context?.request?.headers);
            } catch (error) {
              if (error instanceof RegistrationError) throw new APIError("FORBIDDEN", { message: error.message, code: error.reason });
              throw error;
            }
            const raw = (user as { username?: string }).username;
            let username: string;
            if (raw) {
              const parsed = usernameSchema.safeParse(raw);
              if (!parsed.success) {
                throw new APIError("BAD_REQUEST", { message: parsed.error.issues[0]?.message ?? "Invalid username" });
              }
              username = parsed.data;
            } else {
              username = suggestUsername(user.email, user.name);
            }
            const existing = await db.query.users.findFirst({ where: (t, { eq }) => eq(t.username, username) });
            if (existing) {
              if (raw) throw new APIError("BAD_REQUEST", { message: "That username is taken" });
              username = `${username}_${Math.random().toString(36).slice(2, 6)}`;
            }
            return { data: { ...user, username, name: user.name || username, status: "online" } };
          },
          // The first account on a fresh server owns it.
          after: async (user) => {
            await claimOwnership(env.DB, user.id);
          },
        },
      },
    },
  });

  return auth;
}

/** The app's own reset page; it posts the token to /api/auth/reset-password. */
export function resetPasswordUrl(origin: string, token: string): string {
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
}

function suggestUsername(email: string, name?: string | null): string {
  const base = (name || email.split("@")[0] || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return base.length >= 2 ? base : `user_${Math.random().toString(36).slice(2, 8)}`;
}
