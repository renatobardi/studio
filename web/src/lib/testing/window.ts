/** As much of a keyboard event as a window-level listener here reads. `KeyboardEvent` itself is
 * a DOM class bun has no constructor for, so a test could not make one to fire. */
export type KeyPress = Pick<KeyboardEvent, "key">;

/**
 * Puts a NIP-07 extension — or, with `undefined`, none — on the window, and hands back the call
 * that takes it away.
 *
 * On `window`, never in place of it: since #94 a real `window` exists for the whole run, and a
 * test that replaced it left every later file in the process without one.
 */
export function stubNostr(nostr: unknown): () => void {
  Object.defineProperty(window, "nostr", { value: nostr, configurable: true, writable: true });
  return () => {
    delete (window as { nostr?: unknown }).nostr;
  };
}
