import { describe, expect, test } from "bun:test";
import { askWorkerBuild, createUpdateNotice, servesThisBuild, watchForNewVersion, type WorkerPort } from "./appUpdate";

/** A page keeps running the shell it was loaded with; after a deploy the new worker installs
 * behind it (`skipWaiting` + `clients.claim` in sw.ts), so the page has to say a newer version is
 * there — never reload by itself, a draft in a composer would go with it (#203). */
describe("createUpdateNotice", () => {
  test("stays quiet until told there is a newer version, and tells its listeners once", () => {
    const notice = createUpdateNotice();
    let heard = 0;
    notice.subscribe(() => (heard += 1));
    expect(notice.getSnapshot()).toBe(false);
    notice.report();
    notice.report();
    expect(notice.getSnapshot()).toBe(true);
    expect(heard).toBe(1);
  });

  test("dismissing hides it for the rest of this page's life, and tells the listeners", () => {
    const notice = createUpdateNotice();
    let heard = 0;
    notice.subscribe(() => (heard += 1));
    notice.report();
    notice.dismiss();
    notice.report();
    expect(notice.getSnapshot()).toBe(false);
    expect(heard).toBe(2);
  });

  test("a listener that unsubscribed hears nothing", () => {
    const notice = createUpdateNotice();
    let heard = 0;
    notice.subscribe(() => (heard += 1))();
    notice.report();
    expect(heard).toBe(0);
  });
});

