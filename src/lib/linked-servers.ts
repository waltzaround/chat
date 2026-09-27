import { useEffect, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DirectMessage, InstanceInfo, WorkspaceSummary } from "@shared/types";
import { apiPost } from "./api";
import { desktopInvoke, isDesktopApp } from "./desktop";

/**
 * Other Chat servers you belong to, shown in the server rail below this one's
 * workspaces. Each holds a linked session: a token that can only read that server's
 * workspace list, DM list and unread counts (worker/auth/linked.ts).
 *
 * In a browser the list lives in this origin's localStorage, and linking works both
 * ways (see LinkPage). In the desktop app the app itself keeps one list for every
 * server it has open, so each server's rail shows all the others.
 */
export interface LinkedServer {
  origin: string;
  token: string;
}

const STORAGE_KEY = "chat.linkedServers";
const REFRESH_MS = 30_000;

export const linkedKeys = {
  all: ["linked-servers"] as const,
  summary: (origin: string) => ["linked-server", origin] as const,
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function readLocal(): LinkedServer[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as LinkedServer[];
    return parsed.filter((s) => typeof s.origin === "string" && typeof s.token === "string");
  } catch {
    return [];
  }
}

function writeLocal(servers: LinkedServer[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch {
    // Private mode or full storage: the link lasts until the page closes.
  }
}

/** Every linked server except this one. */
export async function loadLinkedServers(): Promise<LinkedServer[]> {
  const all = isDesktopApp() ? await desktopInvoke<LinkedServer[]>("linked_servers").catch(() => []) : readLocal();
  return all.filter((s) => s.origin !== window.location.origin);
}

export async function saveLinkedServer(server: LinkedServer): Promise<void> {
  if (isDesktopApp()) {
    await desktopInvoke("save_linked_server", { origin: server.origin, token: server.token });
    return;
  }
  writeLocal([...readLocal().filter((s) => s.origin !== server.origin), server]);
}

async function forgetLinkedServer(origin: string): Promise<void> {
  if (isDesktopApp()) {
    await desktopInvoke("remove_linked_server", { origin });
    return;
  }
  writeLocal(readLocal().filter((s) => s.origin !== origin));
}

// ---------------------------------------------------------------------------
// Talking to another server
// ---------------------------------------------------------------------------

export class LinkRevokedError extends Error {}

async function remoteFetch(server: LinkedServer, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${server.origin}${path}`, {
    ...init,
    credentials: "omit",
    headers: { Authorization: `Bearer ${server.token}`, ...(init.headers as Record<string, string> | undefined) },
  });
  if (res.status === 401) throw new LinkRevokedError(`${new URL(server.origin).host} signed this link out`);
  if (!res.ok) throw new Error(`${new URL(server.origin).host} answered ${res.status}`);
  return res;
}

/** "https://chat.example.com" from whatever someone typed. */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `${/^(localhost|127\.0\.0\.1)(:|$)/.test(trimmed) ? "http" : "https"}://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.origin;
  } catch {
    return null;
  }
}

/** Throws unless the address answers as a Chat server. */
export async function checkChatServer(origin: string): Promise<InstanceInfo> {
  let info: InstanceInfo | null = null;
  try {
    const res = await fetch(`${origin}/api/instance`, { credentials: "omit" });
    if (res.ok) info = (await res.json()) as InstanceInfo;
  } catch {
    info = null;
  }
  if (info?.software !== "beacon-chat") throw new Error("That address isn't a Chat server, or it can't be reached.");
  return info;
}

export interface LinkedSummary {
  workspaces: WorkspaceSummary[];
  dms: DirectMessage[];
}

async function loadSummary(server: LinkedServer): Promise<LinkedSummary> {
  const [workspaces, dms] = await Promise.all([
    remoteFetch(server, "/api/me/workspaces").then((r) => r.json() as Promise<WorkspaceSummary[]>),
    remoteFetch(server, "/api/dms").then((r) => r.json() as Promise<DirectMessage[]>),
  ]);
  return { workspaces: workspaces.filter((w) => w.kind !== "dm"), dms };
}

// Icons and avatars need the token, so <img src> can't load them directly.
const imageCache = new Map<string, Promise<string | null>>();

export function useLinkedImage(server: LinkedServer, path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return setUrl(null);
    const key = `${server.origin}${path}`;
    let pending = imageCache.get(key);
    if (!pending) {
      pending = remoteFetch(server, path)
        .then((r) => r.blob())
        .then((b) => URL.createObjectURL(b))
        .catch(() => null);
      imageCache.set(key, pending);
    }
    let live = true;
    void pending.then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [server, path]);
  return url;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useLinkedServers() {
  return useQuery({ queryKey: linkedKeys.all, queryFn: loadLinkedServers, staleTime: Infinity });
}

