import { describe, expect, test } from "bun:test";
import {
  askWorkerBuild,
  createUpdateNotice,
  offersReload,
  servesThisBuild,
  watchForNewVersion,
} from "./appUpdate";

/** A page keeps running the shell it was loaded with; after a deploy the new worker installs
 * behind it (`skipWaiting` + `clients.claim` in sw.ts), so the page has to say a newer version is
 * there — never reload by itself, a draft in a composer would go with it (#203). */
describe("offersReload", () => {
  test("a new worker taking over a page an older one loaded means the page is out of date", () => {
    expect(offersReload("controllerchange", true)).toBe(true);
  });

  test("the first worker ever claiming the page is not a new version — the page is the current one", () => {
    expect(offersReload("controllerchange", false)).toBe(false);
  });

  test("a worker waiting to take over always is", () => {
    expect(offersReload("waiting", false)).toBe(true);
    expect(offersReload("waiting", true)).toBe(true);
  });
});

describe("createUpdateNotice", () => {
  test("stays quiet until a signal says there is a newer version, and tells its listeners once", () => {
    const notice = createUpdateNotice(true);
    let heard = 0;
    notice.subscribe(() => (heard += 1));
    expect(notice.getSnapshot()).toBe(false);
    notice.report("controllerchange");
    notice.report("waiting");
    expect(notice.getSnapshot()).toBe(true);
    expect(heard).toBe(1);
  });

  test("a worker found from before this page turns a claim it had shrugged off into news", () => {
    const notice = createUpdateNotice(false);
    notice.report("controllerchange");
    expect(notice.getSnapshot()).toBe(false);
    notice.foundWorkerFromBefore();
    expect(notice.getSnapshot()).toBe(true);
  });

  test("ignores a first install claiming the page", () => {
    const notice = createUpdateNotice(false);
    notice.report("controllerchange");
    expect(notice.getSnapshot()).toBe(false);
  });

  test("dismissing hides it for the rest of this page's life, and tells the listeners", () => {
    const notice = createUpdateNotice(true);
    let heard = 0;
    notice.subscribe(() => (heard += 1));
    notice.report("waiting");
    notice.dismiss();
    notice.report("controllerchange");
    expect(notice.getSnapshot()).toBe(false);
    expect(heard).toBe(2);
  });

  test("a listener that unsubscribed hears nothing", () => {
    const notice = createUpdateNotice(true);
    let heard = 0;
    notice.subscribe(() => (heard += 1))();
    notice.report("waiting");
    expect(heard).toBe(0);
  });
});

