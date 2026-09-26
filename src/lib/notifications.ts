import { useLocalStorage } from "@/hooks/useLocalStorage";

/**
 * Per-device notification settings (browser notifications are per device anyway).
 * Notifications fire for mentions, replies to you, and direct messages.
 */
export interface NotificationPrefs {
  /** Show browser notifications. Needs the browser's permission too. */
  desktop: boolean;
  /** Include the message text, not just who sent it. */
  showText: boolean;
  /** Workspaces that never show a browser notification (badges still count). */
  mutedWorkspaces: string[];
}

const KEY = "chat.notifications";
const DEFAULTS: NotificationPrefs = { desktop: false, showText: true, mutedWorkspaces: [] };

export function useNotificationPrefs() {
  return useLocalStorage<NotificationPrefs>(KEY, DEFAULTS);
}

/** Current settings, read fresh each time (for code outside React renders). */
export function readNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}
