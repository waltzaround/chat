import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationPayload, UserEvent } from "@shared/events";
import { keys, workspaceCache } from "@/lib/queries";
import { browserNotificationsSupported, readNotificationPrefs } from "@/lib/notifications";
import { WorkspaceSocket } from "./socket";

/** Are you looking at this channel right now? Then it's not news. */
function isReading(n: NotificationPayload): boolean {
  return document.visibilityState === "visible" && window.location.pathname === `/w/${n.workspaceId}/c/${n.channelId}`;
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

  return null;
}

function show(n: NotificationPayload, open: (path: string) => void) {
  const prefs = readNotificationPrefs();
  if (!prefs.desktop || prefs.mutedWorkspaces.includes(n.workspaceId)) return;
  if (!browserNotificationsSupported() || Notification.permission !== "granted") return;
  const title = n.kind === "dm" ? n.author.displayName : `${n.author.displayName} in #${n.channelName}`;
  const body = prefs.showText ? n.preview || "Sent an attachment" : n.kind === "dm" ? "Sent you a message" : `Mentioned you in ${n.workspaceName}`;
  // One notification per channel: a newer one replaces the last.
  const notification = new Notification(title, { body, tag: n.channelId, icon: n.author.avatarUrl ?? "/favicon.svg" });
  notification.onclick = () => {
    window.focus();
    open(`/w/${n.workspaceId}/c/${n.channelId}`);
    notification.close();
  };
}
