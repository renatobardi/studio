import { afterEach, describe, expect, test } from "bun:test";
import { extensionSupportsNip44, hasNip07 } from "./custody";

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

describe("extensionSupportsNip44", () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of a global we stub below
    delete globalThis.window;
  });

  const stub = (nostr?: unknown) => {
    // @ts-expect-error minimal window stub for this check
    globalThis.window = nostr === undefined ? {} : { nostr };
  };

  test("false with no extension at all", () => {
    stub();
    expect(extensionSupportsNip44()).toBe(false);
  });

  test("false when the extension exposes no nip44", () => {
    stub({ getPublicKey() {}, signEvent() {} });
    expect(extensionSupportsNip44()).toBe(false);
  });

  test("false when nip44 is missing either direction", () => {
    stub({ nip44: { encrypt() {} } });
    expect(extensionSupportsNip44()).toBe(false);
    stub({ nip44: { decrypt() {} } });
    expect(extensionSupportsNip44()).toBe(false);
  });

  test("true when nip44 encrypts and decrypts", () => {
    stub({ nip44: { encrypt() {}, decrypt() {} } });
    expect(extensionSupportsNip44()).toBe(true);
  });
});
