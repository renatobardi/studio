import { describe, expect, test } from "bun:test";
import { finalizeEvent, verifyEvent } from "nostr-tools";
import { generateIdentity } from "./identity";
import {
  MAX_UPLOAD_BYTES,
  MediaError,
  buildBlossomAuthEvent,
  buildImetaTag,
  parseImetaTags,
  sha256Hex,
  validateAttachment,
  type BlobDescriptor,
} from "./media";

function signerFor(secretKey: Uint8Array) {
  return {
    async getPublicKey() {
      return "";
    },
    async signEvent(template: { kind: number; tags: string[][]; content: string; created_at: number }) {
      return finalizeEvent(template, secretKey);
    },
    async nip44Encrypt() {
      throw new Error("not used in these tests");
    },
    async nip44Decrypt() {
      throw new Error("not used in these tests");
    },
  };
}

describe("validateAttachment", () => {
  test("accepts an image under the size limit", () => {
    expect(() => validateAttachment({ type: "image/png", size: 1024 })).not.toThrow();
  });

  test("rejects a non-image mime type", () => {
    expect(() => validateAttachment({ type: "text/plain", size: 1024 })).toThrow(MediaError);
  });

  test("rejects a file over the 10 MB limit", () => {
    expect(() => validateAttachment({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 })).toThrow(MediaError);
  });
});

describe("sha256Hex", () => {
  test("hashes bytes to a lowercase hex sha256", () => {
    const bytes = new TextEncoder().encode("hello").buffer;
    expect(sha256Hex(bytes)).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("buildBlossomAuthEvent", () => {
  test("signs a kind 24242 upload event with t/x/expiration tags", async () => {
    const identity = generateIdentity();
    const sha256 = "a".repeat(64);

    const event = await buildBlossomAuthEvent("upload", { sha256 }, signerFor(identity.secretKey));

    expect(event.kind).toBe(24242);
    expect(event.tags[0]).toEqual(["t", "upload"]);
    expect(event.tags.find((t) => t[0] === "x")).toEqual(["x", sha256]);
    expect(event.tags.find((t) => t[0] === "expiration")?.[1]).toMatch(/^\d+$/);
    expect(verifyEvent(event)).toBe(true);
  });

  test("an upload event names the Direct Message recipients it authorizes (#38)", async () => {
    const identity = generateIdentity();
    const recipient = generateIdentity();

    const event = await buildBlossomAuthEvent(
      "upload",
      { sha256: "a".repeat(64), recipients: [recipient.publicKey] },
      signerFor(identity.secretKey),
    );

    expect(event.tags.filter((t) => t[0] === "p")).toEqual([["p", recipient.publicKey]]);
    expect(verifyEvent(event)).toBe(true);
  });

  test("a get event carries no x tag", async () => {
    const identity = generateIdentity();

    const event = await buildBlossomAuthEvent("get", {}, signerFor(identity.secretKey));

    expect(event.tags[0]).toEqual(["t", "get"]);
    expect(event.tags.find((t) => t[0] === "x")).toBeUndefined();
  });
});

describe("buildImetaTag", () => {
  test("builds a NIP-92 imeta tag from a blob descriptor", () => {
    const descriptor: BlobDescriptor = { url: "https://x/media/abc", sha256: "abc", size: 42, type: "image/jpeg" };

    expect(buildImetaTag(descriptor)).toEqual([
      "imeta",
      "url https://x/media/abc",
      "m image/jpeg",
      "x abc",
      "size 42",
    ]);
  });

  test("includes a dim item when given dimensions", () => {
    const descriptor: BlobDescriptor = { url: "https://x/media/abc", sha256: "abc", size: 42, type: "image/jpeg" };

    const tag = buildImetaTag(descriptor, "800x600");

    expect(tag).toContain("dim 800x600");
  });
});

describe("parseImetaTags", () => {
  test("recovers a blob descriptor round-tripped through buildImetaTag", () => {
    const descriptor: BlobDescriptor = { url: "https://x/media/abc", sha256: "abc", size: 42, type: "image/jpeg" };
    const tags = [["h", "chan1"], buildImetaTag(descriptor)];

    expect(parseImetaTags(tags)).toEqual([descriptor]);
  });

  test("ignores non-imeta tags and a malformed imeta tag missing url/x", () => {
    expect(parseImetaTags([["h", "chan1"], ["imeta", "m image/jpeg"]])).toEqual([]);
  });

  test("returns one descriptor per imeta tag", () => {
    const a: BlobDescriptor = { url: "https://x/media/a", sha256: "a", size: 1, type: "image/png" };
    const b: BlobDescriptor = { url: "https://x/media/b", sha256: "b", size: 2, type: "image/png" };

    expect(parseImetaTags([buildImetaTag(a), buildImetaTag(b)])).toEqual([a, b]);
  });
});
