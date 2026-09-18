import { useEffect } from "react";
import { isEscape } from "../../lib/signOut";

/** The window-level half of {@link useEscape}, apart from React so it can be tested on its own:
 * listens for Escape and hands back the call that stops listening. */
export function listenForEscape(onEscape: () => void): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (isEscape(event)) onEscape();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/** Escape dismisses whatever is on top — the dialogs and the sidebar's account menu (#142,
 * #148). `active` is for the ones that stay mounted while closed. */
export function useEscape(onEscape: () => void, active = true) {
  useEffect(() => (active ? listenForEscape(onEscape) : undefined), [onEscape, active]);
}
