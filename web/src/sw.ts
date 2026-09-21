/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;
/** Which build this worker was made from — `define` in vite.config.ts, the same value the page
 * carries. */
declare const __STUDIO_BUILD__: string;

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

// A page this worker has just taken over asks which build it serves, to tell a deploy apart
// from its own visit's worker (#259). Answered on the port the page sent, so nothing else it
// hears can be mistaken for the answer. The question is `WHICH_BUILD` in lib/appUpdate.ts,
// which this file cannot import: it type-checks against the worker's lib, not the DOM's.
self.addEventListener("message", (event) => {
  if (event.data?.type === "studio:which-build") event.ports[0]?.postMessage(__STUDIO_BUILD__);
});
