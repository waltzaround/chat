import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { userHub } from "../lib/notify";
import { toPushItem, vapidKeys } from "../lib/push";
import { pushSubscriptionSchema } from "@shared/schemas";

/** Web Push: devices subscribe here; the service worker fetches what to show. */
export const pushRoutes = new Hono<AppEnv>();
pushRoutes.use("*", requireUser);

/** Only real push services, so the server never posts to arbitrary URLs. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

pushRoutes.get("/key", async (c) => c.json({ publicKey: (await vapidKeys(c.env)).publicKey }));

pushRoutes.post("/subscriptions", async (c) => {
  const input = await parseBody(c, pushSubscriptionSchema);
  const url = new URL(input.endpoint);
  if (url.protocol !== "https:" || !PUSH_HOSTS.some((re) => re.test(url.hostname))) throw ApiError.validation(undefined, "That isn't a push service this server knows");
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, origin, muted_workspaces, hide_text, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, origin = excluded.origin, muted_workspaces = excluded.muted_workspaces, hide_text = excluded.hide_text`,
  )
    .bind(input.endpoint, c.get("user").id, c.get("origin"), JSON.stringify(input.mutedWorkspaces), input.hideText ? 1 : 0, Date.now())
    .run();
  return c.body(null, 204);
});

pushRoutes.delete("/subscriptions", async (c) => {
  const { endpoint } = await parseBody(c, pushSubscriptionSchema.pick({ endpoint: true }));
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, c.get("user").id).run();
  return c.body(null, 204);
});

/** Called by the service worker with its endpoint, so each device's settings apply. */
pushRoutes.get("/pending", async (c) => {
  const me = c.get("user").id;
  const endpoint = c.req.query("endpoint");
  const sub = endpoint
    ? await c.env.DB.prepare("SELECT muted_workspaces, hide_text FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, me).first<{ muted_workspaces: string; hide_text: number }>()
    : null;
  const muted = new Set(sub ? (JSON.parse(sub.muted_workspaces) as string[]) : []);
  const recent = await userHub(c.env, me).recent();
  return c.json(recent.filter((n) => !muted.has(n.workspaceId)).map((n) => toPushItem(n, !!sub?.hide_text)));
});
