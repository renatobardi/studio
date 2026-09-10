import { del, get, set } from "idb-keyval";
import { finalizeEvent, getPublicKey, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import { secretKeyFromNsec } from "./identity";

const STORE_KEY = "studio.identity.nsec";
const WORKSPACE_SLUG_KEY = "studio.identity.workspaceSlug";

/** True when a NIP-07 extension (window.nostr) is present — it always wins over local custody. */
export function hasNip07(): boolean {
  return typeof window !== "undefined" && "nostr" in window;
}

export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate): Promise<VerifiedEvent>;
}

/** Stores the nsec in IndexedDB. No-op (and should not be called) when a NIP-07 extension exists. */
export async function storeIdentity(nsec: string): Promise<void> {
  await set(STORE_KEY, nsec);
}

/** Wipes the locally-stored key, e.g. on sign-out. Does not touch a NIP-07 extension's own storage. */
export async function clearIdentity(): Promise<void> {
  await del(STORE_KEY);
  await del(WORKSPACE_SLUG_KEY);
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

async function loadStoredNsec(): Promise<string | undefined> {
  return get<string>(STORE_KEY);
}

/**
 * Returns a signer: the NIP-07 extension when present, otherwise the nsec
 * stored locally in IndexedDB. Returns null when neither is available.
 */
export async function getSigner(): Promise<Signer | null> {
  if (hasNip07()) {
    const nostr = (window as unknown as { nostr: Signer }).nostr;
    return nostr;
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
  };
}

export async function hasStoredIdentity(): Promise<boolean> {
  if (hasNip07()) return true;
  return (await loadStoredNsec()) !== undefined;
}
