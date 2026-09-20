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

let epoch = 0;

/** For a cache name a prune was told to keep: the epoch before the current unbroken run of
 * prunes that kept it, and the epoch of the last one. A prune bumps the epoch for everybody, so
 * without these a prune that kept an Identity would read, to that Identity's own in-flight
 * read or write, exactly like one that wiped it (#236). */
const keptSince = new Map<string, number>();
const keptUntil = new Map<string, number>();

/** Bumped by every `pruneMediaCaches` call. A write captured under an older
 * epoch is stale — a prune ran while its fetch was still in flight, and
 * writing it back would resurrect a cache sign-out (or the next boot's
 * reconciliation) just wiped. See fetchBlobObjectUrl / downloadCiphertext. */
export function mediaCacheEpoch(): number {
  return epoch;
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
 * sha256: a cache hit is a download that happened earlier, not one that is trusted more.
 *
 * Asks whether the cache exists before opening it — `caches.open` creates what it does not
 * find, so a lookup that lands after sign-out would re-create the very cache the wipe just
 * removed, under the pubkey of an Identity no longer here (#39). A prune can still land between
 * the two, so the open is checked against the epoch too (#187). */
export async function readCachedBlob(pubkey: string, url: string): Promise<CachedBlob | undefined> {
  if (typeof caches === "undefined") return undefined;
  const name = mediaCacheName(pubkey);
  const epochAtStart = epoch;
  if (!(await caches.has(name))) return undefined;
  const cache = await openUnlessPruned(name, epochAtStart);
  if (!cache) return undefined;
  const response = await cache.match(url);
  if (!response) return undefined;
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") ?? "" };
}

/** `caches.open`, unless a prune ran since `epochAtStart`: then the cache the open may have just
 * re-created is deleted again, and nothing is returned (#187). A prune that lands after the check,
 * while the caller still holds the returned cache, is harmless: `caches.delete` unlinks the name,
 * and a `put` into the orphaned cache never brings it back. */
async function openUnlessPruned(name: string, epochAtStart: number): Promise<Cache | undefined> {
  const cache = await caches.open(name);
  if (!prunedSince(name, epochAtStart)) return cache;
  await caches.delete(name);
  return undefined;
}

/** Whether any prune since `epochAtStart` would have removed this cache — that is, any of them
 * that was not told to keep it. */
function prunedSince(name: string, epochAtStart: number): boolean {
  if (epoch === epochAtStart) return false;
  return keptUntil.get(name) !== epoch || (keptSince.get(name) ?? Infinity) > epochAtStart;
}

/** Keeps `bytes` for this Identity, keyed by the content-hash URL they came from (#6). For a
 * Direct Message photo these are the ciphertext bytes — the plaintext never reaches the cache.
 * `epochAtFetchStart` is `mediaCacheEpoch()` from before the bytes were fetched: if a prune ran
 * since, nothing is written (#187). */
export async function cacheBlob(
  pubkey: string,
  url: string,
  bytes: ArrayBuffer,
  contentType: string,
  epochAtFetchStart: number,
): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await openUnlessPruned(mediaCacheName(pubkey), epochAtFetchStart);
    await cache?.put(url, new Response(bytes, { headers: { "content-type": contentType } }));
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
  const before = epoch;
  epoch += 1;
  if (keep !== null) {
    const name = mediaCacheName(keep);
    // A run of prunes that all kept it starts where the previous one left off.
    if (keptUntil.get(name) !== before) keptSince.set(name, before);
    keptUntil.set(name, epoch);
  }
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
