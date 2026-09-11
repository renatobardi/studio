import type { VerifiedEvent } from "nostr-tools";
import { useEffect, useRef, useState } from "react";
import type { RelayClient } from "../../lib/relay";

export interface Profile {
  name?: string;
  picture?: string;
}

/** Resolves kind 0 profiles for whichever pubkeys are requested via `ensure`, caching them for
 * the lifetime of this hook. Subscribes once per not-yet-seen pubkey. */
export function useProfiles(client: RelayClient): {
  profiles: Map<string, Profile>;
  ensure: (pubkeys: string[]) => void;
} {
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const requested = useRef<Set<string>>(new Set());

  const ensure = (pubkeys: string[]) => {
    const missing = pubkeys.filter((pubkey) => !requested.current.has(pubkey));
    if (missing.length === 0) return;
    for (const pubkey of missing) requested.current.add(pubkey);
    client.subscribe([{ kinds: [0], authors: missing }], {
      onEvent: (event: VerifiedEvent) => {
        let parsed: Profile;
        try {
          parsed = JSON.parse(event.content) as Profile;
        } catch {
          return;
        }
        setProfiles((prev) => new Map(prev).set(event.pubkey, parsed));
      },
    });
  };

  useEffect(() => () => {
    requested.current.clear();
  }, []);

  return { profiles, ensure };
}

export function displayName(profiles: Map<string, Profile>, pubkey: string): string {
  return profiles.get(pubkey)?.name || `${pubkey.slice(0, 8)}…`;
}
