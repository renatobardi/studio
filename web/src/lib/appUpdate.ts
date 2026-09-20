import type { RegisterSWOptions } from "vite-plugin-pwa/types";

/** What the service worker side says: a new worker is waiting to take over, or one just did. */
export type WorkerSignal = "waiting" | "controllerchange";

/**
 * Whether this page now runs an older version than the one the server has (#203). sw.ts takes
 * over at once (`skipWaiting` + `clients.claim`), so a new version reaches an open page as a
 * change of controller — which is only news for a page an older worker loaded: on a first visit
 * the first worker claiming the page is the version the page already is. A worker still waiting
 * means an older one is in charge, always.
 */
export function offersReload(signal: WorkerSignal, loadedUnderWorker: boolean): boolean {
  return signal === "waiting" || loadedUnderWorker;
}

/** Whether "a new version is available" is showing — raised once, and lowered only by the person
 * dismissing it: only a reload, which they choose, makes the page current. Never reloads by
 * itself: a draft in a composer would go with it. */
export function createUpdateNotice(loadedUnderWorker: boolean) {
  let underWorker = loadedUnderWorker;
  /** A signal that arrived before the registration had said there was a worker here before —
   * `registerSW` imports its own code first, so a worker activating in another tab can claim
   * this page in the meantime. */
  let unexplained: WorkerSignal | null = null;
  let available = false;
  let dismissed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const report = (signal: WorkerSignal): void => {
    if (available) return;
    if (!offersReload(signal, underWorker)) {
      unexplained = signal;
      return;
    }
    available = true;
    notify();
  };
  return {
    /** A worker was already installed when this page loaded, though it is not controlling it:
     * only the registration says so, and it arrives after the page is up (#235). */
    foundWorkerFromBefore(): void {
      underWorker = true;
      if (unexplained !== null) report(unexplained);
    },
    report,
    /** "Not now": hidden for the rest of this page's life — the next page load is current. */
    dismiss(): void {
      dismissed = true;
      notify();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: (): boolean => available && !dismissed,
  };
}

export type UpdateNotice = ReturnType<typeof createUpdateNotice>;

/**
 * Registers the service worker and follows it: a new worker taking over, or one waiting, raises
 * the notice; and coming back into view or into focus asks the server for a newer worker — an
 * installed PWA has no reload button, and without this it would only look again on the next cold
 * start. A check that fails (offline) is dropped: the next one asks again.
 *
 * Whether the page was loaded under a worker is read twice: from `controller`, and again from
 * the registration, which is the only thing that still says so after a forced reload (#235).
 */
export function watchForNewVersion({
  serviceWorker,
  registerSW,
  document,
  window,
}: {
  serviceWorker: { controller: object | null; addEventListener(type: "controllerchange", listener: () => void): void } | undefined;
  registerSW: (options: RegisterSWOptions) => void;
  document: { visibilityState: DocumentVisibilityState; addEventListener(type: "visibilitychange", listener: () => void): void };
  window: { addEventListener(type: "focus", listener: () => void): void };
}): UpdateNotice {
  const notice = createUpdateNotice(Boolean(serviceWorker?.controller));
  serviceWorker?.addEventListener("controllerchange", () => notice.report("controllerchange"));
  registerSW({
    immediate: true,
    onNeedRefresh: () => notice.report("waiting"),
    // Without it, registerSW answers the takeover that follows a waiting worker with
    // window.location.reload() — the reload in the middle of a draft this notice replaces.
    onNeedReload: () => notice.report("waiting"),
    onRegisteredSW: (_url, registration) => {
      // A forced reload (Shift+Reload, DevTools "Bypass for network") leaves `controller` null
      // by spec, whatever is installed — and sw.ts claims the page, so the `waiting` path never
      // runs either. An active worker at registration time is the one that was already here.
      //
      // It cannot tell that worker apart from one this very visit installed, so a second tab
      // opened moments after a first visit may be offered a version it already runs. Erring
      // that way costs a reload nobody needed; erring the other way leaves the old shell in
      // place against new assets, which is what #235 is.
      if (registration?.active) notice.foundWorkerFromBefore();
      const check = () => void registration?.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      window.addEventListener("focus", check);
    },
  });
  return notice;
}
