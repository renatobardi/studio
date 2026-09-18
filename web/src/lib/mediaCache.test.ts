import { afterEach, describe, expect, test } from "bun:test";
import { cacheBlob, mediaCacheEpoch, mediaCacheName, pruneMediaCaches, readCachedBlob } from "./mediaCache";
import { restoreCaches, stubCaches } from "./testing/cacheStorage";

const bytesOf = (...values: number[]) => new Uint8Array(values).buffer as ArrayBuffer;

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);
const URL_ = "https://studio.test/media/" + "f".repeat(64);

describe("the media cache", () => {
  afterEach(restoreCaches);

  test("gives back to the same Identity what it cached, hash key and all", async () => {
    stubCaches();

    await cacheBlob(PUBKEY_A, URL_, bytesOf(1, 2, 3), "image/png");
    const cached = await readCachedBlob(PUBKEY_A, URL_);

    expect(cached && new Uint8Array(cached.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(cached?.contentType).toBe("image/png");
  });

  test("never answers another Identity out of the same browser's cache", async () => {
    // Ticket #39: Cache Storage is per-origin. Keyed by URL alone, a blob A
    // was entitled to would answer B's fetch before the server ever decided
    // whether B may read it.
    stubCaches();

    await cacheBlob(PUBKEY_A, URL_, bytesOf(1, 2, 3), "image/png");

    expect(await readCachedBlob(PUBKEY_B, URL_)).toBeUndefined();
  });

  test("a browser with no Cache Storage neither caches nor reads", async () => {
    await cacheBlob(PUBKEY_A, URL_, bytesOf(1), "image/png"); // must not throw
    expect(await readCachedBlob(PUBKEY_A, URL_)).toBeUndefined();
  });

  test("pruning keeps the signed-in Identity's cache and drops every other", async () => {
    // The leftovers of an Identity that never signed out cleanly — closed tab,
    // failed cleanup — must not survive the next sign-in.
    const { stores } = stubCaches();
    await cacheBlob(PUBKEY_A, URL_, bytesOf(1), "image/png");
    await cacheBlob(PUBKEY_B, URL_, bytesOf(2), "image/png");
    stores["studio-media-v1"] = {}; // the origin-wide cache this replaces

    await pruneMediaCaches(PUBKEY_A);

    expect(Object.keys(stores)).toEqual([mediaCacheName(PUBKEY_A)]);
  });

  test("pruning to no Identity empties every media cache, and leaves the app shell alone", async () => {
    const { stores } = stubCaches();
    await cacheBlob(PUBKEY_A, URL_, bytesOf(1), "image/png");
    stores["workbox-precache-v2"] = {};

    await pruneMediaCaches(null);

    expect(Object.keys(stores)).toEqual(["workbox-precache-v2"]);
  });

  test("a cache that cannot be deleted is reported, not passed off as cleaned", async () => {
    // Sign-out must not claim success it did not get: the bytes are still there.
    const { failDeleteOf } = stubCaches();
    await cacheBlob(PUBKEY_A, URL_, bytesOf(1), "image/png");
    failDeleteOf(mediaCacheName(PUBKEY_A));

    await expect(pruneMediaCaches(null)).rejects.toThrow(/cached media/i);
  });

  test("a read after the wipe does not bring the signed-out Identity's cache back", async () => {
    // `caches.open` creates the cache it does not find. A photo download that
    // only reaches its cache lookup after sign-out would re-create
    // `studio-media-v1-<the pubkey that just left>` — empty, but present, and
    // sign-out promised nothing of that Identity would be left here (#39).
    const { stores } = stubCaches();
    await cacheBlob(PUBKEY_A, URL_, bytesOf(1), "image/png");
    await pruneMediaCaches(null);

    expect(await readCachedBlob(PUBKEY_A, URL_)).toBeUndefined();
    expect(Object.keys(stores)).toEqual([]);
  });

  test("pruning bumps the epoch, so a write still in flight can tell a prune ran", async () => {
    // media.ts/dmMedia.ts capture the epoch before their fetch and skip caching if it moved on —
    // pruning is what invalidates them, so it must actually move the counter every time it runs.
    stubCaches();

    const before = mediaCacheEpoch();
    await pruneMediaCaches(null);
    const afterFirst = mediaCacheEpoch();
    await pruneMediaCaches(PUBKEY_A);
    const afterSecond = mediaCacheEpoch();

    expect(afterFirst).toBeGreaterThan(before);
    expect(afterSecond).toBeGreaterThan(afterFirst);
  });
});
