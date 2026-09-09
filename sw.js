const CACHE = "cahesa-control-pagos-v2";

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./manifest.webmanifest",
  "./img/icon-192.png",
  "./img/icon-512.png",
  "./img/perfil.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            key.startsWith("cahesa-control-pagos-") &&
            key !== CACHE
          )
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // MUY IMPORTANTE:
  // Firebase config nunca debe quedar atrapado en la caché.
  if (url.pathname.endsWith("/firebase-config.js")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {

        if (response.ok && url.origin === location.origin) {
          const copy = response.clone();

          caches.open(CACHE).then(cache => {
            cache.put(event.request, copy);
          });
        }

        return response;
      });
    })
  );
});
