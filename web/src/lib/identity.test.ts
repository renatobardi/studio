import { describe, expect, test } from "bun:test";
import { verifyEvent } from "nostr-tools";
import {
  buildProfileEvent,
  buildRelayListEvent,
  buildServerListEvent,
  generateIdentity,
  nsecFromSecretKey,
  secretKeyFromNsec,
} from "./identity";

describe("generateIdentity", () => {
  test("produces a secret key and its matching public key", () => {
    const identity = generateIdentity();
    expect(identity.secretKey).toBeInstanceOf(Uint8Array);
    expect(identity.secretKey.length).toBe(32);
    expect(identity.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  test("generates a different keypair each time", () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});

describe("nsec round-trip", () => {
  test("nsecFromSecretKey / secretKeyFromNsec are inverses", () => {
    const identity = generateIdentity();
    const nsec = nsecFromSecretKey(identity.secretKey);
    expect(nsec).toMatch(/^nsec1/);
    expect(secretKeyFromNsec(nsec)).toEqual(identity.secretKey);
  });
});

describe("buildProfileEvent", () => {
  test("signs a kind:0 event with the given profile as JSON content", () => {
    const identity = generateIdentity();
    const event = buildProfileEvent(identity.secretKey, { name: "Renato", picture: "🌸" });

    expect(event.kind).toBe(0);
    expect(event.pubkey).toBe(identity.publicKey);
    expect(JSON.parse(event.content)).toEqual({ name: "Renato", picture: "🌸" });
    expect(verifyEvent(event)).toBe(true);
  });
});

describe("buildRelayListEvent", () => {
  test("signs a kind:10050 event with one r tag per relay", () => {
    const identity = generateIdentity();
    const relays = ["wss://relay.example/workspace/family"];
    const event = buildRelayListEvent(identity.secretKey, relays);

    expect(event.kind).toBe(10050);
    expect(event.tags).toEqual([["relay", relays[0]]]);
    expect(verifyEvent(event)).toBe(true);
  });
});

describe("buildServerListEvent", () => {
  test("signs a kind:10063 event with one server tag per media server (BUD-03)", () => {
    const identity = generateIdentity();
    const servers = ["https://api.example/media"];
    const event = buildServerListEvent(identity.secretKey, servers);

    expect(event.kind).toBe(10063);
    expect(event.tags).toEqual([["server", servers[0]]]);
    expect(verifyEvent(event)).toBe(true);
  });
});
