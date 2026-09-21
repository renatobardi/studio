import { spyOn } from "bun:test";

/** As much of a keyboard event as a window-level listener here reads. `KeyboardEvent` itself is
 * a DOM class bun has no constructor for, so a test could not make one to fire. */
export type KeyPress = Pick<KeyboardEvent, "key">;

/** The two calls a window-level listener makes, and nothing else. Function properties rather
 * than methods, so a listener reading more of the event than `KeyPress` carries is a type error
 * here instead of a test that passes and a page that does not. */
export interface WindowListeners {
  addEventListener: (type: string, listener: (event: KeyPress) => void) => void;
  removeEventListener: (type: string, listener: (event: KeyPress) => void) => void;
}

/**
 * Puts `listeners` in front of the window's own for a test, and hands back the call that gives
 * the real ones back.
 *
 * In front of the window, not in place of it: since #94 a real `window` exists for the whole
 * run, and a test that replaced it left every later file in the process without one. `Window`'s
 * own overloads are far wider than what a listener here reads, so the one cast that says so
 * lives here rather than in each test, where it would also have excused the stub's own shape
 * (#238).
 */
export function stubWindowListeners(listeners: WindowListeners): () => void {
  const add = spyOn(window, "addEventListener").mockImplementation(
    listeners.addEventListener as typeof window.addEventListener,
  );
  const remove = spyOn(window, "removeEventListener").mockImplementation(
    listeners.removeEventListener as typeof window.removeEventListener,
  );
  return () => {
    add.mockRestore();
    remove.mockRestore();
  };
}

/** Puts a NIP-07 extension on the window — `null` and `undefined` included, which is what the
 * custody checks read. On the window, never in place of it, for the reason above. */
export function stubNostr(nostr: unknown): void {
  Object.defineProperty(window, "nostr", { value: nostr, configurable: true, writable: true });
}

/** No extension at all: the property is gone, not set to undefined. */
export function clearNostr(): void {
  delete (window as { nostr?: unknown }).nostr;
}
