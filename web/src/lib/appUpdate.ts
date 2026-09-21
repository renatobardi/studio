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
 * Whether a worker's answer names this very build. Anything else — another build, or no answer
 * at all — is not this one: every worker shipped before #259 ignores the question, and those are
 * older builds by definition, the case the notice exists for (#235).
 */
export function servesThisBuild(answer: unknown, thisBuild: string): boolean {
  return typeof answer === "string" && answer === thisBuild;
}

/** The question sw.ts answers with the build it was made from (#259). */
export const WHICH_BUILD = { type: "studio:which-build" } as const;

/** How long a page waits for a worker to say which build it serves: a message inside the same
 * browser, so long enough for one that answers, and short enough that one too old to answer
 * does not hold the notice back. */
export const BUILD_ANSWER_MS = 1_000;

/**
 * Asks `worker` which build it serves, on a port of its own so the answer cannot be mistaken for
 * any other message. Gives up with `null` after `timeoutMs` — a worker from before #259 never
 * answers, and waiting on it for good would keep the notice from ever deciding.
 */
export function askWorkerBuild(
  worker: { postMessage(message: unknown, transfer: MessagePort[]): void },
  timeoutMs: number = BUILD_ANSWER_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const settle = (answer: string | null) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(answer);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => settle(typeof event.data === "string" ? event.data : null);
    worker.postMessage(WHICH_BUILD, [channel.port2]);
  });
}

/**
 * Registers the service worker and follows it: a new worker taking over, or one waiting, raises
 * the notice; and coming back into view or into focus asks the server for a newer worker — an
 * installed PWA has no reload button, and without this it would only look again on the next cold
 * start. A check that fails (offline) is dropped: the next one asks again.
 *
 * Whether the page was loaded under a worker is read twice: from `controller`, and again from
 * the registration, which is the only thing that still says so after a forced reload (#235) —
 * and then only once that worker says it serves another build than `build` (#259).
 */
export function watchForNewVersion({
  build,
  askWorkerBuild: ask,
  serviceWorker,
  registerSW,
  document,
  window,
}: {
  build: string;
  askWorkerBuild: (worker: ServiceWorker) => Promise<string | null>;
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
    onRegisteredSW: async (_url, registration) => {
      const check = () => void registration?.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      window.addEventListener("focus", check);

      // A forced reload (Shift+Reload, DevTools "Bypass for network") leaves `controller` null
      // by spec, whatever is installed — and sw.ts claims the page, so the `waiting` path never
      // runs either. An active worker at registration time may be the one that was already
      // here (#235) — or the one this very visit installed, which a second tab opened moments
      // after the first finds just the same. Only the worker can say which: it is asked for the
      // build it serves, and only another build is news (#259).
      const active = registration?.active;
      if (active && !servesThisBuild(await ask(active), build)) notice.foundWorkerFromBefore();
    },
  });
  return notice;
}
