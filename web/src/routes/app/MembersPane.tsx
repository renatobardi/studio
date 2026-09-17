import { useEffect, useState } from "react";
import { Icon } from "../../components/icons/Icon";
import { addChannelMember, authProof, type WorkspaceMemberOut } from "../../lib/api";
import type { Signer } from "../../lib/custody";
import { addableMembers, channelMemberGroups, type ChannelMemberEntry } from "../../lib/memberDirectory";
import type { RelayClient } from "../../lib/relay";
import { MemberProfile } from "./MemberProfile";
import { MemberRow } from "./MemberRow";
import { profileName, useProfiles } from "./useProfiles";

/** Channel Members from the kind 39002 projection (ADR-0002), read by ChannelView so the
 * header pill can count them without a second subscription (#143).
 * Every row opens that Member's profile: reading someone else's kind 0 is not an
 * administrative act, so it is not behind the admin console (#47).
 * Rows read `role` where the prototype reads `role · presence`: the MVP protocol has no presence
 * event (#145). "Add people and agents" is the admin console's add, offered to whoever the API
 * lets manage this Channel. */
export function MembersPane({
  client,
  signer,
  slug,
  channelId,
  memberPubkeys,
  channelAdmins,
  workspaceMembers,
  canManage,
  overlay = false,
  onClose,
}: Readonly<{
  client: RelayClient;
  signer: Signer;
  slug: string;
  channelId: string;
  memberPubkeys: string[];
  channelAdmins: string[];
  workspaceMembers: WorkspaceMemberOut[];
  canManage: boolean;
  overlay?: boolean;
  onClose: () => void;
}>) {
  const [viewing, setViewing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { profiles, ensure } = useProfiles(client);

  useEffect(() => ensure(memberPubkeys), [memberPubkeys, ensure]);
  useEffect(() => ensure(workspaceMembers.map((m) => m.pubkey)), [workspaceMembers, ensure]);

  const groups = channelMemberGroups(memberPubkeys, workspaceMembers, channelAdmins);
  const candidates = addableMembers(workspaceMembers, memberPubkeys, query, (pubkey) => profileName(profiles, pubkey));

  const add = async (pubkey: string) => {
    setError(null);
    try {
      const url = `${window.location.origin}/api/workspaces/${slug}/channels/${channelId}/members`;
      await addChannelMember(slug, channelId, pubkey, "member", await authProof(url, "POST", signer));
      setQuery("");
    } catch {
      setError("Couldn't add that Member.");
    }
  };

  const group = (label: string, entries: ChannelMemberEntry[]) => (
    <section>
      <p className="members-group-label">{label}</p>
      <ul className="member-list members-pane-list">
        {entries.map(({ pubkey, role }) => (
          <li key={pubkey}>
            <MemberRow
              pubkey={pubkey}
              profiles={profiles}
              onClick={() => setViewing(pubkey)}
              testId="member-list-item"
              subtitle={role}
              agent={role === "Agent"}
            />
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <aside className={`side-pane${overlay ? " side-pane-overlay" : ""}`} aria-label="Channel members" data-testid="members-pane">
      <header className="members-pane-header">
        <h2 className="members-pane-title">Channel members</h2>
        <button className="members-pane-close" onClick={onClose} aria-label="Close members" title="Close members">
          <Icon name="x" size={14} />
        </button>
      </header>
      {viewing ? (
        <div className="side-pane-scroll">
          <MemberProfile client={client} pubkey={viewing} onClose={() => setViewing(null)} />
        </div>
      ) : (
        <>
          {canManage && (
            <div className="members-add">
              <label className="members-add-field">
                <Icon name="user-plus" size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Add people and agents"
                  placeholder="Add people and agents"
                />
              </label>
            </div>
          )}
          <div className="members-pane-scroll">
            {error && <div className="error-banner">{error}</div>}
            {query.trim() ? (
              candidates.length > 0 ? (
                <ul className="member-list members-pane-list" data-testid="member-add-options">
                  {candidates.map((member) => (
                    <li key={member.pubkey}>
                      <MemberRow
                        pubkey={member.pubkey}
                        profiles={profiles}
                        onClick={() => void add(member.pubkey)}
                        testId="member-add-option"
                        subtitle="Add to this Channel"
                        agent={member.role === "agent"}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta members-add-empty">No Workspace Members match.</p>
              )
            ) : (
              <>
                {group("People", groups.people)}
                {groups.agents.length > 0 && group("Agents", groups.agents)}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
