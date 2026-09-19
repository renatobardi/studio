import { describe, expect, test } from "bun:test";
import { nip19 } from "nostr-tools";
import { displayName, ownDisplayName, type Profile } from "./useProfiles";

const PUBKEY = "6bbf5828".padEnd(64, "a");
const npub = nip19.npubEncode(PUBKEY);

describe("displayName", () => {
  test("is the kind 0 name once it has arrived", () => {
    expect(displayName(new Map<string, Profile>([[PUBKEY, { name: "Ana Petrova" }]]), PUBKEY)).toBe("Ana Petrova");
  });

  test("abbreviates the npub, as the prototype's npub1rb92…7ktz, while there is no profile — never hex", () => {
    const name = displayName(new Map(), PUBKEY);
    expect(name).not.toContain(PUBKEY.slice(0, 8));
    expect(name).toBe(`${npub.slice(0, 9)}…${npub.slice(-4)}`);
  });
});

describe("ownDisplayName", () => {
  test("is the own kind 0 name once it has arrived", () => {
    expect(ownDisplayName(new Map<string, Profile>([[PUBKEY, { name: "E2E Test Person" }]]), PUBKEY)).toBe(
      "E2E Test Person",
    );
  });

  test("falls back to the short npub, like the rest of the UI, once the relay answered without a kind 0 (#196)", () => {
    // `{}`: asked for and answered, nothing published — an Agent, or someone who skipped the name step.
    const name = ownDisplayName(new Map<string, Profile>([[PUBKEY, {}]]), PUBKEY);
    expect(name).toBe(`${npub.slice(0, 9)}…${npub.slice(-4)}`);
    expect(name).not.toContain(PUBKEY.slice(0, 8));
  });

  test("is a neutral placeholder until the own kind 0 arrives, or before the pubkey is known", () => {
    expect(ownDisplayName(new Map(), PUBKEY)).toBe("…");
    expect(ownDisplayName(new Map(), null)).toBe("…");
  });
});
