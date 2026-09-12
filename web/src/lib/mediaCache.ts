/**
 * The cache of already-fetched media blobs, and emptying it.
 *
 * Cache Storage is per-origin, not per-account, so the cache is split by the
 * Identity that fetched the bytes: one cache per pubkey, and nothing reads a
 * cache that is not its own. Only the signed-in page reaches it — no service
 * worker answers a `/media/…` request ahead of the server's authorization
 * check any more (#39).
 */

const NAME = "studio-media-v1";
const PREFIX = `${NAME}-`;

/** The name of `pubkey`'s own media cache. */
export function mediaCacheName(pubkey: string): string {
  return PREFIX + pubkey;
}

function isMediaCache(name: string): boolean {
  // `NAME` with no pubkey is the origin-wide cache this replaced: left by an
  // older build of the app, and nobody's to read.
  return name.startsWith(PREFIX) || name === NAME;
}

export interface CachedBlob {
  bytes: ArrayBuffer;
  contentType: string;
}

/** What this Identity already fetched from `url`, if anything. The caller still verifies its
 * sha256: a cache hit is a download that happened earlier, not one that is trusted more. */
export async function readCachedBlob(pubkey: string, url: string): Promise<CachedBlob | undefined> {
  if (typeof caches === "undefined") return undefined;
  const cache = await caches.open(mediaCacheName(pubkey));
  const response = await cache.match(url);
  if (!response) return undefined;
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") ?? "" };
}

/** Keeps `bytes` for this Identity, keyed by the content-hash URL they came from (#6). For a
 * Direct Message photo these are the ciphertext bytes — the plaintext never reaches the cache. */
export async function cacheBlob(pubkey: string, url: string, bytes: ArrayBuffer, contentType: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(mediaCacheName(pubkey));
    await cache.put(url, new Response(bytes, { headers: { "content-type": contentType } }));
  } catch {
    // A full quota costs the next view a download; it must not fail this one.
    // Failing to *delete* is the opposite — see pruneMediaCaches.
  }
}

/**
 * Deletes every media cache except `keep`'s — all of them when nobody is signed in.
 *
 * Run on sign-out, and again whenever an Identity takes over this browser: the
 * next account signing in was never entitled to what the previous one fetched,
 * and an Identity that never signed out cleanly leaves its cache behind.
 *
 * Throws when a cache survives the attempt: the bytes are still readable on
 * this device, and sign-out must not report a cleanup it did not get.
 */
export async function pruneMediaCaches(keep: string | null): Promise<void> {
  if (typeof caches === "undefined") return;
  const kept = keep === null ? null : mediaCacheName(keep);
  const failed: string[] = [];
  for (const name of await caches.keys()) {
    if (!isMediaCache(name) || name === kept) continue;
    try {
      await caches.delete(name);
    } catch {
      failed.push(name);
    }
  }
  if (failed.length > 0) throw new Error(`Couldn't remove cached media from this browser (${failed.join(", ")}).`);
}
