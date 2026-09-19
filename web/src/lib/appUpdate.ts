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

/** Whether "a new version is available" is showing — raised once, never lowered: only a reload,
 * which the person chooses, makes the page current. Never reloads by itself: a draft in a
 * composer would go with it. */
export function createUpdateNotice(loadedUnderWorker: boolean) {
  let available = false;
  const listeners = new Set<() => void>();
  return {
    report(signal: WorkerSignal): void {
      if (available || !offersReload(signal, loadedUnderWorker)) return;
      available = true;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: (): boolean => available,
  };
}

export type UpdateNotice = ReturnType<typeof createUpdateNotice>;

/**
 * Registers the service worker and follows it: a new worker taking over, or one waiting, raises
 * the notice; and coming back into view asks the server for a newer worker — an installed PWA has
 * no reload button, and without this it would only look again on the next cold start.
 */
export function watchForNewVersion({
  serviceWorker,
  registerSW,
  document,
}: {
  serviceWorker: { controller: object | null; addEventListener(type: "controllerchange", listener: () => void): void } | undefined;
  registerSW: (options: RegisterSWOptions) => void;
  document: { visibilityState: DocumentVisibilityState; addEventListener(type: "visibilitychange", listener: () => void): void };
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
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration?.update();
      });
    },
  });
  return notice;
}
