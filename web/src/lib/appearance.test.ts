import { describe, expect, test } from "bun:test";
import { DEFAULT_APPEARANCE, parseAppearance, zoomFor } from "./appearance";

/** The prototype scales the whole shell with `zoom` 0.92 / 1 / 1.12 (design/STUDIO.md). A root
 * font-size did nothing here: every size in the app is in px. */
describe("zoomFor", () => {
  test("maps each font scale to the shell's zoom factor", () => {
    expect(zoomFor("smaller")).toBe("0.92");
    expect(zoomFor("default")).toBe("1");
    expect(zoomFor("larger")).toBe("1.12");
  });
});

describe("DEFAULT_APPEARANCE", () => {
  test("starts where the prototype starts: light, compact, default size", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ theme: "light", density: "compact", fontScale: "default" });
  });
});

describe("parseAppearance", () => {
  test("returns the default when given undefined (nothing stored yet)", () => {
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  });

  test("returns the default when given a malformed value", () => {
    expect(parseAppearance({ theme: "not-a-theme" })).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("nonsense")).toEqual(DEFAULT_APPEARANCE);
  });

  test("passes through a well-formed stored value", () => {
    const stored = { theme: "dark", density: "compact", fontScale: "larger" };
    expect(parseAppearance(stored)).toEqual(stored);
  });

  test("fills in defaults for a partially-formed stored value", () => {
    expect(parseAppearance({ theme: "dark" })).toEqual({ ...DEFAULT_APPEARANCE, theme: "dark" });
  });
});
