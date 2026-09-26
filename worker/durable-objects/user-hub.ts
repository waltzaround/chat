/**
 * UserHub: one Durable Object per user, holding that user's /ws/me connections.
 * Workspace hubs (and the queue, for large fan-outs) call notify() when a message
 * mentions or DMs the user, so it arrives whichever workspace they have open.
 * Stateless beyond its hibernating sockets; later the place to add Web Push.
 */
import { DurableObject } from "cloudflare:workers";
import type { NotificationPayload, UserEvent } from "@shared/events";
import type { Env } from "../env";
import { pushToUser } from "../lib/push";

/** How long a notification stays available to the service worker after a push. */
const RECENT_MS = 10 * 60 * 1000;
const RECENT_MAX = 20;

export class UserHub extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket upgrade", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /**
   * Deliver to open tabs; with none open, send a Web Push so the device shows it.
   * Recent notifications are kept for the service worker to fetch after a push.
   */
  async notify(event: UserEvent, userId: string): Promise<void> {
    const payload = JSON.stringify(event);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        /* closing */
      }
    }
    if (event.type !== "notification") return;
    const now = Date.now();
    const recent = ((await this.ctx.storage.get<Array<{ at: number; n: NotificationPayload }>>("recent")) ?? []).filter((r) => now - r.at < RECENT_MS);
    recent.push({ at: now, n: event.notification });
    await this.ctx.storage.put("recent", recent.slice(-RECENT_MAX));
    if (sockets.length === 0) this.ctx.waitUntil(pushToUser(this.env, userId, event.notification).catch((err) => console.error("push failed", err)));
  }

  /** Notifications from the last few minutes, newest last. */
  async recent(): Promise<NotificationPayload[]> {
    const now = Date.now();
    return ((await this.ctx.storage.get<Array<{ at: number; n: NotificationPayload }>>("recent")) ?? []).filter((r) => now - r.at < RECENT_MS).map((r) => r.n);
  }

  /** Suspension or deletion: close every connection so the client signs out. */
  async disconnect(code: number, reason: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(code, reason);
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw === "string" && raw.includes('"ping"')) ws.send(JSON.stringify({ type: "pong" } satisfies UserEvent));
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      /* already closed */
    }
  }
}
