import { useEffect, useState } from "react";
import { Icon } from "../../components/icons/Icon";
import type { RelayClient } from "../../lib/relay";
import { MemberProfile } from "./MemberProfile";
import { MemberRow } from "./MemberRow";
import { useProfiles } from "./useProfiles";

/** Channel Members from the kind 39002 projection (ADR-0002), read by ChannelView so the
 * header pill can count them without a second subscription (#143).
 * Every row opens that Member's profile: reading someone else's kind 0 is not an
 * administrative act, so it is not behind the admin console (#47). */
export function MembersPane({
  client,
  memberPubkeys,
  overlay = false,
  onClose,
}: Readonly<{ client: RelayClient; memberPubkeys: string[]; overlay?: boolean; onClose: () => void }>) {
  const [viewing, setViewing] = useState<string | null>(null);
  const { profiles, ensure } = useProfiles(client);

  useEffect(() => ensure(memberPubkeys), [memberPubkeys, ensure]);

  return (
    <aside className={`side-pane${overlay ? " side-pane-overlay" : ""}`} aria-label="Channel members" data-testid="members-pane">
      <header className="pane-header side-pane-header">
        <h2 className="side-pane-title">Members</h2>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close members" title="Close members">
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="side-pane-scroll" data-list="true">
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
      </div>
    </aside>
  );
}
