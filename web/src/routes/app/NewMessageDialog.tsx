import type { WorkspaceMemberOut } from "../../lib/api";
import { Dialog } from "./Dialog";
import { MemberPicker } from "./MemberPicker";
import type { useProfiles } from "./useProfiles";
import { useEscape } from "./useEscape";

/** The prototype's "new-message" dialog, opened by the "+" of the sidebar's Direct messages (#142).
 * Picking stays the Workspace member list (#47): one click on a Member opens the conversation, so
 * there is no "To" search nor "Start conversation" button (docs/UI/REFERENCE.md › Decisões). */
export function NewMessageDialog({
  members,
  profiles,
  error,
  onPick,
  onCancel,
}: Readonly<{
  members: WorkspaceMemberOut[];
  profiles: ReturnType<typeof useProfiles>["profiles"];
  error: string | null;
  onPick: (pubkey: string) => void;
  onCancel: () => void;
}>) {
  // Escape closes wherever the focus is, which the backdrop's own handler cannot see.
  useEscape(onCancel);

  return (
    <Dialog
      name="new-message"
      title="New message"
      description="Start a direct message with someone on this relay, or with one of your agents."
      onClose={onCancel}
      footer={
        <button className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
      }
    >
      {error && <div className="error-banner">{error}</div>}
      <MemberPicker members={members} profiles={profiles} onPick={onPick} />
    </Dialog>
  );
}
