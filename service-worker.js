const CACHE_NAME = "cardholder-v53";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/scanner.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
  "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js",
  "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js",
  "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"
];

self.addEventListener("install", (event) => {
  // Cache each file independently (not addAll, which is atomic) so one
  // unreachable CDN can't fail the whole install and leave us with no cache.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((e) => console.warn("SW: could not cache", url, e))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Absolute URLs of the precached app shell (for offline matching)
const SHELL_URLS = new Set(APP_SHELL.map((u) => new URL(u, self.location).href));

// Stale-while-revalidate: serve the app shell from cache INSTANTLY so the
// app launches with no network wait, then refresh the cache in the
// background so the next launch picks up any update. (Network-first here
// caused long white-screen hangs — the app couldn't draw until the network
// returned, and a single slow CDN request could block launch for ~20s.)
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Only handle our own files and the precached CDN libs. Everything else
  // (third-party logo images, favicon services, etc.) must bypass the
  // worker and load natively.
  if (!sameOrigin && !SHELL_URLS.has(url.href)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const networkUpdate = fetch(event.request)
        .then((response) => {
          if (response && response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => null);
      // Cached copy wins immediately; only wait on the network when there
      // is nothing cached yet (first ever load / a brand-new file).
      return cached || (await networkUpdate) || fetch(event.request);
    })
  );
});
