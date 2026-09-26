import type { ClientEvent, ServerEvent } from "@shared/events";
import { WS_CLOSE } from "@shared/events";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface SocketCallbacks<E extends { type: string } = ServerEvent> {
  onEvent: (event: E) => void;
  onStatus: (status: SocketStatus, attempt: number) => void;
  /** Called when the server tells us not to retry (auth/permission). */
  onFatal: (code: number, reason: string) => void;
}

const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Reconnecting WebSocket to a hub: a WorkspaceHub (/ws/workspaces/:id), or the
 * per-user UserHub (/ws/me) with its own event type. Reconnects are a normal condition:
 * exponential backoff with jitter, a heartbeat that also detects dead sockets,
 * and immediate retry when the tab regains connectivity or focus.
 */
export class WorkspaceSocket<E extends { type: string } = ServerEvent> {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = Date.now();
  private queue: string[] = [];

  constructor(
    private readonly path: string,
    private readonly callbacks: SocketCallbacks<E>,
  ) {
    window.addEventListener("online", this.handleOnline);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  connect(): void {
    if (this.closedByUser) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.callbacks.onStatus(this.attempt === 0 ? "connecting" : "reconnecting", this.attempt);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}${this.path}`);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.lastPong = Date.now();
      this.callbacks.onStatus("open", 0);
      for (const frame of this.queue.splice(0)) ws.send(frame);
      this.startHeartbeat();
    };
    ws.onmessage = (ev) => {
      let data: E;
      try {
        data = JSON.parse(String(ev.data)) as E;
      } catch {
        return;
      }
      if (data.type === "pong") {
        this.lastPong = Date.now();
        return;
      }
      this.callbacks.onEvent(data);
    };
    ws.onclose = (ev) => {
      this.stopHeartbeat();
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) return;
      if (ev.code === WS_CLOSE.UNAUTHENTICATED || ev.code === WS_CLOSE.FORBIDDEN) {
        this.callbacks.onStatus("closed", this.attempt);
        this.callbacks.onFatal(ev.code, ev.reason);
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here.
    };
  }

  send(event: ClientEvent): void {
    const frame = JSON.stringify(event);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
    else if (event.type !== "typing.start" && event.type !== "typing.stop" && event.type !== "ping") {
      // Only buffer state-changing events; drop chatter while offline.
      if (this.queue.length < 50) this.queue.push(frame);
    }
  }

  /** Force a reconnect now (e.g. after regaining focus with a stale socket). */
  reconnectNow(): void {
    if (this.closedByUser) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.connect();
  }

  close(): void {
    this.closedByUser = true;
    window.removeEventListener("online", this.handleOnline);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.queue = [];
    try {
      this.ws?.close(1000, "client closed");
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(this.attempt, 6));
    const delay = base / 2 + Math.random() * (base / 2);
    this.callbacks.onStatus("reconnecting", this.attempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPong > HEARTBEAT_MS * 2.5) {
        // Two missed pongs: the socket is dead even if the browser hasn't noticed.
        this.reconnectNow();
        return;
      }
      this.ws.send(JSON.stringify({ type: "ping" } satisfies ClientEvent));
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private handleOnline = () => {
    if (!this.ws) this.reconnectNow();
  };

  private handleVisibility = () => {
    if (document.visibilityState !== "visible") return;
    if (!this.ws) this.reconnectNow();
    else if (this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastPong > HEARTBEAT_MS * 2) this.reconnectNow();
  };
}
