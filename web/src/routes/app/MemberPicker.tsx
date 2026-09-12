import type { WorkspaceMemberOut } from "../../lib/api";
import { MemberRow } from "./MemberRow";
import type { useProfiles } from "./useProfiles";

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
          <MemberRow
            pubkey={member.pubkey}
            profiles={profiles}
            onClick={() => onPick(member.pubkey)}
            testId="dm-member-option"
            trailing={member.role}
          />
        </li>
      ))}
    </ul>
  );
}
