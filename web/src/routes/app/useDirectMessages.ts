import { useEffect, useMemo, useSyncExternalStore } from "react";
import { nowSeconds } from "../../lib/clock";
import type { Signer } from "../../lib/custody";
import { DmFeed, type DmSnapshot } from "../../lib/dmFeed";
import { unwrapGiftWrap } from "../../lib/nip17";
import type { RelayClient } from "../../lib/relay";

const NOTHING: DmSnapshot = { rumors: [], hasMore: false, completeFrom: -Infinity, pages: 0, loadOlder: () => {} };
const noSubscription = () => () => {};
const nothing = () => NOTHING;

/** React's view of the caller's Direct Messages (ticket #7), paged by gift wrap (#185) — the stream
 * itself lives in `DmFeed`. Nothing until the own pubkey is known. The snapshot as it comes: the
 * same object until the feed changes, so the shell's conversations are not redone per render (#194). */
export function useDirectMessages(client: RelayClient, signer: Signer, ownPubkey: string | null) {
  const feed = useMemo(
    () => (ownPubkey === null ? null : new DmFeed(client, ownPubkey, (wrap) => unwrapGiftWrap(signer, wrap), nowSeconds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signer identity is stable for the session
    [client, ownPubkey],
  );
  useEffect(() => feed?.start(), [feed]);
  const snapshot = useSyncExternalStore(feed?.subscribe ?? noSubscription, feed?.getSnapshot ?? nothing, feed?.getSnapshot ?? nothing);
  return snapshot;
}
