/**
 * A Cache Storage stub for tests running outside a browser (bun), covering
 * only what `mediaCache.ts` uses: keys, delete, open → match/put.
 */
interface StubEntry {
  bytes: ArrayBuffer;
  contentType: string;
}

export interface CacheStorageStub {
  stores: Record<string, Record<string, StubEntry>>;
  failDeleteOf: (name: string) => void;
}

export function stubCaches(): CacheStorageStub {
  const stores: Record<string, Record<string, StubEntry>> = {};
  const failing = new Set<string>();
  const api = {
    async keys() {
      return Object.keys(stores);
    },
    async delete(name: string) {
      if (failing.has(name)) throw new Error("quota");
      const existed = name in stores;
      delete stores[name];
      return existed;
    },
    async open(name: string) {
      stores[name] ??= {};
      const store = stores[name];
      return {
        async match(url: string) {
          const entry = store[url];
          return entry === undefined
            ? undefined
            : new Response(entry.bytes, { headers: { "content-type": entry.contentType } });
        },
        async put(url: string, response: Response) {
          store[url] = { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") ?? "" };
        },
      };
    },
  };
  // @ts-expect-error minimal CacheStorage stub
  globalThis.caches = api;
  return { stores, failDeleteOf: (name: string) => failing.add(name) };
}

export function restoreCaches(): void {
  // @ts-expect-error test-only cleanup of the global stubbed above
  delete globalThis.caches;
}
