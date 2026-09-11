import { describe, expect, test } from "bun:test";
import { verifyEvent } from "nostr-tools";
import {
  buildProfileEvent,
  relayListTemplate,
  serverListTemplate,
  generateIdentity,
  nsecFromSecretKey,
  profileEventTemplate,
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

describe("profileEventTemplate", () => {
  test("builds an unsigned kind:0 template with the profile as JSON content — usable with any Signer, not just a raw secret key", () => {
    const template = profileEventTemplate({ name: "Renato", about: "hi" });

    expect(template.kind).toBe(0);
    expect(template.tags).toEqual([]);
    expect(JSON.parse(template.content)).toEqual({ name: "Renato", about: "hi" });
  });
});

describe("relayListTemplate", () => {
  test("a kind:10050 template with one relay tag per relay", () => {
    const relays = ["wss://relay.example/workspace/family"];

    const template = relayListTemplate(relays);

    expect(template.kind).toBe(10050);
    expect(template.tags).toEqual([["relay", relays[0]]]);
  });
});

describe("serverListTemplate", () => {
  test("a kind:10063 template with one server tag per media server (BUD-03)", () => {
    const servers = ["https://api.example/media"];

    const template = serverListTemplate(servers);

    expect(template.kind).toBe(10063);
    expect(template.tags).toEqual([["server", servers[0]]]);
  });
});
