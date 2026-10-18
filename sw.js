/* ============================================================
   Pour Over Focus — service worker
   - Precache the app shell (both pages, manifest, icons, art)
   - Network-first for page navigations, cached per-URL so one
     page can never overwrite another page's cached copy; falls
     back to that page, then the app shell, when offline
   - Cache-first for other same-origin GETs, storing only
     successful (2xx) responses so a transient 404 or 5xx is
     never pinned in the cache for the life of a version
   Bump VERSION to invalidate old caches after an update.
   ============================================================ */
const VERSION = "pour-over-focus-v9";
const SHELL = "./index.html";          // last-resort offline fallback
const PRECACHE = [
  "./",
  "./index.html",
  "./pomodoro.html",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-192.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/img/coffee.jpg",
  "./assets/img/matcha.jpg",
  "./assets/img/espresso.jpg",
  "./assets/splash/apple-touch-startup-640x1136.png",
  "./assets/splash/apple-touch-startup-750x1334.png",
  "./assets/splash/apple-touch-startup-1125x2436.png",
  "./assets/splash/apple-touch-startup-1170x2532.png",
  "./assets/splash/apple-touch-startup-1179x2556.png",
  "./assets/splash/apple-touch-startup-1242x2208.png",
  "./assets/splash/apple-touch-startup-1284x2778.png",
  "./assets/splash/apple-touch-startup-1290x2796.png",
  "./assets/splash/apple-touch-startup-1536x2048.png",
  "./assets/splash/apple-touch-startup-1668x2224.png",
  "./assets/splash/apple-touch-startup-1668x2388.png",
  "./assets/splash/apple-touch-startup-2048x2732.png",
  "./assets/splash/apple-touch-startup-2160x1620.png",
  "./assets/splash/apple-touch-startup-2732x2048.png",
];

/* store a copy, but never an error page or an opaque cross-origin blob */
async function putInCache(request, response) {
  if (!response || !response.ok || response.type === "opaque") return;
  const cache = await caches.open(VERSION);
  await cache.put(request, response);
}

/* fill the cache. Each asset is added independently — one flaky URL (a 404 on
   a host that is mid-deploy, a blocked image) must not abort the whole install
   and leave the app with no offline support at all. */
async function precacheAll() {
  const cache = await caches.open(VERSION);
  const results = await Promise.allSettled(
    PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })))
  );
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.warn("[sw] precache skipped:", PRECACHE[i], result.reason);
    }
  });
}

/* install: fill the cache, then take control */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheAll();
      await self.skipWaiting();
    })()
  );
});

/* activate: drop stale caches and claim existing clients */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      // the browser can evict cache storage under disk pressure while keeping
      // the worker installed — install never runs again, so refill it here.
      if (!(await caches.match(SHELL))) await precacheAll();
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                                 // no external deps anyway
  if (url.pathname.startsWith("/api/")) return;                                    // never cache a live API or SSE stream
  if (url.pathname === new URL("./sw.js", self.location.href).pathname) return;    // let the browser handle its own update checks

  // Navigations: network-first so edits appear instantly; on network failure
  // or a bad status (e.g. offline), serve the cached copy of *this* page, then
  // the app shell. The response is stored under the request's own URL — caching
  // every navigation at "./index.html" would let /pomodoro.html overwrite the
  // main app's offline copy.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req, { cache: "no-store" });
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(putInCache(req, copy).catch(() => {}));
          }
          return res;
        } catch (err) {
          const mine = await caches.match(req, { ignoreSearch: true });
          if (mine) return mine;
          const shell = await caches.match(SHELL);
          if (shell) return shell;
          return new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title>" +
              "<body style=\"font:16px system-ui;padding:2rem;background:#f6ead3;color:#3b2b1f\">" +
              "<h1>You're offline</h1><p>Pour Over Focus hasn't been cached on this device yet. " +
              "Reconnect once and it will work offline from then on.</p>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
    return;
  }

  // Static assets: cache-first, then network + store (successful responses only).
  event.respondWith(
    (async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(putInCache(req, copy).catch(() => {}));
        }
        return res;
      } catch (err) {
        return new Response("", { status: 504, statusText: "Offline" });
      }
    })()
  );
});
