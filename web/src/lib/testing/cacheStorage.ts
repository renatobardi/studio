/**
 * A Cache Storage stub for tests running outside a browser (bun), covering
 * only what `mediaCache.ts` uses: keys, has, delete, open → match/put.
 */
interface StubEntry {
  bytes: ArrayBuffer;
  contentType: string;
}

export interface CacheStorageStub {
  stores: Record<string, Record<string, StubEntry>>;
  failDeleteOf: (name: string) => void;
  /** Holds every `open` until the returned release is called — the window a
   * prune can run in while an open is still on its way. */
  holdOpens: () => () => void;
  /** The same for `keys`, which is where a prune pauses before it starts deleting. */
  holdKeys: () => () => void;
  /** Holds only the *first* delete of `name`, so a second prune can overtake the first one
   * half way through its wipe. */
  holdFirstDeleteOf: (name: string) => () => void;
}

export function stubCaches(): CacheStorageStub {
  const stores: Record<string, Record<string, StubEntry>> = {};
  const failing = new Set<string>();
  let held: Promise<void> = Promise.resolve();
  let heldKeys: Promise<void> = Promise.resolve();
  const heldDeletes = new Map<string, Promise<void>>();
  const api = {
    async keys() {
      await heldKeys;
      return Object.keys(stores);
    },
    async has(name: string) {
      return name in stores;
    },
    async delete(name: string) {
      const holding = heldDeletes.get(name);
      if (holding) {
        heldDeletes.delete(name);
        await holding;
      }
      if (failing.has(name)) throw new Error("quota");
      const existed = name in stores;
      delete stores[name];
      return existed;
    },
    async open(name: string) {
      await held;
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
  return {
    stores,
    failDeleteOf: (name: string) => failing.add(name),
    holdOpens: () => {
      let release!: () => void;
      held = new Promise((resolve) => (release = resolve));
      return release;
    },
    holdKeys: () => {
      let release!: () => void;
      heldKeys = new Promise((resolve) => (release = resolve));
      return release;
    },
    holdFirstDeleteOf: (name: string) => {
      let release!: () => void;
      heldDeletes.set(name, new Promise((resolve) => (release = resolve)));
      return release;
    },
  };
}

export function restoreCaches(): void {
  // @ts-expect-error test-only cleanup of the global stubbed above
  delete globalThis.caches;
}
