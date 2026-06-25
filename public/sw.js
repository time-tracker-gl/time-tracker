/*
 * rpc Task Management – Service Worker.
 *
 * Macht die App installierbar und offline-startfähig:
 *  - Navigationen: network-first (immer die neueste Version, sonst die zuletzt
 *    gecachte App-Shell offline).
 *  - Statische, gehashte Assets (JS/CSS/Icons): cache-first (Dateinamen sind
 *    content-gehasht und damit unveränderlich).
 *  - Fremd-Origins (Supabase-API, Google Fonts) werden bewusst nicht
 *    abgefangen, damit Login/Sync normal über das Netz laufen.
 *
 * Bei jedem Release die VERSION erhöhen, damit alte Caches verworfen werden.
 */
const VERSION = 'v2';
const CACHE = `rpc-tasks-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase/Fonts unangetastet lassen

  // App-Navigationen: network-first, offline auf die gecachte Shell zurückfallen.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(req)) ||
            (await cache.match('index.html')) ||
            (await cache.match('./')) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Statische Assets: cache-first, sonst aus dem Netz holen und ablegen.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200 && fresh.type === 'basic') cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return cached || Response.error();
      }
    })(),
  );
});
