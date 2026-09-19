import { nip19 } from "nostr-tools";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ProfileStore, type Profile } from "../../lib/profileStore";
import type { RelayClient } from "../../lib/relay";

export type { Profile };

/** React's view of the kind 0 profiles this pane needs — the lookup itself lives in
 * `ProfileStore`, which holds exactly one subscription and releases it on unmount. */
export function useProfiles(client: RelayClient): {
  profiles: Map<string, Profile>;
  ensure: (pubkeys: string[]) => void;
} {
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

/** The signed-in Identity's own name: a neutral "…" until the relay answers, so the footer
 * never flashes a key where every other session already shows the name — then the same short
 * npub as the rest of the UI when there turned out to be no kind 0 (#196). */
export function ownDisplayName(profiles: Map<string, Profile>, pubkey: string | null): string {
  if (pubkey === null || !profiles.has(pubkey)) return "…";
  return displayName(profiles, pubkey);
}
