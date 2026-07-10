/* WaveScope service worker — offline-first for a fully static SPA.
 *
 *  - /assets/*: content-hashed and immutable → cache-first.
 *  - other same-origin GETs (vendor engines, projectM wasm, .milk presets,
 *    icons, manifest): stale-while-revalidate — serve fast, refresh behind.
 *  - navigations: network-first, falling back to the cached shell, so the
 *    console keeps opening with no connection at all.
 *
 * Bump VERSION to invalidate everything after a breaking asset change.
 */
const VERSION = "ws-v1";
const SHELL = "/index.html";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.add(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fonts etc. stay on the network

  // App navigations: freshest shell when online, cached shell offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(VERSION)
            .then((c) => c.put(SHELL, copy))
            .catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }

  // Hashed build assets never change under the same name.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches
                .open(VERSION)
                .then((c) => c.put(req, copy))
                .catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else same-origin: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches
              .open(VERSION)
              .then((c) => c.put(req, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    }),
  );
});
