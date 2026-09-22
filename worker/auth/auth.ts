import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { schema } from "@db/schema";
import { newId } from "@shared/id";
import { usernameSchema } from "@shared/schemas";
import type { Env } from "../env";
import type { Db } from "../db";

export type Auth = ReturnType<typeof buildAuth>;

const cache = new WeakMap<object, Auth>();

/**
 * Better Auth instance bound to this Worker's D1 database. Cached per `env`
 * object so that a single isolate builds it once.
 */
export function createAuth(env: Env, db: Db): Auth {
  const cached = cache.get(env);
  if (cached) return cached;
  const auth = buildAuth(env, db);
  cache.set(env, auth);
  return auth;
}

function buildAuth(env: Env, db: Db) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }

  const auth = betterAuth({
    appName: "Commons",
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    // Local development only: allow the Vite plugin's quick tunnel origin.
    trustedOrigins: env.APP_URL.includes("localhost") ? [env.APP_URL, "https://*.trycloudflare.com"] : [env.APP_URL],
    database: drizzleAdapter(db, { provider: "sqlite", schema, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    socialProviders,
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
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      database: { generateId: () => newId() },
      cookiePrefix: "commons",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true, path: "/" },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
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
        },
      },
    },
  });

  return auth;
}

function suggestUsername(email: string, name?: string | null): string {
  const base = (name || email.split("@")[0] || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return base.length >= 2 ? base : `user_${Math.random().toString(36).slice(2, 8)}`;
}
