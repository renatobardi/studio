import { get, set } from "idb-keyval";

export type Theme = "light" | "dark";
export type Density = "compact" | "comfy" | "spacious";
export type FontScale = "smaller" | "default" | "larger";

export interface Appearance {
  theme: Theme;
  density: Density;
  fontScale: FontScale;
}

/** Where the prototype starts (docs/UI/REFERENCE.md): its own default density is compact. */
export const DEFAULT_APPEARANCE: Appearance = { theme: "light", density: "compact", fontScale: "default" };

const THEMES = new Set<Theme>(["light", "dark"]);
const DENSITIES = new Set<Density>(["compact", "comfy", "spacious"]);
const FONT_SCALES = new Set<FontScale>(["smaller", "default", "larger"]);

const STORE_KEY = "studio.appearance";

/** The shell's `zoom` for a font scale — the prototype's 0.92 / 1 / 1.12 (design/STUDIO.md).
 * Every size in the app is in px, so a root font-size changed nothing; zoom scales it all. */
export function zoomFor(scale: FontScale): string {
  return { smaller: "0.92", default: "1", larger: "1.12" }[scale];
}

/** Validates a stored (possibly stale or corrupt) value, filling in defaults field by field. */
export function parseAppearance(value: unknown): Appearance {
  if (typeof value !== "object" || value === null) return DEFAULT_APPEARANCE;
  const candidate = value as Partial<Appearance>;
  return {
    theme: THEMES.has(candidate.theme as Theme) ? (candidate.theme as Theme) : DEFAULT_APPEARANCE.theme,
    density: DENSITIES.has(candidate.density as Density)
      ? (candidate.density as Density)
      : DEFAULT_APPEARANCE.density,
    fontScale: FONT_SCALES.has(candidate.fontScale as FontScale)
      ? (candidate.fontScale as FontScale)
      : DEFAULT_APPEARANCE.fontScale,
  };
}

export async function loadAppearance(): Promise<Appearance> {
  return parseAppearance(await get(STORE_KEY));
}

export async function storeAppearance(appearance: Appearance): Promise<void> {
  await set(STORE_KEY, appearance);
}

/** Applies an Appearance to the document — the DOM-touching half of this module, not unit tested
 * (see repo convention: DOM effects live untested next to pure, tested mapping functions). */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.classList.toggle("dark", appearance.theme === "dark");
  root.dataset.density = appearance.density;
  const zoom = zoomFor(appearance.fontScale);
  root.style.zoom = zoom;
  // `100vh` is scaled by the zoom too, so a full-height shell would overflow by that factor;
  // the shells divide it back out (see app.css).
  root.style.setProperty("--shell-zoom", zoom);
}
