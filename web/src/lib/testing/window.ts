/** As much of a keyboard event as a window-level listener here reads. `KeyboardEvent` itself is
 * a DOM class bun has no constructor for, so a test could not make one to fire. */
export type KeyPress = Pick<KeyboardEvent, "key">;

/** The two calls a window-level listener makes, and nothing else. */
export interface WindowListeners {
  addEventListener(type: string, listener: (event: KeyPress) => void): void;
  removeEventListener(type: string, listener: (event: KeyPress) => void): void;
}

/**
 * Puts `listeners` in front of the global `window` for a test, and hands back the call that
 * takes it away again.
 *
 * `Window & typeof globalThis` is far more than any test stands in for, so the one cast that
 * says so lives here rather than in each test, where it would also have excused the stub's own
 * shape (#238).
 */
export function stubWindow(listeners: WindowListeners): () => void {
  globalThis.window = listeners as Window & typeof globalThis;
  return () => {
    // @ts-expect-error test-only cleanup of the global stubbed just above
    delete globalThis.window;
  };
}
