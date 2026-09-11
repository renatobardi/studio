import { afterEach, describe, expect, test } from "bun:test";
import { clearMediaCache, MEDIA_CACHE } from "./mediaCache";

describe("clearMediaCache", () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of globals stubbed below
    delete globalThis.caches;
  });

  test("deletes the cached media of the account signing out", async () => {
    // Ticket #45: the media cache is per-origin, so without this a photo
    // already delivered to one account stays readable to the next person
    // signing in on the same browser.
    const deleted: string[] = [];
    // @ts-expect-error minimal CacheStorage stub
    globalThis.caches = {
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    };

    await clearMediaCache();

    expect(deleted).toEqual([MEDIA_CACHE]);
  });

  test("signing out works in a browser with no Cache Storage", async () => {
    await clearMediaCache(); // must not throw
  });
});
