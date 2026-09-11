import { describe, expect, test } from "bun:test";
import {
  buildDmImetaTag,
  decryptDmAttachmentBytes,
  encryptFileForDm,
  parseDmImetaTags,
  type DmAttachment,
} from "./dmMedia";
import { sha256Hex, type BlobDescriptor } from "./media";

describe("encryptFileForDm / decryptDmAttachmentBytes", () => {
  test("round-trips the original bytes", () => {
    const original = new TextEncoder().encode("this is a fake image's bytes, not a real PNG");

    const encrypted = encryptFileForDm(original.buffer as ArrayBuffer, "image/png");
    const decrypted = decryptDmAttachmentBytes(encrypted.ciphertextBytes.buffer as ArrayBuffer, encrypted.key);

    expect(new Uint8Array(decrypted)).toEqual(original);
  });

  test("the same file encrypted twice yields different ciphertext (fresh key, fresh nonce)", () => {
    const original = new TextEncoder().encode("same bytes");

    const a = encryptFileForDm(original.buffer as ArrayBuffer, "image/png");
    const b = encryptFileForDm(original.buffer as ArrayBuffer, "image/png");

    expect(a.key).not.toBe(b.key);
    expect(bytesEqual(a.ciphertextBytes, b.ciphertextBytes)).toBe(false);
  });

  test("decrypting with the wrong key throws", () => {
    const original = new TextEncoder().encode("secret bytes");
    const encrypted = encryptFileForDm(original.buffer as ArrayBuffer, "image/png");
    const wrongKey = encryptFileForDm(original.buffer as ArrayBuffer, "image/png").key;

    expect(() => decryptDmAttachmentBytes(encrypted.ciphertextBytes.buffer as ArrayBuffer, wrongKey)).toThrow();
  });

  test("the server never sees the original mime — ciphertext bytes hash independently of it", () => {
    const original = new TextEncoder().encode("bytes");
    const encrypted = encryptFileForDm(original.buffer as ArrayBuffer, "image/png");

    // sha256 (what the server records) is computed over the ciphertext, not the plaintext.
    expect(sha256Hex(encrypted.ciphertextBytes.buffer as ArrayBuffer)).not.toBe(sha256Hex(original.buffer as ArrayBuffer));
  });
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}

describe("buildDmImetaTag / parseDmImetaTags", () => {
  test("round-trips a descriptor, key and original mime", () => {
    const descriptor: BlobDescriptor = { url: "https://media.example/x", sha256: "a".repeat(64), size: 1234, type: "application/octet-stream" };

    const tag = buildDmImetaTag(descriptor, "deadbeef".repeat(8), "image/jpeg", "800x600");
    const [parsed] = parseDmImetaTags([tag]);

    expect(parsed).toEqual<DmAttachment>({
      url: descriptor.url, sha256: descriptor.sha256, size: descriptor.size,
      originalMime: "image/jpeg", key: "deadbeef".repeat(8),
    });
  });

  test("a tag missing the key is skipped (not a Direct Message attachment)", () => {
    const tag = ["imeta", "url https://x", "x " + "a".repeat(64)];

    expect(parseDmImetaTags([tag])).toEqual([]);
  });

  test("non-imeta tags are ignored", () => {
    expect(parseDmImetaTags([["p", "somepubkey"]])).toEqual([]);
  });
});
