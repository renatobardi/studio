import { useEffect, useState } from "react";
import type { Signer } from "../../lib/custody";
import { unwrapGiftWrap, type Rumor } from "../../lib/nip17";
import type { RelayClient } from "../../lib/relay";

/** Every Direct Message gift wrap addressed to `myPubkey` (ticket #7), unwrapped as it arrives.
 * A gift wrap that fails to unwrap (foreign ciphertext, tampered seal) is silently skipped —
 * the relay already restricts delivery to the `p`-tagged recipient, so this is defense in depth,
 * not the normal case. */
export function useDirectMessages(client: RelayClient, signer: Signer, myPubkey: string) {
  const [rumors, setRumors] = useState<Map<string, Rumor>>(new Map());

  useEffect(() => {
    const unsubscribe = client.subscribe([{ kinds: [1059], "#p": [myPubkey] }], {
      onEvent: (wrap) => {
        unwrapGiftWrap(signer, wrap)
          .then((rumor) => {
            setRumors((prev) => (prev.has(rumor.id) ? prev : new Map(prev).set(rumor.id, rumor)));
          })
          .catch(() => {});
      },
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signer identity is stable for the session
  }, [client, myPubkey]);

  return [...rumors.values()];
}
