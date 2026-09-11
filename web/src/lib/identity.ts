import { finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";

export interface Identity {
  secretKey: Uint8Array;
  publicKey: string;
}

export function generateIdentity(): Identity {
  const secretKey = generateSecretKey();
  return { secretKey, publicKey: getPublicKey(secretKey) };
}

export function nsecFromSecretKey(secretKey: Uint8Array): string {
  return nip19.nsecEncode(secretKey);
}

export function secretKeyFromNsec(nsec: string): Uint8Array {
  const { type, data } = nip19.decode(nsec);
  if (type !== "nsec") throw new Error(`expected nsec, got ${type}`);
  return data;
}

export interface Profile {
  name: string;
  picture?: string;
  about?: string;
}

/** Unsigned kind:0 template — usable with any Signer (custody.ts), including NIP-07, not just a raw secret key. */
export function profileEventTemplate(profile: Profile) {
  return { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(profile) };
}

export function buildProfileEvent(secretKey: Uint8Array, profile: Profile): VerifiedEvent {
  return finalizeEvent(profileEventTemplate(profile), secretKey);
}

export function buildRelayListEvent(secretKey: Uint8Array, relayUrls: string[]): VerifiedEvent {
  return finalizeEvent(
    {
      kind: 10050,
      created_at: Math.floor(Date.now() / 1000),
      tags: relayUrls.map((url) => ["relay", url]),
      content: "",
    },
    secretKey,
  );
}

/** kind 10063 (BUD-03): the user's media servers, so other clients know where to fetch blobs from. */
export function buildServerListEvent(secretKey: Uint8Array, serverUrls: string[]): VerifiedEvent {
  return finalizeEvent(
    {
      kind: 10063,
      created_at: Math.floor(Date.now() / 1000),
      tags: serverUrls.map((url) => ["server", url]),
      content: "",
    },
    secretKey,
  );
}
