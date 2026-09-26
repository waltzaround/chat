/**
 * Inside the desktop app (Tauri), the server's own web app runs in a native window and
 * can use a few native features through window.__TAURI__. In a normal browser none of
 * this exists and every function here is a no-op.
 */
interface TauriGlobal {
  core: { invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> };
  notification: {
    isPermissionGranted(): Promise<boolean>;
    requestPermission(): Promise<NotificationPermission>;
    sendNotification(options: { title: string; body?: string }): void;
  };
  opener: { openUrl(url: string): Promise<void> };
}

function tauri(): TauriGlobal | null {
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

export function isDesktopApp(): boolean {
  return tauri() !== null;
}

export async function desktopNotificationsAllowed(): Promise<boolean> {
  return (await tauri()?.notification.isPermissionGranted()) ?? false;
}

export async function requestDesktopNotifications(): Promise<boolean> {
  const t = tauri();
  if (!t) return false;
  if (await t.notification.isPermissionGranted()) return true;
  return (await t.notification.requestPermission()) === "granted";
}

export function desktopNotify(title: string, body: string): void {
  tauri()?.notification.sendNotification({ title, body });
}

/** Unread mentions and DMs on the dock icon or taskbar. */
export function setDesktopBadge(count: number): void {
  void tauri()?.core.invoke("set_unread", { count }).catch(() => undefined);
}

/** Back to the app's "choose your server" page. */
export function changeDesktopServer(): void {
  void tauri()?.core.invoke("change_server");
}

/** Links that would open a new tab go to the system browser instead. */
export function openExternalLinksInBrowser(): void {
  const t = tauri();
  if (!t) return;
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.origin === window.location.origin) return;
      event.preventDefault();
      void t.opener.openUrl(link.href);
    },
    true,
  );
}
