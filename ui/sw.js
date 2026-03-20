const CACHE_NAME = "codex-discord-connected-display-shell-v24";
const SHELL_ASSETS = [
  "/",
  "/index.html?v=0.1.23",
  "/styles.css?v=0.1.23",
  "/app.js?v=0.1.23",
  "/manifest.webmanifest?v=0.1.23",
  "/icon.svg?v=0.1.23",
  "/icon-maskable.svg?v=0.1.23",
  "/icon-192.png?v=0.1.23",
  "/icon-512.png?v=0.1.23",
  "/icon-maskable-512.png?v=0.1.23",
];

function isCacheableRequest(requestUrl) {
  return (
    requestUrl.origin === self.location.origin &&
    !requestUrl.pathname.startsWith("/api/") &&
    !requestUrl.pathname.startsWith("/uploads/") &&
    requestUrl.pathname !== "/api/stream"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (!isCacheableRequest(requestUrl)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      });
    }),
  );
});