/** Each linked server's workspaces and DMs, refreshed every 30 seconds and on focus. */
export function useLinkedSummaries(servers: LinkedServer[]) {
  return useQueries({
    queries: servers.map((server) => ({
      queryKey: linkedKeys.summary(server.origin),
      queryFn: () => loadSummary(server),
      refetchInterval: REFRESH_MS,
      refetchOnWindowFocus: true,
      retry: (count: number, err: Error) => !(err instanceof LinkRevokedError) && count < 2,
    })),
  });
}

/** Unread mentions and DMs across linked servers, for the app badge. */
export function useLinkedUnreadTotal(): number {
  const servers = useLinkedServers().data ?? [];
  const summaries = useLinkedSummaries(servers);
  return summaries.reduce((n, q) => n + (q.data ? q.data.workspaces.reduce((m, w) => m + w.mentionCount, 0) + q.data.dms.reduce((m, d) => m + d.unreadCount, 0) : 0), 0);
}

/**
 * A new linked session on this server, for another server's rail (`linkedTo` is its
 * origin) or for the desktop app's server list ("desktop").
 */
export function mintLinkedSession(linkedTo: string): Promise<{ token: string }> {
  return apiPost<{ token: string }>("/api/me/linked-sessions", { linkedTo });
}

export function useUnlinkServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (server: LinkedServer) => {
      // Revoke it on the other server too. If that fails (offline, already revoked),
      // forget it here anyway; it also shows under that account's sessions.
      await remoteFetch(server, "/api/me/linked-session", { method: "DELETE" }).catch(() => undefined);
      await forgetLinkedServer(server.origin);
    },
    onSuccess: (_, server) => {
      qc.removeQueries({ queryKey: linkedKeys.summary(server.origin) });
      void qc.invalidateQueries({ queryKey: linkedKeys.all });
    },
  });
}

/** Opens a page on another server (switching servers in the desktop app). */
export function openOnServer(origin: string, path: string): void {
  if (isDesktopApp()) {
    void desktopInvoke("switch_server", { origin, path });
    return;
  }
  window.location.assign(`${origin}${path}`);
}

// ---------------------------------------------------------------------------
// Linking in a browser, by redirects (pop-ups get blocked):
//   1. here: /link?from=<here> on the other server, which asks for consent
//   2. there: back to <here>/link/complete#server=<there>&token=…&reply=1
//   3. here: save it, then <there>/link/complete#server=<here>&token=… so it shows us too
//   4. there: save it, then back to <here>.
// Each side only accepts a completion it started (a marker in sessionStorage), so a
// crafted link can't slip a server into your rail.
// ---------------------------------------------------------------------------

const PENDING_KEY = "chat.pendingLink";

function setPending(origin: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, origin);
  } catch {
    // Without sessionStorage the completion is refused; nothing breaks.
  }
}

function takePending(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Step 1: go to the other server to ask. */
export function startBrowserLink(origin: string): void {
  setPending(origin);
  window.location.assign(`${origin}/link?from=${encodeURIComponent(window.location.origin)}`);
}

/** Step 2, on the other server after consent. */
export async function approveBrowserLink(from: string): Promise<void> {
  const { token } = await mintLinkedSession(from);
  setPending(from);
  const params = new URLSearchParams({ server: window.location.origin, token, reply: "1" });
  window.location.assign(`${from}/link/complete#${params}`);
}

/** Steps 3 and 4. Returns the linked origin, or throws if this page wasn't expected. */
export async function completeBrowserLink(hash: string): Promise<string> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const server = normalizeOrigin(params.get("server") ?? "");
  const token = params.get("token");
  const expected = takePending();
  if (!server || !token || server !== expected) throw new Error("This link wasn't started here, so it was ignored.");
  await saveLinkedServer({ origin: server, token });
  if (params.get("reply") === "1") {
    const back = await mintLinkedSession(server).catch(() => null);
    if (back) {
      setPending(server);
      const reply = new URLSearchParams({ server: window.location.origin, token: back.token, done: window.location.origin });
      window.location.assign(`${server}/link/complete#${reply}`);
      return server;
    }
  }
  return server;
}

/**
 * In the desktop app every server it has open registers itself once, so the others
 * can show it in their rails.
 */
export async function registerWithDesktopApp(): Promise<void> {
  if (!isDesktopApp()) return;
  const all = await desktopInvoke<LinkedServer[]>("linked_servers").catch(() => null);
  if (!all || all.some((s) => s.origin === window.location.origin)) return;
  const { token } = await mintLinkedSession("desktop");
  await desktopInvoke("save_linked_server", { origin: window.location.origin, token });
}
