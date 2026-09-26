import { Hono } from "hono";
import type { BackgroundJob, Env } from "./env";
import { withServices, resolveSession, type AppEnv } from "./auth/middleware";
import { errorHandler, ApiError } from "./lib/errors";
import { securityHeaders } from "./security/headers";
import { verifyTurnstile, clientIp } from "./security/turnstile";
import { bumpPersistentCounter, resetPersistentCounter } from "./security/ratelimit";
import { meRoutes } from "./api/me";
import { workspaceRoutes } from "./api/workspaces";
import { channelRoutes } from "./api/channels";
import { inviteRoutes } from "./api/invites";
import { uploadRoutes, fileRoutes } from "./api/uploads";
import { voiceRoutes } from "./api/voice";
import { emojiRoutes } from "./api/emojis";
import { serverRoutes } from "./api/server";
import { reportQueueRoutes, reportRoutes } from "./api/reports";
import { loadMemberContext } from "./permissions/resolve";
import { hubFor } from "./lib/hub";
import { handleQueue } from "./queues/consumer";
import { track } from "./analytics/track";
import type { PreferredStatus } from "@shared/types";

export { WorkspaceHub } from "./durable-objects/workspace-hub";

const app = new Hono<AppEnv>();

app.onError(errorHandler);
app.use("*", securityHeaders);
app.use("*", withServices);

// Latency + error analytics for API routes.
app.use("/api/*", async (c, next) => {
  const start = Date.now();
  await next();
  const route = c.req.routePath || c.req.path;
  track(c.env, { name: "api.request", route, status: c.res.status, durationMs: Date.now() - start });
});

// ---------------------------------------------------------------------------
// Auth (Better Auth) with Turnstile + abuse protection on the credential routes
// ---------------------------------------------------------------------------

const AUTH_FAIL_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAILS_BEFORE_CHALLENGE = 5;

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const path = c.req.path;
  const ip = clientIp(c.req.raw) ?? "unknown";
  const db = c.get("db");

  if (c.req.method === "POST" && path.endsWith("/sign-up/email")) {
    await verifyTurnstile(c.env, c.req.header("x-turnstile-token"), ip);
    const attempts = await bumpPersistentCounter(db, `signup:${ip}`, 60 * 60 * 1000);
    if (attempts > 20) throw ApiError.rateLimited(3600);
  }

  // Every request can send an email, so keep them rare per IP.
  if (c.req.method === "POST" && path.endsWith("/request-password-reset")) {
    const attempts = await bumpPersistentCounter(db, `reset:${ip}`, 60 * 60 * 1000);
    if (attempts > 5) throw ApiError.rateLimited(3600);
  }

  const isSignIn = c.req.method === "POST" && path.endsWith("/sign-in/email");
  if (isSignIn) {
    const fails = await bumpPersistentCounter(db, `signin:${ip}`, AUTH_FAIL_WINDOW_MS);
    if (fails > 50) throw ApiError.rateLimited(900);
    if (fails > AUTH_FAILS_BEFORE_CHALLENGE) await verifyTurnstile(c.env, c.req.header("x-turnstile-token"), ip);
  }

  const res = await c.get("auth").handler(c.req.raw);
  if (isSignIn && res.ok) await resetPersistentCounter(db, `signin:${ip}`);
  return res;
});

/** Tells the client whether a sign-in attempt from this IP needs a Turnstile token. */
app.get("/api/auth-challenge", async (c) => {
  const ip = clientIp(c.req.raw) ?? "unknown";
  const row = await c.env.DB.prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?").bind(`signin:${ip}`).first<{ count: number; reset_at: number }>();
  const required = !!row && row.reset_at > Date.now() && row.count >= AUTH_FAILS_BEFORE_CHALLENGE && !!c.env.TURNSTILE_SECRET_KEY;
  return c.json({ turnstileRequired: required });
});

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

app.route("/api", meRoutes);
app.route("/api/workspaces", workspaceRoutes);
app.route("/api/workspaces", emojiRoutes);
app.route("/api/channels", channelRoutes);
app.route("/api/invites", inviteRoutes);
app.route("/api/uploads", uploadRoutes);
app.route("/api/files", fileRoutes);
app.route("/api/channels", voiceRoutes);
app.route("/api/server", serverRoutes);
app.route("/api/channels", reportRoutes);
app.route("/api/workspaces", reportQueueRoutes);

app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "No such endpoint" } }, 404));

// ---------------------------------------------------------------------------
// WebSocket upgrade — authenticate here, then hand the socket to the hub
// ---------------------------------------------------------------------------

app.get("/ws/workspaces/:workspaceId", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.text("Expected WebSocket upgrade", 426);
  const db = c.get("db");
  const session = await resolveSession(c.get("auth"), db, c.req.raw.headers);
  if (!session) return c.text("Unauthenticated", 401);
  const workspaceId = c.req.param("workspaceId");
  const ctx = await loadMemberContext(db, workspaceId, session.user.id);
  if (!ctx) return c.text("Not a member", 403);

  const headers = new Headers(c.req.raw.headers);
  headers.set("x-user-id", session.user.id);
  headers.set("x-session-id", session.sessionId);
  headers.set("x-workspace-id", workspaceId);
  headers.set("x-user-status", (session.user.status as PreferredStatus) ?? "online");
  return hubFor(c.env, workspaceId).fetch(new Request(c.req.raw.url, { headers, method: "GET" }));
});

// Anything else is a static asset (SPA fallback handled by Workers Static Assets).
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  queue: (batch, env) => handleQueue(batch as MessageBatch<BackgroundJob>, env),
  // Cron trigger (see wrangler.jsonc): fan maintenance out to the queue so it never runs on the request path.
  scheduled: async (_event, env) => {
    await env.BACKGROUND_QUEUE.sendBatch([
      { body: { type: "invites.expire" } },
      { body: { type: "attachment.cleanup", olderThanMs: 24 * 60 * 60 * 1000 } },
    ]);
  },
} satisfies ExportedHandler<Env>;
