import { afterEach, describe, expect, test } from "bun:test";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import { generateIdentity } from "./identity";
import { restoreCaches, stubCaches } from "./testing/cacheStorage";
import {
  buildDmImetaTag,
  fetchDmAttachmentObjectUrl,
  decryptDmAttachmentBytes,
  encryptFileForDm,
  parseDmImetaTags,
  type DmAttachment,
} from "./dmMedia";
import { MediaError, sha256Hex, type BlobDescriptor } from "./media";

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

describe("fetchDmAttachmentObjectUrl", () => {
  function signerFor(secretKey: Uint8Array) {
    return {
      async getPublicKey() {
        return getPublicKey(secretKey);
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

  const original = new TextEncoder().encode("this is a fake photo's bytes");
  const encrypted = encryptFileForDm(original.buffer as ArrayBuffer, "image/png");
  const ciphertext = encrypted.ciphertextBytes;
  const hash = sha256Hex(ciphertext.buffer as ArrayBuffer);
  const url = `https://studio.test/media/${hash}`;

  const realFetch = globalThis.fetch;

  function stubFetch(ok = true) {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string) => {
      calls.push(String(input));
      return new Response(ok ? (ciphertext.buffer as ArrayBuffer) : null, { status: ok ? 200 : 403 });
    }) as typeof fetch;
    return calls;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
    restoreCaches();
  });

  test("caches the ciphertext, never the decrypted photo", async () => {
    // ADR-0003: the plaintext of a Direct Message photo exists only in the page.
    // What gets kept for the next view is what the server handed over.
    const { stores } = stubCaches();
    const signer = signerFor(generateIdentity().secretKey);
    const calls = stubFetch();

    await fetchDmAttachmentObjectUrl(url, hash, encrypted.key, "image/png", signer);
    await fetchDmAttachmentObjectUrl(url, hash, encrypted.key, "image/png", signer);

    expect(calls).toHaveLength(1);
    const scope = Object.keys(stores)[0]!;
    expect(new Uint8Array(scope ? stores[scope]![url]!.bytes : new ArrayBuffer(0))).toEqual(ciphertext);
  });

  test("another Identity on the same browser is refused instead of served A's copy", async () => {
    stubCaches();
    const a = signerFor(generateIdentity().secretKey);
    stubFetch();
    await fetchDmAttachmentObjectUrl(url, hash, encrypted.key, "image/png", a);

    const b = signerFor(generateIdentity().secretKey);
    stubFetch(false);

    await expect(fetchDmAttachmentObjectUrl(url, hash, encrypted.key, "image/png", b)).rejects.toThrow(MediaError);
  });
});
