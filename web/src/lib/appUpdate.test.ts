import { describe, expect, test } from "bun:test";
import { createUpdateNotice, offersReload, watchForNewVersion } from "./appUpdate";

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

  test("ignores a first install claiming the page", () => {
    const notice = createUpdateNotice(false);
    notice.report("controllerchange");
    expect(notice.getSnapshot()).toBe(false);
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
  function harness(controller: object | null) {
    const listeners = new Map<string, () => void>();
    const documentListeners = new Map<string, () => void>();
    let options: Parameters<Parameters<typeof watchForNewVersion>[0]["registerSW"]>[0] | null = null;
    let updates = 0;
    const doc = {
      visibilityState: "hidden" as DocumentVisibilityState,
      addEventListener: (type: string, listener: () => void) => documentListeners.set(type, listener),
    };
    const notice = watchForNewVersion({
      serviceWorker: { controller, addEventListener: (type: string, listener: () => void) => listeners.set(type, listener) },
      registerSW: (given) => {
        options = given;
      },
      document: doc,
    });
    const registration = { update: async () => void (updates += 1) } as unknown as ServiceWorkerRegistration;
    return { notice, listeners, documentListeners, options: () => options!, doc, registration, updates: () => updates };
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

  test("works where the browser has no service worker at all", () => {
    const notice = watchForNewVersion({ serviceWorker: undefined, registerSW: () => {}, document: { visibilityState: "visible", addEventListener: () => {} } });
    expect(notice.getSnapshot()).toBe(false);
  });
});
