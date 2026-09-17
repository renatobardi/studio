import { useEffect } from "react";

/** Escape dismisses whatever is on top — the dialogs and the sidebar's account menu (#142,
 * #148). `active` is for the ones that stay mounted while closed. */
export function useEscape(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape, active]);
}
