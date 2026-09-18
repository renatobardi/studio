import type { ChannelMemberEntry } from "../../lib/memberDirectory";
import { MemberRow } from "./MemberRow";
import type { useProfiles } from "./useProfiles";

/** One group of the members pane's roster — the prototype's PEOPLE and AGENTS: a label over
 * rows that read the Member's name and the role that governs them here (#145). */
export function MemberGroup({
  label,
  entries,
  profiles,
  onView,
}: Readonly<{
  label: string;
  entries: ChannelMemberEntry[];
  profiles: ReturnType<typeof useProfiles>["profiles"];
  onView: (pubkey: string) => void;
}>) {
  return (
    <section>
      <p className="members-group-label">{label}</p>
      <ul className="member-list members-pane-list">
        {entries.map(({ pubkey, role }) => (
          <li key={pubkey}>
            <MemberRow
              pubkey={pubkey}
              profiles={profiles}
              onClick={() => onView(pubkey)}
              testId="member-list-item"
              subtitle={role}
              agent={role === "Agent"}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
