/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// App shell (issue #8): precache the build's own JS/CSS/HTML so the app still opens offline.
// self.__WB_MANIFEST is injected by vite-plugin-pwa's injectManifest strategy at build time.
precacheAndRoute(self.__WB_MANIFEST);

// No `/media/…` route lives here any more (#39). A worker answering by URL had no idea who was
// asking: it replied ahead of the server's authorization check, and across accounts sharing the
// browser. Media is cached by the signed-in page instead, in that Identity's own cache — see
// lib/mediaCache.ts.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
