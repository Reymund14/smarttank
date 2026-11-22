// SmartTank service worker: lets the installed web app open quickly and show its
// screens without a connection. Live data always comes from Firebase (never cached here).
const CACHE = "smarttank-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // Firebase, AI etc. go straight to the network

  if (e.request.mode === "navigate") {
    // Pages: try the network first, fall back to the cached app shell when offline.
    e.respondWith(fetch(e.request).catch(() => caches.match("/index.html")));
    return;
  }
  // Built assets (hashed file names): cache first, then network.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }))
  );
});
