import type { MiddlewareHandler } from "hono";

/** Security headers for API responses. HTML responses get theirs from public/_headers. */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  // WebSocket upgrade responses (101) carry immutable headers and must be left alone.
  if (c.res.status === 101) return;
  try {
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=()");
    if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  } catch {
    // Some upstream responses (e.g. static assets) are immutable; headers for those are configured elsewhere.
  }
};
