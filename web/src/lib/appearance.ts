import { get, set } from "idb-keyval";

export type Theme = "light" | "dark";
export type Density = "compact" | "comfy" | "spacious";
export type FontScale = "smaller" | "default" | "larger";

export interface Appearance {
  theme: Theme;
  density: Density;
  fontScale: FontScale;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "light", density: "comfy", fontScale: "default" };

const THEMES: Theme[] = ["light", "dark"];
const DENSITIES: Density[] = ["compact", "comfy", "spacious"];
const FONT_SCALES: FontScale[] = ["smaller", "default", "larger"];

const STORE_KEY = "studio.appearance";

export function fontScaleValue(scale: FontScale): string {
  return { smaller: "87.5%", default: "100%", larger: "112.5%" }[scale];
}

/** Validates a stored (possibly stale or corrupt) value, filling in defaults field by field. */
export function parseAppearance(value: unknown): Appearance {
  if (typeof value !== "object" || value === null) return DEFAULT_APPEARANCE;
  const candidate = value as Partial<Appearance>;
  return {
    theme: THEMES.includes(candidate.theme as Theme) ? (candidate.theme as Theme) : DEFAULT_APPEARANCE.theme,
    density: DENSITIES.includes(candidate.density as Density)
      ? (candidate.density as Density)
      : DEFAULT_APPEARANCE.density,
    fontScale: FONT_SCALES.includes(candidate.fontScale as FontScale)
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
  root.style.fontSize = fontScaleValue(appearance.fontScale);
}
