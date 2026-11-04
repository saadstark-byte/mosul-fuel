// Service worker: serves every app file from the on-phone cache so the app works with no internet.
// Files are put in the cache by js/offline.js (so the app can show download progress).
const CACHE = "mfuel-data";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Downloads made by the updater must reach the network.
  if (url.searchParams.has("fresh")) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (url.pathname.endsWith("/files.json")) {
      try {
        return await fetch(req, { cache: "no-store" });
      } catch {
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }
    }
    let res = await cache.match(req, { ignoreSearch: true });
    if (!res && req.mode === "navigate") res = await cache.match(new URL("index.html", self.registration.scope).href);
    if (res) return res;
    return fetch(req);
  })());
});
