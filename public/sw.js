// Bump this whenever a precached file's *contents* change (not just this
// file) — the browser only re-checks the worker when sw.js's own bytes
// differ, so an unbumped name can leave already-installed clients on a
// stale manifest/icon set indefinitely.
const CACHE_NAME = "jellyflow-shell-v0.1.0-experimental-1";
const SHELL_URL = "/";
const PRECACHE = [
  SHELL_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Best-effort per file: cache.addAll() is all-or-nothing, so one
      // flaky/missing asset would otherwise abort install entirely and the
      // worker would never activate.
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Runtime configuration, Jellyfin APIs, artwork and media must never enter
  // the service-worker cache. They can contain private server data or tokens.
  if (url.pathname === "/env-config.js" || url.pathname.startsWith("/jellyfin/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy)));
          }
          return response;
        })
        .catch(() => caches.match(SHELL_URL)),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
            }
            return response;
          }),
      ),
    );
  }
});
