import { afterEach, describe, expect, test } from "bun:test";
import { finalizeEvent, getPublicKey, nip44, type EventTemplate } from "nostr-tools";
import type { Signer } from "./custody";
import { generateIdentity } from "./identity";
import { restoreCaches, stubCaches } from "./testing/cacheStorage";
import { makePng } from "./testing/png";
import {
  MAX_DM_PHOTO_BYTES,
  buildDmImetaTag,
  fetchDmAttachmentObjectUrl,
  decryptDmAttachmentBytes,
  encryptFileForDm,
  parseDmImetaTags,
  validateDmAttachment,
  wrapDmMessage,
  type DmAttachment,
  type ReadyDmPhoto,
} from "./dmMedia";
import { MAX_UPLOAD_BYTES, MediaError, sha256Hex, validateAttachment, type BlobDescriptor } from "./media";
import { unwrapGiftWrap } from "./nip17";

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

describe("the Direct Message photo limit", () => {
  // #48: the server's 10 MB limit applies to what it receives — the NIP-44 ciphertext of the
  // base64 of the photo, padded. That nearly doubles it, so a DM photo gets its own, lower
  // limit: one the client can promise the server will accept.
  test("a photo over 5 MB is refused before anything is encrypted or uploaded, naming the limit", () => {
    const refuse = () => validateDmAttachment({ type: "image/jpeg", size: MAX_DM_PHOTO_BYTES + 1 });

    expect(refuse).toThrow(MediaError);
    expect(refuse).toThrow("5 MB");
  });

  test("a real photo of exactly 5 MB passes, and its ciphertext still fits the server's limit", () => {
    const png = makePng(MAX_DM_PHOTO_BYTES);
    expect(() => validateDmAttachment({ type: "image/png", size: png.length })).not.toThrow();

    const encrypted = encryptFileForDm(png.buffer as ArrayBuffer, "image/png");

    // Ciphertext length only grows with plaintext length, so the largest allowed photo is
    // the worst case for every photo allowed.
    expect(encrypted.ciphertextBytes.length).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    expect(decryptDmAttachmentBytes(encrypted.ciphertextBytes.buffer as ArrayBuffer, encrypted.key)).toEqual(png);
  });

  test.each([
    ["a small photo", 48 * 1024],
    ["a phone photo", 2 * 1024 * 1024],
    ["one just under the limit", MAX_DM_PHOTO_BYTES - 1],
  ])("%s round-trips through encryption intact", (_, size) => {
    const png = makePng(size);

    const encrypted = encryptFileForDm(png.buffer as ArrayBuffer, "image/png");

    expect(encrypted.ciphertextBytes.length).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    expect(decryptDmAttachmentBytes(encrypted.ciphertextBytes.buffer as ArrayBuffer, encrypted.key)).toEqual(png);
  });

  test("the Channel limit is not the Direct Message one: an image of 10 MB is still fine there", () => {
    expect(() => validateAttachment({ type: "image/png", size: MAX_UPLOAD_BYTES })).not.toThrow();
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

describe("wrapDmMessage", () => {
  function localSigner(secretKey: Uint8Array): Signer {
    return {
      async getPublicKey() {
        return getPublicKey(secretKey);
      },
      async signEvent(template: EventTemplate) {
        return finalizeEvent(template, secretKey);
      },
      async nip44Encrypt(pubkey: string, plaintext: string) {
        return nip44.encrypt(plaintext, nip44.getConversationKey(secretKey, pubkey));
      },
      async nip44Decrypt(pubkey: string, ciphertext: string) {
        return nip44.decrypt(ciphertext, nip44.getConversationKey(secretKey, pubkey));
      },
    };
  }

  function readyPhoto(label: string): ReadyDmPhoto {
    const encrypted = encryptFileForDm(new TextEncoder().encode(label).buffer as ArrayBuffer, "image/jpeg");
    const sha256 = sha256Hex(encrypted.ciphertextBytes.buffer as ArrayBuffer);
    return {
      encrypted,
      descriptor: { url: `https://studio.test/media/${sha256}`, sha256, size: encrypted.ciphertextBytes.length, type: "application/octet-stream" },
      dim: "4x3",
    };
  }

  const sender = generateIdentity();
  const peer = generateIdentity();
  const photos = [readyPhoto("first photo"), readyPhoto("second photo")];

  test("no gift wrap — the sender's own copy included — names a photo's hash outside the encryption", async () => {
    // #48 (decided with #38): the hash, the reference and the key live only inside the rumor.
    // An outer `x` grants nothing any more, and it would tie every envelope to the file.
    const wraps = await wrapDmMessage(localSigner(sender.secretKey), sender.publicKey, [peer.publicKey], "two photos", photos);

    expect(wraps).toHaveLength(2);
    for (const wrap of wraps) {
      expect(wrap.tags).toEqual([["p", expect.any(String)]]);
      for (const photo of photos) expect(JSON.stringify(wrap)).not.toContain(photo.descriptor.sha256);
    }
  });

  test("each participant, and the sender on another device, finds one imeta per photo inside", async () => {
    const wraps = await wrapDmMessage(localSigner(sender.secretKey), sender.publicKey, [peer.publicKey], "two photos", photos);

    for (const identity of [peer, sender]) {
      const wrap = wraps.find((w) => w.tags[0][1] === identity.publicKey)!;
      const rumor = await unwrapGiftWrap(localSigner(identity.secretKey), wrap);

      expect(rumor.content).toBe("two photos");
      expect(parseDmImetaTags(rumor.tags)).toEqual(
        photos.map((photo) => ({
          url: photo.descriptor.url,
          sha256: photo.descriptor.sha256,
          size: photo.descriptor.size,
          originalMime: "image/jpeg",
          key: photo.encrypted.key,
        })),
      );
    }
  });
});
