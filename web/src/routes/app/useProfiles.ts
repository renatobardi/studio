import { nip19 } from "nostr-tools";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ProfileStore, type Profile } from "../../lib/profileStore";
import type { RelayClient } from "../../lib/relay";

export type { Profile };

/** The kind 0 profiles known so far, and how to ask for more. */
export interface ProfileLookup {
  profiles: Map<string, Profile>;
  ensure: (pubkeys: string[]) => void;
}

/** React's view of the kind 0 profiles the app needs — the lookup itself lives in `ProfileStore`,
 * which holds exactly one subscription and releases it on unmount. Only the shell calls it: every
 * pane below reads the shell's `ProfileLookup`, so there is one kind 0 REQ, not one per pane (#195). */
export function useProfiles(client: RelayClient): ProfileLookup {
  const store = useMemo(() => new ProfileStore(client), [client]);
  useEffect(() => () => store.close(), [store]);
  // The third snapshot is what renderToStaticMarkup needs to render this outside a browser —
  // the app itself never hydrates, so it is the same snapshot.
  const profiles = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { profiles, ensure: store.ensure };
}

/** The published kind 0 name, or null when this Identity has none yet — the
 * distinction `displayName` erases, and which sorting a member list needs. */
export function profileName(profiles: Map<string, Profile>, pubkey: string): string | null {
  return profiles.get(pubkey)?.name || null;
}

/** A pubkey as the prototype shows one without a name: `npub1rb92…7ktz` — never hex. */
export function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 9)}…${npub.slice(-4)}`;
}

export function displayName(profiles: Map<string, Profile>, pubkey: string): string {
  return profiles.get(pubkey)?.name || shortNpub(pubkey);
}

/** The signed-in Identity's own name: a neutral "…" until its kind 0 arrives, so the
 * footer never flashes a key where every other session already shows the name. */
export function ownDisplayName(profiles: Map<string, Profile>, pubkey: string | null): string {
  return (pubkey && profileName(profiles, pubkey)) || "…";
}
