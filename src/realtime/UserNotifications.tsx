import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationPayload, UserEvent } from "@shared/events";
import { keys, useDms, useWorkspaces, workspaceCache } from "@/lib/queries";
import { browserNotificationsSupported, readNotificationPrefs } from "@/lib/notifications";
import { desktopNotify, isDesktopApp, setDesktopBadge } from "@/lib/desktop";
import { WorkspaceSocket } from "./socket";

/** Are you looking at this channel right now? Then it's not news. */
function isReading(n: NotificationPayload): boolean {
  if (document.visibilityState !== "visible" || window.location.pathname !== `/w/${n.workspaceId}/c/${n.channelId}`) return false;
  // A thread reply is only "seen" if that thread is open.
  return !n.threadRootId || new URLSearchParams(window.location.search).get("thread") === n.threadRootId;
}

function pathFor(n: NotificationPayload): string {
  return `/w/${n.workspaceId}/c/${n.channelId}${n.threadRootId ? `?thread=${n.threadRootId}` : ""}`;
}

/**
 * Listens on the per-user connection (/ws/me) for mentions and DMs from any
 * workspace: bumps the badges, and shows a browser notification when allowed.
 */
export function UserNotifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const socket = new WorkspaceSocket<UserEvent>("/ws/me", {
      onStatus: () => undefined,
      onFatal: () => undefined,
      onEvent: (event) => {
        if (event.type !== "notification") return;
        const n = event.notification;
        if (n.kind === "dm") void qc.invalidateQueries({ queryKey: keys.dms });
        if (isReading(n)) return;
        if (n.kind === "mention") workspaceCache.addMention(qc, n.workspaceId, n.channelId, n.sequence);
        show(n, (path) => navigate(path));
      },
    });
    socket.connect();
    return () => socket.close();
  }, [qc, navigate]);

  useDesktopBadge();
  return null;
}

/** Unread mentions plus unread DMs, on the desktop app's dock or taskbar icon. */
function useDesktopBadge() {
  const workspaces = useWorkspaces().data;
  const dms = useDms().data;
  const total = (workspaces ?? []).reduce((n, w) => n + w.mentionCount, 0) + (dms ?? []).reduce((n, d) => n + d.unreadCount, 0);
  useEffect(() => {
    if (isDesktopApp()) setDesktopBadge(total);
  }, [total]);
}

function show(n: NotificationPayload, open: (path: string) => void) {
  const prefs = readNotificationPrefs();
  if (!prefs.desktop || prefs.mutedWorkspaces.includes(n.workspaceId)) return;
  const title = n.kind === "dm" ? n.author.displayName : `${n.author.displayName} in #${n.channelName}`;
  const body = prefs.showText ? n.preview || "Sent an attachment" : n.kind === "dm" ? "Sent you a message" : `Mentioned you in ${n.workspaceName}`;
  // The desktop app shows a native notification; clicking it brings the app forward.
  if (isDesktopApp()) return desktopNotify(title, body);
  if (!browserNotificationsSupported() || Notification.permission !== "granted") return;
  // One notification per channel: a newer one replaces the last.
  const notification = new Notification(title, { body, tag: n.channelId, icon: n.author.avatarUrl ?? "/favicon.svg" });
  notification.onclick = () => {
    window.focus();
    open(pathFor(n));
    notification.close();
  };
}
