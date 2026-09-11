import { isIos, isStandalone } from "../../lib/platform";

/** Studio has no push notifications yet, but when it does, iOS Safari only delivers them to an
 * installed (home-screen) PWA — never to a page open in a regular tab. This sets expectations
 * early, before notifications exist. */
export function IosInstallHint() {
  if (!isIos(navigator.userAgent) || isStandalone((q) => window.matchMedia(q))) return null;

  return (
    <div className="hint-banner" data-testid="ios-install-hint">
      On iPhone or iPad, add Studio to your Home Screen (Share → Add to Home Screen) — notifications will only work
      once it's installed.
    </div>
  );
}