describe("watchForNewVersion", () => {
  const THIS_BUILD = "build-2";

  function harness(controller: object | null, active: object | null = null, workerBuild: string | null = null) {
    const listeners = new Map<string, () => void>();
    const documentListeners = new Map<string, () => void>();
    const windowListeners = new Map<string, () => void>();
    let options: Parameters<Parameters<typeof watchForNewVersion>[0]["registerSW"]>[0] | null = null;
    let updates = 0;
    const doc = {
      visibilityState: "hidden" as DocumentVisibilityState,
      addEventListener: (type: string, listener: () => void) => documentListeners.set(type, listener),
    };
    let asked = 0;
    const notice = watchForNewVersion({
      build: THIS_BUILD,
      askWorkerBuild: async () => {
        asked += 1;
        return workerBuild;
      },
      serviceWorker: { controller, addEventListener: (type: string, listener: () => void) => listeners.set(type, listener) },
      registerSW: (given) => {
        options = given;
      },
      document: doc,
      window: { addEventListener: (type: string, listener: () => void) => windowListeners.set(type, listener) },
    });
    const registration = { active, update: async () => void (updates += 1) } as unknown as ServiceWorkerRegistration;
    return {
      notice,
      listeners,
      documentListeners,
      windowListeners,
      options: () => options!,
      doc,
      registration,
      updates: () => updates,
      asked: () => asked,
    };
  }

  test("registers the worker at once, as main.tsx did", () => {
    expect(harness({}).options().immediate).toBe(true);
  });

  test("a new worker taking over a page loaded under an older one raises the notice", () => {
    const { notice, listeners } = harness({});
    listeners.get("controllerchange")!();
    expect(notice.getSnapshot()).toBe(true);
  });

  test("the first install on a page no worker loaded does not", () => {
    const { notice, listeners } = harness(null);
    listeners.get("controllerchange")!();
    expect(notice.getSnapshot()).toBe(false);
  });

  test("a forced reload leaves no controller, and the worker already installed still counts", async () => {
    // Shift+Reload loads the page uncontrolled by spec, however long a worker has been
    // installed. Going by `controller` alone, the next deploy arrived as a controllerchange on
    // a page that looked brand new, and nothing was offered (#235).
    const { notice, listeners, options, registration } = harness(null, {}, "build-1");
    await options().onRegisteredSW?.("/sw.js", registration);
    listeners.get("controllerchange")!();
    expect(notice.getSnapshot()).toBe(true);
  });

  test("a worker that claimed the page before the registration answered is not lost", async () => {
    // `registerSW` imports its own code before it registers, and a worker activating in another
    // tab can claim this page inside that window.
    const { notice, listeners, options, registration } = harness(null, {}, "build-1");
    listeners.get("controllerchange")!();
    expect(notice.getSnapshot()).toBe(false);
    await options().onRegisteredSW?.("/sw.js", registration);
    expect(notice.getSnapshot()).toBe(true);
  });

  test("a first install has no active worker to find, and still says nothing", () => {
    const { notice, listeners, options, registration } = harness(null);
    options().onRegisteredSW?.("/sw.js", registration);
    listeners.get("controllerchange")!();
    expect(notice.getSnapshot()).toBe(false);
  });

  test("a second tab of the same visit is not told there is a new version (#259)", async () => {
    // The first visit's worker is active and this tab navigated without a controller, so
    // `registration.active` alone read as "a worker from before" and offered a reload for the
    // version this tab already runs. Asking which build it serves is what tells them apart.
    const { notice, listeners, options, registration, asked } = harness(null, {}, THIS_BUILD);

    await options().onRegisteredSW?.("/sw.js", registration);
    listeners.get("controllerchange")!();

    expect(asked()).toBe(1);
    expect(notice.getSnapshot()).toBe(false);
  });

  test("a worker too old to answer is an older version, and still raises it (#235)", async () => {
    // Every worker shipped before #259 ignores the question. Silence is the answer of exactly
    // the builds the notice exists for, so it must not read as "same build".
    const { notice, listeners, options, registration } = harness(null, {}, null);

    await options().onRegisteredSW?.("/sw.js", registration);
    listeners.get("controllerchange")!();

    expect(notice.getSnapshot()).toBe(true);
  });

  test("no active worker is nobody to ask, and still says nothing (#203)", async () => {
    const { notice, listeners, options, registration, asked } = harness(null, null);

    await options().onRegisteredSW?.("/sw.js", registration);
    listeners.get("controllerchange")!();

    expect(asked()).toBe(0);
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
    const { options, documentListeners, doc, registration, updates } = harness({});
    options().onRegisteredSW!("/sw.js", registration);
    documentListeners.get("visibilitychange")!();
    expect(updates()).toBe(0);
    doc.visibilityState = "visible";
    documentListeners.get("visibilitychange")!();
    expect(updates()).toBe(1);
  });

  test("so does the window regaining focus — a desktop PWA switched back to never changes visibility", () => {
    const { options, windowListeners, registration, updates } = harness({});
    options().onRegisteredSW!("/sw.js", registration);
    windowListeners.get("focus")!();
    expect(updates()).toBe(1);
  });

  test("a check that fails offline is dropped quietly, not left as an unhandled rejection", async () => {
    const { options, windowListeners } = harness({});
    let asked = 0;
    const offline = { update: () => (asked += 1, Promise.reject(new Error("offline"))) } as unknown as ServiceWorkerRegistration;
    options().onRegisteredSW!("/sw.js", offline);
    windowListeners.get("focus")!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toBe(1);
  });

  test("works where the browser has no service worker at all", () => {
    const notice = watchForNewVersion({
      build: THIS_BUILD,
      askWorkerBuild: async () => null,
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

  test("a worker that did not answer is not this build", () => {
    // Every worker shipped before #259 ignores the question, and those are older builds by
    // definition — the case the notice exists for (#235).
    expect(servesThisBuild(null, "abc")).toBe(false);
    expect(servesThisBuild(undefined, "abc")).toBe(false);
    expect(servesThisBuild(42, "abc")).toBe(false);
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
});
