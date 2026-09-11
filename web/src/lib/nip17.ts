import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  nip44,
  verifyEvent,
  type VerifiedEvent,
} from "nostr-tools";
import type { Signer } from "./custody";

export const DM_RUMOR = 14;
export const SEAL = 13;
export const GIFT_WRAP = 1059;

/** A NIP-59 rumor: an unsigned event (`id` is just its hash, no `sig`). */
export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;

/** A random fraction in [0, 1) from the Web Crypto CSPRNG — this is timestamp obfuscation, not
 * key material, but there's no reason to reach for `Math.random()`'s weaker generator here. */
function secureRandomFraction(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

/** NIP-59: the seal's and gift wrap's own `created_at` are randomized up to two days into the
 * past, so a relay can't correlate a DM's real send time from the outer events it can see. */
function randomPast(now = Math.floor(Date.now() / 1000)): number {
  return Math.round(now - secureRandomFraction() * TWO_DAYS_SECONDS);
}

/** kind 14: the Direct Message itself, addressed to every other participant (never the sender —
 * NIP-17 convention). `extraTags` carries e.g. a photo's `imeta` tag. */
export function buildDmRumor(
  senderPubkey: string,
  participantPubkeys: string[],
  content: string,
  extraTags: string[][] = [],
): Rumor {
  const unsigned = {
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: DM_RUMOR,
    tags: [...participantPubkeys.map((pubkey) => ["p", pubkey]), ...extraTags],
    content,
  };
  return { ...unsigned, id: getEventHash(unsigned) };
}

/** kind 13: the rumor, encrypted and signed by the sender's real Identity — this is what proves
 * authorship to the recipient once they decrypt it. */
async function sealRumor(signer: Signer, rumor: Rumor, recipientPubkey: string): Promise<VerifiedEvent> {
  const content = await signer.nip44Encrypt(recipientPubkey, JSON.stringify(rumor));
  return signer.signEvent({ kind: SEAL, content, created_at: randomPast(), tags: [] });
}

/** kind 1059: the seal, encrypted and signed by a throwaway one-time key — the relay and any
 * onlooker see only a random pubkey and ciphertext, never the sender's real Identity. */
function wrapSeal(seal: VerifiedEvent, recipientPubkey: string, extraTags: string[][]): VerifiedEvent {
  const ephemeralKey = generateSecretKey();
  const content = nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(ephemeralKey, recipientPubkey));
  return finalizeEvent(
    { kind: GIFT_WRAP, content, created_at: randomPast(), tags: [["p", recipientPubkey], ...extraTags] },
    ephemeralKey,
  );
}

/** Rumor → seal → gift wrap for a single recipient. */
export async function giftWrapForRecipient(
  signer: Signer,
  rumor: Rumor,
  recipientPubkey: string,
  extraTags: string[][] = [],
): Promise<VerifiedEvent> {
  const seal = await sealRumor(signer, rumor, recipientPubkey);
  return wrapSeal(seal, recipientPubkey, extraTags);
}

/** One gift wrap per participant, plus one to the sender's own pubkey — the sender's only way
 * to see their own sent Direct Messages from another device (no server-side history for them). */
export async function giftWrapForAll(
  signer: Signer,
  senderPubkey: string,
  rumor: Rumor,
  participantPubkeys: string[],
  extraTags: string[][] = [],
): Promise<VerifiedEvent[]> {
  const targets = [...new Set([...participantPubkeys, senderPubkey])];
  return Promise.all(targets.map((pubkey) => giftWrapForRecipient(signer, rumor, pubkey, extraTags)));
}

/** The inverse of `giftWrapForRecipient`: unwraps a kind 1059 the caller received (its `p` tag
 * matches their own pubkey), verifying the inner seal's signature along the way. */
export async function unwrapGiftWrap(
  signer: Signer,
  wrap: { pubkey: string; content: string },
): Promise<Rumor> {
  const sealJson = await signer.nip44Decrypt(wrap.pubkey, wrap.content);
  const seal = JSON.parse(sealJson) as VerifiedEvent;
  if (seal.kind !== SEAL) throw new Error(`unexpected seal kind ${seal.kind}, expected ${SEAL}`);
  if (!verifyEvent(seal)) throw new Error("seal signature is invalid");

  const rumorJson = await signer.nip44Decrypt(seal.pubkey, seal.content);
  const rumor = JSON.parse(rumorJson) as Rumor;
  if (rumor.pubkey !== seal.pubkey) {
    throw new Error("rumor pubkey does not match the seal's signer");
  }
  return rumor;
}

/** Groups a conversation by its full participant set (including the reader), so a DM to/from
 * the same two-or-more people always lands in one conversation regardless of who sent which
 * message. */
export function conversationKey(participantPubkeys: string[]): string {
  return [...new Set(participantPubkeys)].sort((a, b) => a.localeCompare(b)).join(",");
}
