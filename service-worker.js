const CACHE_NAME = "cardholder-v29";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/scanner.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
  "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js",
  "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js",
  "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
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

// Network-first: always serve fresh content when online so updates
// appear on next load; fall back to cache only when offline.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Only handle our own files and the precached CDN libs. Everything else
  // (third-party logo images, favicon services, etc.) must bypass the
  // worker and load natively — intercepting them can stall opaque
  // cross-origin image loads in the iOS PWA context.
  if (!sameOrigin && !SHELL_URLS.has(url.href)) return;

  // cache: "no-cache" forces revalidation with the server, bypassing
  // GitHub Pages' 10-minute HTTP cache staleness
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
