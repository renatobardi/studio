import { useEffect, useState } from "react";
import { Icon } from "../../components/icons/Icon";
import type { WorkspaceMemberOut } from "../../lib/api";
import type { Signer } from "../../lib/custody";
import { addMemberToChannel, membersPaneList, type MemberSearch } from "../../lib/memberDirectory";
import type { RelayClient } from "../../lib/relay";
import { MemberCandidates } from "./MemberCandidates";
import { MemberGroup } from "./MemberGroup";
import { MemberProfile } from "./MemberProfile";
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
  workspaceMembersError,
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
  /** Why the Workspace list could not be read: without it every role falls back to Member and
   * Agents are not told apart, so the pane has to say so (#197). */
  workspaceMembersError: string | null;
  canManage: boolean;
  overlay?: boolean;
  onClose: () => void;
}>) {
  const [viewing, setViewing] = useState<string | null>(null);
  const [search, setSearch] = useState<MemberSearch>({ query: "", error: null });
  const { profiles, ensure } = useProfiles(client);

  useEffect(() => ensure(memberPubkeys), [memberPubkeys, ensure]);
  useEffect(() => ensure(workspaceMembers.map((m) => m.pubkey)), [workspaceMembers, ensure]);

  const listing = membersPaneList(memberPubkeys, workspaceMembers, channelAdmins, search.query, (pubkey) =>
    profileName(profiles, pubkey),
  );
  const add = async (pubkey: string) =>
    setSearch(await addMemberToChannel(search, slug, channelId, pubkey, signer));

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
                  value={search.query}
                  onChange={(e) => setSearch({ ...search, query: e.target.value })}
                  aria-label="Add people and agents"
                  placeholder="Add people and agents"
                />
              </label>
            </div>
          )}
          <div className="members-pane-scroll">
            {workspaceMembersError && <div className="error-banner">{workspaceMembersError}</div>}
            {search.error && <div className="error-banner">{search.error}</div>}
            {listing.mode === "candidates" ? (
              <MemberCandidates candidates={listing.candidates} profiles={profiles} onAdd={(pubkey) => void add(pubkey)} />
            ) : (
              <>
                <MemberGroup label="People" entries={listing.people} profiles={profiles} onView={setViewing} />
                {listing.agents.length > 0 && (
                  <MemberGroup label="Agents" entries={listing.agents} profiles={profiles} onView={setViewing} />
                )}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
