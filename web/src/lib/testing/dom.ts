/**
 * The DOM component tests render into, and the cleanup between them (#94).
 *
 * Preloaded by `bunfig.toml` for the whole run, not imported per file: `GlobalRegistrator`
 * writes `window`, `document` and friends onto `globalThis`, so a per-file import would leak
 * into every file after it in the same process regardless — in an order that differs in CI.
 *
 * What this harness is for is the WIRING: that a component hands the right thing to the right
 * module, and that what comes back reaches the screen. The decision itself stays in
 * `web/src/lib/`, tested there without a DOM. See `web/README.md`.
 */
import "fake-indexeddb/auto";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";

// Placeholders, never real config: `lib/firebase.ts` builds its client at module load, and
// `getAuth` throws `auth/invalid-api-key` without one — so importing anything that reaches it
// (App.tsx does) would fail before a single assertion ran. Same reason playwright.config.ts
// carries them for the preview server.
process.env.VITE_FIREBASE_API_KEY ??= "test-not-a-key";
process.env.VITE_FIREBASE_AUTH_DOMAIN ??= "test.invalid";
process.env.VITE_FIREBASE_PROJECT_ID ??= "studio-test-harness";
process.env.VITE_FIREBASE_APP_ID ??= "1:0:web:0";

// happy-dom brings its own streams, and they are not Bun's: `age-encryption` pipes through a
// TransformStream and rejects one whose `readable` came from the other implementation, which
// took the Key Backup tests down. Nothing rendered needs a DOM stream, so the runtime's own
// are put back. (IndexedDB happy-dom has none at all, and `lib/appearance.ts` reads the
// Appearance out of one on App.tsx's first render — `fake-indexeddb` gives it the empty store
// a browser that never saw this app would have.)
const streams = {
  ReadableStream: globalThis.ReadableStream,
  WritableStream: globalThis.WritableStream,
  TransformStream: globalThis.TransformStream,
};

// With an origin, not about:blank: the app reads `window.location.search` at boot and writes
// the address bar back with `history.replaceState`, and on about:blank both are inert.
GlobalRegistrator.register({ url: "https://studio.test/" });

Object.defineProperties(
  globalThis,
  Object.fromEntries(
    Object.entries(streams).map(([name, value]) => [name, { value, writable: true, configurable: true }]),
  ),
);

// Imported only now, and never at the top: `@testing-library/dom` binds `screen` to the
// `document` that exists when it is first evaluated, and a static import is evaluated before
// any of the statements above have run.
const { cleanup } = await import("@testing-library/react");

// Every render is torn down after its test: React Testing Library keeps mounted trees in a
// module-level set, and a leftover one answers the next test's queries.
afterEach(cleanup);
