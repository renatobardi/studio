import { afterEach, describe, expect, test } from "bun:test";
import { hasNip07 } from "./custody";

describe("hasNip07", () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of a global we stub below
    delete globalThis.window;
  });

  test("false when window.nostr is absent", () => {
    // @ts-expect-error minimal window stub for this check
    globalThis.window = {};
    expect(hasNip07()).toBe(false);
  });

  test("true when window.nostr is present", () => {
    // @ts-expect-error minimal window stub for this check
    globalThis.window = { nostr: {} };
    expect(hasNip07()).toBe(true);
  });
});
