/**
 * Ronde 39 — Service Worker: Web Push (VAPID) receiver.
 * Ronde 46 — PWA: ditambah lifecycle + fetch handler agar aplikasi INSTALLABLE
 * (manifest + SW dengan fetch handler = syarat install Chrome), tanpa agresif
 * caching agar tidak mengganggu mode dev / data segar CRM.
 * - push      : tampilkan notifikasi dari payload {title, body, url, tag}
 * - click     : fokus tab yang sudah ada / buka URL baru, lalu tutup notifikasi
 * - fetch     : pass-through (network-first transparan, offline → halaman darurat)
 */
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Ambil kendali segera agar push & PWA bekerja tanpa reload kedua.
      await self.clients.claim();
    })()
  );
});

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
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
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

// Fetch handler minimum (syarat installability) — semua permintaan tetap ke jaringan;
// navigasi offline mendapat halaman darurat ringan, bukan error dino browser.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          "<!doctype html><html lang=\"id\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Grup CRM — Offline</title><style>body{font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#fafafa;color:#3f3f46;margin:0}</style></head><body><main style=\"text-align:center\"><div style=\"font-size:40px\">📡</div><h1 style=\"font-size:18px;margin:8px 0\">Anda sedang offline</h1><p style=\"font-size:14px;color:#71717a;margin:0\">Sambungkan internet lalu muat ulang untuk membuka Grup CRM.</p></main></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        )
      )
    );
    return;
  }
  // Non-navigasi: biarkan default (pass-through).
});
