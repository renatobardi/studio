/**
 * The service worker's media cache (sw.ts), and emptying it.
 *
 * Its own module because both the page and the worker need the name, and the
 * worker must not pull in window-dependent code.
 */

export const MEDIA_CACHE = "studio-media-v1";

/**
 * Empties the cache of Channel attachments and DM photos.
 *
 * Cache Storage is per-origin, not per-account, so signing out has to do
 * this: the next account signing in on this browser was never entitled to
 * what the previous one fetched. Content already delivered is not revocable
 * while the session lives — it is a local cache, not a lease — but it must
 * not outlive the session that earned it (#45).
 */
export async function clearMediaCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete(MEDIA_CACHE);
}
