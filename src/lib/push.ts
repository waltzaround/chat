import { apiGet, apiPost, api } from "./api";

/** Web Push is possible in this browser (on iPhone, only once added to the Home Screen). */
export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iOS only allows push for apps added to the Home Screen. */
export function needsHomeScreen(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker registration failed", err));
  });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function isPushEnabled(): Promise<boolean> {
  return !!(await currentSubscription());
}

/** Ask permission, subscribe this device, and tell the server. */
export async function enablePush(prefs: { mutedWorkspaces: string[]; hideText: boolean }): Promise<void> {
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Your browser blocked notifications. Allow them for this site, then try again.");
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await apiGet<{ publicKey: string }>("/api/push/key");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64url(publicKey) }));
  await apiPost("/api/push/subscriptions", { endpoint: sub.endpoint, ...prefs });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("/api/push/subscriptions", { method: "DELETE", json: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe();
}

/** Keep the server's copy of this device's settings current. */
export async function syncPushPrefs(prefs: { mutedWorkspaces: string[]; hideText: boolean }): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await apiPost("/api/push/subscriptions", { endpoint: sub.endpoint, ...prefs });
}

function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bytes = new Uint8Array(new ArrayBuffer(padded.length));
  const binary = atob(padded);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.slice(0, binary.length);
}
