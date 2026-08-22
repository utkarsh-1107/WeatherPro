const CACHE_NAME = "weather-intelligence-v4";
const APP_SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined)
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept API requests. They must return actual JSON/network errors,
  // never the cached HTML app shell.
  if (
    url.origin === self.location.origin &&
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // Never intercept third-party API/tile/provider requests. Browser fetch must
  // see the real provider response or real network failure.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navigation: network first, app shell only as a true offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();

            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put("/", copy))
              .catch(() => undefined);
          }

          return response;
        })
        .catch(async () => {
          return (
            (await caches.match("/")) ||
            Response.error()
          );
        })
    );

    return;
  }

  const cacheable =
    url.pathname.startsWith("/_next/static/") ||
    ["style", "script", "image", "font"].includes(
      request.destination
    );

  if (!cacheable) {
    return;
  }

  // Static assets: cache-first with a background refresh.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();

            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined);
          }

          return response;
        })
        .catch(() => cached || Response.error());

      return cached || network;
    })
  );
});
