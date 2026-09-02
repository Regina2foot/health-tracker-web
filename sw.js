/* Service worker: makes the app open without a connection.
 *
 * It caches only the app's own files — the markup, styles, script and icons.
 * It never touches entries: those live in localStorage, are never requested
 * over the network, and so never pass through here.
 *
 * Bump CACHE_NAME whenever the cached files change. The old cache is deleted
 * on activate, which is what stops a stale version living on someone's phone
 * indefinitely.
 */

const CACHE_NAME = 'health-tracker-v7';

const SHELL = [
  './',
  './index.html',
  './style.css?v=7',
  './app.js?v=7',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      // Take over straight away rather than waiting for every tab to close.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Only GETs, and only this app's own origin.
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Serve from cache immediately, then quietly refresh it for next
        // time. Offline stays instant; an update lands on the following load.
        event.waitUntil(
          fetch(event.request)
            .then((response) => {
              if (response && response.ok) {
                return caches.open(CACHE_NAME)
                  .then((cache) => cache.put(event.request, response));
              }
              return undefined;
            })
            .catch(() => undefined),  // offline: keep the cached copy
        );
        return cached;
      }

      return fetch(event.request).catch(() => caches.match('./index.html'));
    }),
  );
});
