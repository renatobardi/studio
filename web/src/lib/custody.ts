import { del, get, set } from "idb-keyval";
import { finalizeEvent, getPublicKey, nip44, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import { secretKeyFromNsec } from "./identity";
import type { ReadState } from "./unread";
import { clearMediaCache } from "./mediaCache";

const STORE_KEY = "studio.identity.nsec";
const WORKSPACE_SLUG_KEY = "studio.identity.workspaceSlug";
const CHANNEL_ID_KEY = "studio.identity.channelId";
const CHANNEL_READ_KEY = "studio.identity.channelReadAt";

/** True when a NIP-07 extension (window.nostr) is present — it always wins over local custody. */
export function hasNip07(): boolean {
  return typeof window !== "undefined" && "nostr" in window;
}

/** A NIP-07 extension's `window.nostr` shape for the NIP-44 methods, when it supports them. */
interface Nip07Nostr extends Signer {
  nip44?: { encrypt(pubkey: string, plaintext: string): Promise<string>; decrypt(pubkey: string, ciphertext: string): Promise<string> };
}

export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate): Promise<VerifiedEvent>;
  /** NIP-44 encrypt/decrypt with `pubkey` as the other party — required for Direct Messages
   * (NIP-17). Never exposes the raw secret key: a NIP-07 extension keeps it, and local
   * custody derives the conversation key internally. */
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>;
}

/** Stores the nsec in IndexedDB. No-op (and should not be called) when a NIP-07 extension exists. */
export async function storeIdentity(nsec: string): Promise<void> {
  await set(STORE_KEY, nsec);
}

/**
 * Wipes the locally-stored key and every trace of the session, e.g. on
 * sign-out — the cached media included. Does not touch a NIP-07 extension's
 * own storage.
 */
export async function clearIdentity(): Promise<void> {
  await del(STORE_KEY);
  await del(WORKSPACE_SLUG_KEY);
  await del(CHANNEL_ID_KEY);
  await del(CHANNEL_READ_KEY);
  await clearMediaCache();
}

/**
 * Remembers which Workspace this Identity last connected to, so a page
 * reload can re-fetch it (GET /api/workspaces/{slug}) instead of needing
 * the invite flow again.
 */
export async function storeWorkspaceSlug(slug: string): Promise<void> {
  await set(WORKSPACE_SLUG_KEY, slug);
}

export async function loadWorkspaceSlug(): Promise<string | undefined> {
  return get<string>(WORKSPACE_SLUG_KEY);
}

/** Remembers which Channel was open, so the app can open directly on it next launch. */
export async function storeChannelId(channelId: string): Promise<void> {
  await set(CHANNEL_ID_KEY, channelId);
}

export async function loadChannelId(): Promise<string | undefined> {
  return get<string>(CHANNEL_ID_KEY);
}

/**
 * Remembers how far each Channel has been read, so unread survives a reload
 * instead of restarting from "everything since this tab opened" (#42).
 */
export async function storeChannelReadAt(readAt: ReadState): Promise<void> {
  await set(CHANNEL_READ_KEY, readAt);
}

export async function loadChannelReadAt(): Promise<ReadState> {
  return (await get<ReadState>(CHANNEL_READ_KEY)) ?? {};
}

async function loadStoredNsec(): Promise<string | undefined> {
  return get<string>(STORE_KEY);
}

/**
 * Returns a signer: the NIP-07 extension when present, otherwise the nsec
 * stored locally in IndexedDB. Returns null when neither is available.
 */
export async function getSigner(): Promise<Signer | null> {
  if (hasNip07()) {
    const nostr = (window as unknown as { nostr: Nip07Nostr }).nostr;
    return {
      getPublicKey: () => nostr.getPublicKey(),
      signEvent: (template) => nostr.signEvent(template),
      nip44Encrypt(pubkey, plaintext) {
        if (!nostr.nip44) throw new Error("this NIP-07 extension does not support NIP-44 encryption");
        return nostr.nip44.encrypt(pubkey, plaintext);
      },
      nip44Decrypt(pubkey, ciphertext) {
        if (!nostr.nip44) throw new Error("this NIP-07 extension does not support NIP-44 encryption");
        return nostr.nip44.decrypt(pubkey, ciphertext);
      },
    };
  }
  const nsec = await loadStoredNsec();
  if (!nsec) return null;
  const secretKey = secretKeyFromNsec(nsec);
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

export async function hasStoredIdentity(): Promise<boolean> {
  if (hasNip07()) return true;
  return (await loadStoredNsec()) !== undefined;
}
