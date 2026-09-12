import { describe, expect, test } from "bun:test";
import { localIdentityMatches, resolveOnboardingEntry } from "./accountIdentity";

describe("resolveOnboardingEntry", () => {
  test("a fresh Account under local custody generates an Identity", () => {
    expect(
      resolveOnboardingEntry({ linkedPubkey: null, hasKeyBackup: false }, "local"),
    ).toBe("new-identity");
  });

  test("an Account already linked to an Identity restores it, never a substitute", () => {
    // The loss in #36: onboarding again generated a second Identity and
    // overwrote the Key Backup that recovered the first.
    expect(
      resolveOnboardingEntry({ linkedPubkey: "abc", hasKeyBackup: true }, "local"),
    ).toBe("restore");
  });

  test("a legacy Account with a Key Backup but no link restores rather than replaces", () => {
    expect(
      resolveOnboardingEntry({ linkedPubkey: null, hasKeyBackup: true }, "local"),
    ).toBe("restore");
  });

  test("under an extension there is nothing to restore and nothing to generate", () => {
    expect(
      resolveOnboardingEntry({ linkedPubkey: "abc", hasKeyBackup: false }, "extension"),
    ).toBe("extension");
  });
});

describe("localIdentityMatches", () => {
  test("the linked Identity is the one the app may sign with", () => {
    expect(localIdentityMatches("abc", "abc")).toBe(true);
  });

  test("a local key that is not the Account's Identity is not usable", () => {
    expect(localIdentityMatches("other", "abc")).toBe(false);
  });

  test("nothing to contradict when the Account links no Identity yet", () => {
    expect(localIdentityMatches("abc", null)).toBe(true);
  });
});
