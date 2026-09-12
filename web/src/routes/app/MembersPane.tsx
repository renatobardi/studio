import type { VerifiedEvent } from "nostr-tools";
import { useEffect, useState } from "react";
import type { RelayClient } from "../../lib/relay";
import { MemberProfile } from "./MemberProfile";
import { MemberRow } from "./MemberRow";
import { useProfiles } from "./useProfiles";

/** Channel Members from the kind 39002 projection (ADR-0002) — a `d`-addressable event the
 * control plane re-publishes on every membership change, so the latest one is the roster.
 * Every row opens that Member's profile: reading someone else's kind 0 is not an
 * administrative act, so it is not behind the admin console (#47). */
export function MembersPane({ client, channelId }: Readonly<{ client: RelayClient; channelId: string }>) {
  const [memberPubkeys, setMemberPubkeys] = useState<string[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const { profiles, ensure } = useProfiles(client);

  useEffect(() => {
    const unsubscribe = client.subscribe([{ kinds: [39002], "#d": [channelId] }], {
      onEvent: (event: VerifiedEvent) => {
        const pubkeys = event.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]);
        setMemberPubkeys(pubkeys);
      },
    });
    return unsubscribe;
  }, [client, channelId]);

  useEffect(() => ensure(memberPubkeys), [memberPubkeys, ensure]);

  return (
    <aside className="side-pane" aria-label="Channel members" data-testid="members-pane">
      <h2 className="side-pane-title">Members</h2>
      {viewing ? (
        <MemberProfile client={client} pubkey={viewing} onClose={() => setViewing(null)} />
      ) : (
        <ul className="member-list">
          {memberPubkeys.map((pubkey) => (
            <li key={pubkey}>
              <MemberRow
                pubkey={pubkey}
                profiles={profiles}
                onClick={() => setViewing(pubkey)}
                testId="member-list-item"
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
