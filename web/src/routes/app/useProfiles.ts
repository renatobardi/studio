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
  const profiles = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { profiles, ensure: store.ensure };
}

export function displayName(profiles: Map<string, Profile>, pubkey: string): string {
  return profiles.get(pubkey)?.name || `${pubkey.slice(0, 8)}…`;
}
