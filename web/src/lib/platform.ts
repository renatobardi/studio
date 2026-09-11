/** True on iOS Safari, which — unlike Android Chrome — never shows a web push permission
 * prompt for a page open in a regular tab; it only works once the PWA is added to the home
 * screen. Pure string matching so it's unit-testable without a real UA. */
export function isIos(userAgent: string): boolean {
  return /iPhone|iPad|iPod/.test(userAgent);
}

/** True once the app is already running as an installed, home-screen PWA. */
export function isStandalone(matchMedia: (query: string) => { matches: boolean }): boolean {
  return matchMedia("(display-mode: standalone)").matches;
}
