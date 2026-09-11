import { describe, expect, test } from "bun:test";
import { finalizeEvent, nip44, type EventTemplate } from "nostr-tools";
import type { Signer } from "./custody";
import { generateIdentity } from "./identity";
import {
  DM_RUMOR,
  GIFT_WRAP,
  buildDmRumor,
  conversationKey,
  giftWrapForAll,
  giftWrapForRecipient,
  unwrapGiftWrap,
} from "./nip17";

/** A real local-custody signer (mirrors `custody.ts`'s local branch) — actually does NIP-44
 * encryption/decryption, not a stub, so these tests exercise the real crypto round trip. */
function localSigner(secretKey: Uint8Array, publicKey: string): Signer {
  return {
    async getPublicKey() {
      return publicKey;
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

describe("giftWrapForRecipient / unwrapGiftWrap", () => {
  test("the recipient can unwrap a gift wrap addressed to them", async () => {
    const sender = generateIdentity();
    const recipient = generateIdentity();
    const senderSigner = localSigner(sender.secretKey, sender.publicKey);
    const recipientSigner = localSigner(recipient.secretKey, recipient.publicKey);
    const rumor = buildDmRumor(sender.publicKey, [recipient.publicKey], "hi there");

    const wrap = await giftWrapForRecipient(senderSigner, rumor, recipient.publicKey);
    const unwrapped = await unwrapGiftWrap(recipientSigner, wrap);

    expect(unwrapped).toEqual(rumor);
  });

  test("the gift wrap is signed by a random pubkey, not the sender's own", async () => {
    const sender = generateIdentity();
    const recipient = generateIdentity();
    const rumor = buildDmRumor(sender.publicKey, [recipient.publicKey], "hi");

    const wrap = await giftWrapForRecipient(localSigner(sender.secretKey, sender.publicKey), rumor, recipient.publicKey);

    expect(wrap.pubkey).not.toBe(sender.publicKey);
    expect(wrap.kind).toBe(GIFT_WRAP);
  });

  test("two gift wraps of the same rumor to the same recipient are not identical (randomized created_at)", async () => {
    const sender = generateIdentity();
    const recipient = generateIdentity();
    const senderSigner = localSigner(sender.secretKey, sender.publicKey);
    const rumor = buildDmRumor(sender.publicKey, [recipient.publicKey], "hi");

    const [a, b] = await Promise.all([
      giftWrapForRecipient(senderSigner, rumor, recipient.publicKey),
      giftWrapForRecipient(senderSigner, rumor, recipient.publicKey),
    ]);

    expect(a.id).not.toBe(b.id);
    expect(a.content).not.toBe(b.content);
  });

  test("a wrong-recipient signer cannot unwrap it", async () => {
    const sender = generateIdentity();
    const recipient = generateIdentity();
    const stranger = generateIdentity();
    const rumor = buildDmRumor(sender.publicKey, [recipient.publicKey], "hi");
    const wrap = await giftWrapForRecipient(localSigner(sender.secretKey, sender.publicKey), rumor, recipient.publicKey);

    await expect(unwrapGiftWrap(localSigner(stranger.secretKey, stranger.publicKey), wrap)).rejects.toThrow();
  });

  test("extra tags (e.g. a blob sha256 for a photo) land on the outer gift wrap", async () => {
    const sender = generateIdentity();
    const recipient = generateIdentity();
    const rumor = buildDmRumor(sender.publicKey, [recipient.publicKey], "");

    const wrap = await giftWrapForRecipient(
      localSigner(sender.secretKey, sender.publicKey), rumor, recipient.publicKey, [["x", "a".repeat(64)]],
    );

    expect(wrap.tags).toContainEqual(["x", "a".repeat(64)]);
    expect(wrap.tags).toContainEqual(["p", recipient.publicKey]);
  });
});

describe("giftWrapForAll", () => {
  test("wraps once per participant plus once for the sender", async () => {
    const sender = generateIdentity();
    const alice = generateIdentity();
    const bob = generateIdentity();
    const senderSigner = localSigner(sender.secretKey, sender.publicKey);
    const rumor = buildDmRumor(sender.publicKey, [alice.publicKey, bob.publicKey], "group hi");

    const wraps = await giftWrapForAll(senderSigner, sender.publicKey, rumor, [alice.publicKey, bob.publicKey]);

    expect(wraps).toHaveLength(3);
    const recipientPubkeys = wraps.map((w) => w.tags.find((t) => t[0] === "p")?.[1]).sort();
    expect(recipientPubkeys).toEqual([alice.publicKey, bob.publicKey, sender.publicKey].sort());
  });

  test("the sender's own self-copy unwraps to the same rumor", async () => {
    const sender = generateIdentity();
    const recipient = generateIdentity();
    const senderSigner = localSigner(sender.secretKey, sender.publicKey);
    const rumor = buildDmRumor(sender.publicKey, [recipient.publicKey], "remember this");

    const wraps = await giftWrapForAll(senderSigner, sender.publicKey, rumor, [recipient.publicKey]);
    const selfWrap = wraps.find((w) => w.tags.find((t) => t[0] === "p")?.[1] === sender.publicKey)!;
    const unwrapped = await unwrapGiftWrap(senderSigner, selfWrap);

    expect(unwrapped).toEqual(rumor);
  });
});

describe("buildDmRumor", () => {
  const senderPk = generateIdentity().publicKey;
  const alicePk = generateIdentity().publicKey;
  const bobPk = generateIdentity().publicKey;

  test("tags every participant except the sender", () => {
    const rumor = buildDmRumor(senderPk, [alicePk, bobPk], "hi");

    expect(rumor.kind).toBe(DM_RUMOR);
    expect(rumor.tags).toEqual([["p", alicePk], ["p", bobPk]]);
    expect(rumor.pubkey).toBe(senderPk);
  });

  test("carries extra tags, e.g. a photo's imeta", () => {
    const rumor = buildDmRumor(senderPk, [alicePk], "", [["imeta", "url https://x"]]);

    expect(rumor.tags).toContainEqual(["imeta", "url https://x"]);
  });
});

describe("conversationKey", () => {
  test("is the same regardless of participant order", () => {
    expect(conversationKey(["a", "b"])).toBe(conversationKey(["b", "a"]));
  });

  test("de-duplicates repeated pubkeys", () => {
    expect(conversationKey(["a", "b", "a"])).toBe(conversationKey(["a", "b"]));
  });

  test("differs for a different participant set", () => {
    expect(conversationKey(["a", "b"])).not.toBe(conversationKey(["a", "c"]));
  });
});
