import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/** `idb-keyval` in a Map: bun has no IndexedDB, and what these tests ask about is what custody
 * keeps and reads back, not the database underneath. */
const stored = new Map<string, unknown>();
mock.module("idb-keyval", () => ({
  get: async (key: string) => stored.get(key),
  set: async (key: string, value: unknown) => {
    stored.set(key, value);
  },
  del: async (key: string) => {
    stored.delete(key);
  },
}));

import {
  clearIdentity,
  extensionSupportsNip44,
  hasNip07,
  loadChannelReadAt,
  loadIdentityNsec,
  loadDmReadAt,
  storeChannelReadAt,
  storeDmReadAt,
} from "./custody";
import { mediaDownloads } from "./mediaDownloads";
import { cacheBlob, mediaCacheEpoch, mediaCacheName } from "./mediaCache";
import { restoreCaches, stubCaches } from "./testing/cacheStorage";
import { stubNostr } from "./testing/window";

describe("hasNip07", () => {
  afterEach(() => stubNostr(undefined)());

  test("false when window.nostr is absent", () => {
    stubNostr(undefined)();
    expect(hasNip07()).toBe(false);
  });

  test("false when window.nostr is present but null or undefined", () => {
    stubNostr(null);
    expect(hasNip07()).toBe(false);
    stubNostr(undefined);
    expect(hasNip07()).toBe(false);
  });

  test("true when window.nostr is present", () => {
    stubNostr({});
    expect(hasNip07()).toBe(true);
  });
});

describe("extensionSupportsNip44", () => {
  afterEach(() => stubNostr(undefined)());

  const stub = (nostr?: unknown) => {
    if (nostr === undefined) stubNostr(undefined)();
    else stubNostr(nostr);
  };

  test("false with no extension at all", () => {
    stub();
    expect(extensionSupportsNip44()).toBe(false);
  });

  test("false, not a throw, when window.nostr is null", () => {
    stub(null);
    expect(extensionSupportsNip44()).toBe(false);
  });

  test("false when the extension exposes no nip44", () => {
    stub({ getPublicKey() {}, signEvent() {} });
    expect(extensionSupportsNip44()).toBe(false);
  });

  test("false when nip44 is missing either direction", () => {
    stub({ nip44: { encrypt() {} } });
    expect(extensionSupportsNip44()).toBe(false);
    stub({ nip44: { decrypt() {} } });
    expect(extensionSupportsNip44()).toBe(false);
  });

  test("true when nip44 encrypts and decrypts", () => {
    stub({ nip44: { encrypt() {}, decrypt() {} } });
    expect(extensionSupportsNip44()).toBe(true);
  });
});

/** This browser's Direct message read marks (#142). The store is `idb-keyval`, stubbed here
 * because bun has no IndexedDB — what is under test is the round trip, not the database. */
describe("the Direct message read marks", () => {
  beforeEach(() => stored.clear());

  test("are undefined until they are first kept, so the shell can start them at now", async () => {
    expect(await loadDmReadAt()).toBeUndefined();
  });

  test("come back as they were kept", async () => {
    await storeDmReadAt({ since: 100, readAt: { "ana,me": 300 } });
    expect(await loadDmReadAt()).toEqual({ since: 100, readAt: { "ana,me": 300 } });
  });

  test("are kept apart from the Channel ones — reading a DM never reads a Channel", async () => {
    await storeChannelReadAt({ c1: 700 });
    await storeDmReadAt({ since: 100, readAt: {} });
    expect(await loadChannelReadAt()).toEqual({ c1: 700 });
  });
});

describe("loadIdentityNsec", () => {
  afterEach(() => stubNostr(undefined)());

  test("is undefined under a NIP-07 extension, without going near local storage", async () => {
    stubNostr({});
    expect(await loadIdentityNsec()).toBeUndefined();
  });
});

describe("signing out", () => {
  afterEach(restoreCaches);

  test("drops the photo downloads still queued before it wipes, so none re-creates the cache", async () => {
    // Order is the whole point: a queued download cleared only *after* the
    // wipe would still look its Identity's cache up, and looking it up
    // creates it. Nothing of a signed-out Identity may be left here (#39).
    const pubkey = "a".repeat(64);
    const { stores } = stubCaches();
    await cacheBlob(pubkey, "https://studio.test/media/" + "f".repeat(64), new Uint8Array([1]).buffer as ArrayBuffer, "image/png", mediaCacheEpoch());
    let started = false;
    const queued = mediaDownloads.run(0, async () => {
      started = true;
      await cacheBlob(pubkey, "https://studio.test/media/" + "e".repeat(64), new Uint8Array([2]).buffer as ArrayBuffer, "image/png", mediaCacheEpoch());
    });
    queued.result.catch(() => {});

    await clearIdentity();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toBe(false);
    expect(Object.keys(stores)).not.toContain(mediaCacheName(pubkey));
  });

  test("aborts the photo downloads already in flight", async () => {
    // #188 (#182's follow-up): a download that started belongs to the Identity leaving too.
    stubCaches();
    let seen: AbortSignal | undefined;
    const inFlight = mediaDownloads.run(0, (signal) => {
      seen = signal;
      return new Promise<void>(() => {});
    });
    inFlight.result.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    await clearIdentity();

    expect(seen?.aborted).toBe(true);
  });
});
