/**
 * Ronde 39 — Service Worker: Web Push (VAPID) receiver.
 * - push      : tampilkan notifikasi dari payload {title, body, url, tag}
 * - click     : fokus tab yang sudah ada / buka URL baru, lalu tutup notifikasi
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Grup CRM", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Grup CRM";
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,
    icon: "/logo.svg",
    badge: "/logo.svg",
    data: { url: data.url || "/" },
    renotify: !!data.tag,
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
