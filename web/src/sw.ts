/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// App shell (issue #8): precache the build's own JS/CSS/HTML so the app still opens offline.
// self.__WB_MANIFEST is injected by vite-plugin-pwa's injectManifest strategy at build time.
precacheAndRoute(self.__WB_MANIFEST);

// Ticket #6: caches attached images by content hash, so a Channel Member
// who has already fetched a blob doesn't re-authenticate/re-download it.
const MEDIA_CACHE = "studio-media-v1";
const MEDIA_PATH = /^\/media\/[0-9a-f]{64}(\.\w+)?$/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !MEDIA_PATH.test(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(event.request.url);
      if (cached) return cached;

      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request.url, response.clone());
      return response;
    })(),
  );
});
