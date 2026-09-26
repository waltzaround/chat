/*
 * Service worker: makes the app installable and shows push notifications when no tab
 * is open. Pushes carry no payload; on each one we ask the server what's new (with the
 * signed-in cookie) and show it. A notification per channel replaces the previous one.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(showPending());
});

async function showPending() {
  let items = [];
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const query = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "";
    const res = await fetch(`/api/push/pending${query}`, { credentials: "same-origin" });
    if (res.ok) items = await res.json();
  } catch {
    /* offline or signed out: fall through to the generic notice */
  }
  if (!items.length) {
    // Browsers require a notification for every push.
    return self.registration.showNotification("Chat", { body: "You have new messages", tag: "chat-generic", icon: "/icon-192.png" });
  }
  await Promise.all(
    items.map((n) =>
      self.registration.showNotification(n.title, {
        body: n.body,
        tag: n.channelId,
        icon: n.icon || "/icon-192.png",
        badge: "/icon-192.png",
        timestamp: Date.parse(n.createdAt),
        data: { url: n.url },
      }),
    ),
  );
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
