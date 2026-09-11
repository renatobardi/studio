import { describe, expect, test } from "bun:test";
import { DEFAULT_APPEARANCE, fontScaleValue, parseAppearance } from "./appearance";

describe("fontScaleValue", () => {
  test("maps each font scale to a root font-size percentage", () => {
    expect(fontScaleValue("smaller")).toBe("87.5%");
    expect(fontScaleValue("default")).toBe("100%");
    expect(fontScaleValue("larger")).toBe("112.5%");
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
