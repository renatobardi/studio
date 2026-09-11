import { describe, expect, test } from "bun:test";
import { isIos, isStandalone } from "./platform";

describe("isIos", () => {
  test("true for iPhone/iPad/iPod user agents", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isIos("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe(true);
  });

  test("false for other user agents", () => {
    expect(isIos("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
  });
});

describe("isStandalone", () => {
  test("reflects the display-mode: standalone media query", () => {
    expect(isStandalone(() => ({ matches: true }))).toBe(true);
    expect(isStandalone(() => ({ matches: false }))).toBe(false);
  });
});
