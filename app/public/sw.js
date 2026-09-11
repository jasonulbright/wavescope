/* WaveScope service worker — offline-first for a fully static SPA.
 *
 *  - /assets/*: content-hashed and immutable → cache-first.
 *  - other same-origin GETs (projectM wasm, .milk presets,
 *    icons, manifest): stale-while-revalidate — serve fast, refresh behind.
 *  - navigations: network-first, falling back to the cached shell, so the
 *    console keeps opening with no connection at all.
 *
 * Bump VERSION to invalidate everything after a breaking asset change.
 * v3 separates the audience document from the app shell.
 */
const VERSION = "ws-v3";
const SHELL = "/index.html";
const AUDIENCE = "/audience.html";
const blankAudience = () => new Response(
  '<!doctype html><html style="background:#000"><title>WaveScope Audience Output</title></html>',
  { headers: { "content-type": "text/html; charset=utf-8" } },
);

/**
 * Only cache what the URL claims to be. The host rewrites EVERY unknown path
 * to the HTML shell with a 200 — during a deploy race an asset URL can answer
 * text/html, and caching that would break the engine loaders (a .js that is
 * actually index.html). Navigations are the only requests allowed to store
 * HTML.
 */
function okToCache(req, res) {
  if (!res.ok) return false;
  if (req.mode === "navigate") return true;
  const ct = res.headers.get("content-type") || "";
  return !ct.includes("text/html");
}

function putGuarded(req, res) {
  if (!okToCache(req, res)) return;
  const copy = res.clone();
  caches
    .open(VERSION)
    .then((c) => c.put(req, copy))
    .catch(() => {});
}

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

  // An audience navigation must never cache over, or fall back to, the console.
  // Also reject a host's 200 SPA rewrite if this static file is missing.
  if (req.mode === "navigate" && url.pathname === AUDIENCE) {
    e.respondWith(
      fetch(req).then(async (res) => {
        if (!res.ok || !(await res.clone().text()).includes('<video id="audience"')) {
          return blankAudience();
        }
        const cache = await caches.open(VERSION);
        await cache.put(AUDIENCE, res.clone()).catch(() => {});
        return res;
      }).catch(() => caches.match(AUDIENCE).then((hit) => hit || blankAudience())),
    );
    return;
  }

  // App navigations: freshest shell when online, cached shell offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches
              .open(VERSION)
              .then((c) => c.put(SHELL, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit || Response.error())),
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
            putGuarded(req, res);
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
          putGuarded(req, res);
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || refresh;
    }),
  );
});