describe("watchForNewVersion", () => {
  const THIS_BUILD = "build-2";
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** A worker that serves `build` — or, with `null`, one from before #259 that never answers. */
  type FakeWorker = WorkerPort & { build: string | null };
  const workerServing = (build: string | null): FakeWorker => ({ build, postMessage: () => {} });

  function harness(controller: FakeWorker | null) {
    const listeners = new Map<string, () => void>();
    const documentListeners = new Map<string, () => void>();
    const windowListeners = new Map<string, () => void>();
    let options: Parameters<Parameters<typeof watchForNewVersion>[0]["registerSW"]>[0] | null = null;
    let updates = 0;
    const doc = {
      visibilityState: "hidden" as DocumentVisibilityState,
      addEventListener: (type: string, listener: () => void) => documentListeners.set(type, listener),
    };
    const serviceWorker = {
      controller,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    };
    const notice = watchForNewVersion({
      build: THIS_BUILD,
      askBuild: async (worker) => (worker === serviceWorker.controller ? serviceWorker.controller.build : null),
      serviceWorker,
      registerSW: (given) => {
        options = given;
      },
      document: doc,
      window: { addEventListener: (type: string, listener: () => void) => windowListeners.set(type, listener) },
    });
    const registration = { update: async () => void (updates += 1) } as unknown as ServiceWorkerRegistration;
    /** Another worker — or none — takes the page over, and the page hears of it. */
    const takeOver = async (by: FakeWorker | null) => {
      serviceWorker.controller = by;
      listeners.get("controllerchange")!();
      await settled();
    };
    return { notice, takeOver, documentListeners, windowListeners, options: () => options!, doc, registration, updates: () => updates };
  }

  test("registers the worker at once, as main.tsx did", () => {
    expect(harness(null).options().immediate).toBe(true);
  });

  test("a deploy's worker taking over a page an older one loaded raises the notice", async () => {
    const { notice, takeOver } = harness(workerServing("build-1"));
    await takeOver(workerServing("build-3"));
    expect(notice.getSnapshot()).toBe(true);
  });

  test("a first install claiming the page it was installed from says nothing (#203)", async () => {
    const { notice, takeOver } = harness(null);
    await takeOver(workerServing(THIS_BUILD));
    expect(notice.getSnapshot()).toBe(false);
  });

  test("a second tab of the same visit is not told there is a new version (#259)", async () => {
    // The first visit's worker was still activating when this tab opened, so the tab loaded
    // uncontrolled and was then claimed by it. That worker serves the build this tab already
    // runs: going by "an active worker was found" offered a reload of the version on screen.
    const { notice, takeOver } = harness(null);
    await takeOver(workerServing(THIS_BUILD));
    expect(notice.getSnapshot()).toBe(false);
  });

  test("a forced reload on the current build still hears the next deploy (#235)", async () => {
    // Shift+Reload loads the page uncontrolled by spec, however long a worker has been
    // installed, so the page's own state cannot say it was loaded under one. Asking the worker
    // that takes over is what does — the first attempt at #259 asked the active worker at
    // registration instead, heard "same build" here exactly as in a second tab, and lost this.
    const { notice, takeOver } = harness(null);
    await takeOver(workerServing("build-3"));
    expect(notice.getSnapshot()).toBe(true);
  });

  test("a worker too old to answer is an older version, and raises it", async () => {
    // Every worker shipped before #259 ignores the question; silence is the answer of exactly
    // the builds the notice exists for.
    const { notice, takeOver } = harness(null);
    await takeOver(workerServing(null));
    expect(notice.getSnapshot()).toBe(true);
  });

  test("losing the controller altogether is nobody new to ask about", async () => {
    const { notice, takeOver } = harness(workerServing(THIS_BUILD));
    await takeOver(null);
    expect(notice.getSnapshot()).toBe(false);
  });

  test("a waiting worker raises it", () => {
    const { notice, options } = harness(null);
    options().onNeedRefresh!();
    expect(notice.getSnapshot()).toBe(true);
  });

  test("a waiting worker taking over raises the notice instead of reloading the page", () => {
    // In 'prompt' mode registerSW answers the takeover that follows a waiting worker with
    // window.location.reload() — unless it is given onNeedReload (vite-plugin-pwa's register.js).
    const { notice, options } = harness(null);
    expect(options().onNeedReload).toBeInstanceOf(Function);
    options().onNeedReload!();
    expect(notice.getSnapshot()).toBe(true);
  });

  test("coming back into view asks the server for a newer worker — an installed PWA has no reload button", () => {
    const { options, documentListeners, doc, registration, updates } = harness(workerServing(THIS_BUILD));
    options().onRegisteredSW!("/sw.js", registration);
    documentListeners.get("visibilitychange")!();
    expect(updates()).toBe(0);
    doc.visibilityState = "visible";
    documentListeners.get("visibilitychange")!();
    expect(updates()).toBe(1);
  });

  test("so does the window regaining focus — a desktop PWA switched back to never changes visibility", () => {
    const { options, windowListeners, registration, updates } = harness(workerServing(THIS_BUILD));
    options().onRegisteredSW!("/sw.js", registration);
    windowListeners.get("focus")!();
    expect(updates()).toBe(1);
  });

  test("a check that fails offline is dropped quietly, not left as an unhandled rejection", async () => {
    const { options, windowListeners } = harness(workerServing(THIS_BUILD));
    let asked = 0;
    const offline = { update: () => (asked += 1, Promise.reject(new Error("offline"))) } as unknown as ServiceWorkerRegistration;
    options().onRegisteredSW!("/sw.js", offline);
    windowListeners.get("focus")!();
    await settled();
    expect(asked).toBe(1);
  });

  test("works where the browser has no service worker at all", () => {
    const notice = watchForNewVersion({
      build: THIS_BUILD,
      askBuild: async () => null,
      serviceWorker: undefined,
      registerSW: () => {},
      document: { visibilityState: "visible", addEventListener: () => {} },
      window: { addEventListener: () => {} },
    });
    expect(notice.getSnapshot()).toBe(false);
  });
});

describe("servesThisBuild", () => {
  test("only the very same build counts as this one", () => {
    expect(servesThisBuild("abc", "abc")).toBe(true);
    expect(servesThisBuild("abc", "def")).toBe(false);
  });

  test("no answer is not this build — the workers that give none are the older ones", () => {
    expect(servesThisBuild(null, "abc")).toBe(false);
  });
});

describe("askWorkerBuild", () => {
  test("hands the worker a port and gives back what it answers", async () => {
    const worker = {
      postMessage: (message: unknown, transfer: MessagePort[]) => {
        expect(message).toEqual({ type: "studio:which-build" });
        transfer[0]!.postMessage("build-7");
      },
    };
    expect(await askWorkerBuild(worker, 50)).toBe("build-7");
  });

  test("gives up on a worker that never answers, rather than waiting on it forever", async () => {
    expect(await askWorkerBuild({ postMessage: () => {} }, 10)).toBeNull();
  });

  test("a worker that cannot be written to is no answer, not a rejection", async () => {
    const gone = {
      postMessage: () => {
        throw new Error("InvalidStateError");
      },
    };
    expect(await askWorkerBuild(gone, 1_000)).toBeNull();
  });
});
