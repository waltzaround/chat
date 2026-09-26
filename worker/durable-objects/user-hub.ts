/**
 * UserHub: one Durable Object per user, holding that user's /ws/me connections.
 * Workspace hubs (and the queue, for large fan-outs) call notify() when a message
 * mentions or DMs the user, so it arrives whichever workspace they have open.
 * Stateless beyond its hibernating sockets; later the place to add Web Push.
 */
import { DurableObject } from "cloudflare:workers";
import type { UserEvent } from "@shared/events";
import type { Env } from "../env";

export class UserHub extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket upgrade", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async notify(event: UserEvent): Promise<void> {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* closing */
      }
    }
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
