/** Stubs global fetch with a single call that starts immediately but only resolves when told
 * to — for a test that needs to run code (e.g. pruneMediaCaches) while that fetch is still in
 * flight, to reproduce a race between a cache prune and a late-resolving fetch's own write. */
export function stubControllableFetch(): { started: Promise<void>; resolve: (response: Response) => void } {
  let markStarted!: () => void;
  const started = new Promise<void>((res) => (markStarted = res));
  let resolveFetch!: (response: Response) => void;
  const response = new Promise<Response>((res) => (resolveFetch = res));
  globalThis.fetch = (async () => {
    markStarted();
    return response;
  }) as typeof fetch;
  return { started, resolve: resolveFetch };
}
