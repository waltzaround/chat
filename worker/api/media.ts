import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware";
import { verifyMediaSignature } from "../integrations/embeds";

/** Largest image the proxy passes on. */
const MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Images in cards and link previews, fetched by this server so readers never contact
 * the image's host. Only URLs this server signed are served, so it isn't an open proxy.
 * No sign-in: the signature is the permission, and apps load these like any image.
 */
export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.get("/", async (c) => {
  const url = c.req.query("u") ?? "";
  const signature = c.req.query("s") ?? "";
  if (!url || !signature || !(await verifyMediaSignature(c.env, url, signature))) return c.text("Not found", 404);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.5,*/*;q=0.1", "User-Agent": "ChatMediaProxy/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cf: { cacheEverything: true, cacheTtl: 86_400 },
    } as RequestInit);
  } catch {
    return c.text("Image unavailable", 502);
  }
  const type = (upstream.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const length = Number(upstream.headers.get("content-length") ?? 0);
  // SVG can carry script; it's only shown through <img>, but refuse it anyway.
  if (!upstream.ok || !upstream.body || !type.startsWith("image/") || type === "image/svg+xml" || length > MAX_BYTES) {
    await upstream.body?.cancel();
    return c.text("Image unavailable", 502);
  }

  let seen = 0;
  const limited = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > MAX_BYTES) controller.error(new Error("too large"));
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
