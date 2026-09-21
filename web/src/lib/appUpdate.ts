import type { RegisterSWOptions } from "vite-plugin-pwa/types";

/** As much of a service worker as this module talks to: it is asked one question. */
export interface WorkerPort {
  postMessage(message: unknown, transfer: MessagePort[]): void;
}

/**
 * Whether a worker's answer names this very build. No answer is not this build: every worker
 * shipped before #259 ignores the question, and those are older builds by definition — the case
 * the notice exists for (#235).
 */
export function servesThisBuild(answer: string | null, thisBuild: string): boolean {
  return answer === thisBuild;
}

/** The question sw.ts answers with the build it was made from — the same literal lives there,
 * which cannot import this file (it type-checks against the worker's lib, not the DOM's). */
export const WHICH_BUILD = { type: "studio:which-build" } as const;

/** How long a page waits for a worker to say which build it serves: a message inside the same
 * browser, so long enough for one that answers, and short enough that one too old to answer does
 * not hold the notice back. */
const BUILD_ANSWER_MS = 1_000;

/**
 * Asks `worker` which build it serves, on a port of its own so the answer cannot be mistaken for
 * any other message. Resolves `null` when there is no answer — after `timeoutMs`, since a worker
 * from before #259 never answers, or at once when the worker cannot be written to at all. Never
 * rejects: the caller decides on the answer, and "no answer" is one.
 */
export function askWorkerBuild(worker: WorkerPort, timeoutMs: number = BUILD_ANSWER_MS): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const settle = (answer: string | null) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(answer);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => settle(typeof event.data === "string" ? event.data : null);
    try {
      worker.postMessage(WHICH_BUILD, [channel.port2]);
    } catch {
      // A worker that went redundant between taking over and this question.
      settle(null);
    }
  });
}

/** Whether "a new version is available" is showing — raised once, and lowered only by the person
 * dismissing it: only a reload, which they choose, makes the page current. Never reloads by
 * itself: a draft in a composer would go with it. */
export function createUpdateNotice() {
  let available = false;
  let dismissed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    /** A newer version is there. Raised once; saying it again changes nothing. */
    report(): void {
      if (available) return;
      available = true;
      notify();
    },
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
 * Registers the service worker and follows it (#203).
 *
 * A worker waiting to take over always means a newer version. A worker that has just taken over
 * means one only when it serves another build than this page's (#259). sw.ts takes over at once
 * (`skipWaiting` + `clients.claim`), so a takeover also happens on a first install, and on a
 * second tab opened while the first visit's worker was activating — neither of which is news —
 * and after a forced reload, which leaves the page uncontrolled by spec however long a worker has
 * been installed, and whose next deploy is (#235). Inferring which case this is from the page's
 * own state got one of them wrong whichever way it leaned; asking the worker that now controls
 * the page gets all three right.
 *
 * Coming back into view or into focus asks the server for a newer worker — an installed PWA has
 * no reload button, and without this it would only look again on the next cold start. A check
 * that fails (offline) is dropped: the next one asks again.
 */
export function watchForNewVersion({
  build,
  askBuild,
  serviceWorker,
  registerSW,
  document,
  window,
}: {
  build: string;
  askBuild: (worker: WorkerPort) => Promise<string | null>;
  serviceWorker:
    | { controller: WorkerPort | null; addEventListener(type: "controllerchange", listener: () => void): void }
    | undefined;
  registerSW: (options: RegisterSWOptions) => void;
  document: { visibilityState: DocumentVisibilityState; addEventListener(type: "visibilitychange", listener: () => void): void };
  window: { addEventListener(type: "focus", listener: () => void): void };
}): UpdateNotice {
  const notice = createUpdateNotice();
  serviceWorker?.addEventListener("controllerchange", () => {
    const controller = serviceWorker.controller;
    if (!controller) return;
    void askBuild(controller).then((answer) => {
      if (!servesThisBuild(answer, build)) notice.report();
    });
  });
  registerSW({
    immediate: true,
    onNeedRefresh: () => notice.report(),
    // Without it, registerSW answers the takeover that follows a waiting worker with
    // window.location.reload() — the reload in the middle of a draft this notice replaces.
    onNeedReload: () => notice.report(),
    onRegisteredSW: (_url, registration) => {
      const check = () => void registration?.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      window.addEventListener("focus", check);
    },
  });
  return notice;
}
