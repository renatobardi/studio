import type { WorkspaceMemberOut } from "../../lib/api";
import { Avatar } from "./Avatar";
import { displayName, type useProfiles } from "./useProfiles";

/** Picks the Workspace Member to start a Direct Message with — name and avatar, never a
 * pubkey to paste. The MVP flow has no alternative path on purpose (#47): the server is
 * still what authorises the wrap, but nothing in the UI invites addressing a stranger. */
export function MemberPicker({
  members,
  profiles,
  onPick,
}: Readonly<{
  members: WorkspaceMemberOut[];
  profiles: ReturnType<typeof useProfiles>["profiles"];
  onPick: (pubkey: string) => void;
}>) {
  if (members.length === 0) {
    return (
      <p className="meta" data-testid="dm-member-picker-empty">
        You're the only Member of this Workspace so far.
      </p>
    );
  }

  return (
    <ul className="member-list" data-testid="dm-member-picker">
      {members.map((member) => (
        <li key={member.pubkey}>
          <button
            className="channel-list-item"
            onClick={() => onPick(member.pubkey)}
            data-testid="dm-member-option"
            data-pubkey={member.pubkey}
          >
            <span className="member-row">
              <Avatar profile={profiles.get(member.pubkey)} name={displayName(profiles, member.pubkey)} />
              <span className="channel-list-name">{displayName(profiles, member.pubkey)}</span>
            </span>
            <span className="meta">{member.role}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
