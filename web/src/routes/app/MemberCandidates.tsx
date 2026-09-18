import type { WorkspaceMemberOut } from "../../lib/api";
import { MemberRow } from "./MemberRow";
import type { useProfiles } from "./useProfiles";

/** What "Add people and agents" offers for what was typed: one row per Workspace Member the
 * Channel does not have yet, each of them an add (#145). A search that matches nobody says so
 * rather than leaving the pane blank. */
export function MemberCandidates({
  candidates,
  profiles,
  onAdd,
}: Readonly<{
  candidates: WorkspaceMemberOut[];
  profiles: ReturnType<typeof useProfiles>["profiles"];
  onAdd: (pubkey: string) => void;
}>) {
  if (candidates.length === 0) return <p className="meta members-add-empty">No Workspace Members match.</p>;
  return (
    <ul className="member-list members-pane-list" data-testid="member-add-options">
      {candidates.map((member) => (
        <li key={member.pubkey}>
          <MemberRow
            pubkey={member.pubkey}
            profiles={profiles}
            onClick={() => onAdd(member.pubkey)}
            testId="member-add-option"
            caption={{ text: "Add to this Channel", at: "subtitle" }}
            agent={member.role === "agent"}
          />
        </li>
      ))}
    </ul>
  );
}
