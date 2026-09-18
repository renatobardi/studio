import { useEffect } from "react";
import { Icon } from "../../components/icons/Icon";
import type { WorkspaceMemberOut } from "../../lib/api";
import { isEscape, isOutsideClick } from "../../lib/signOut";
import { MemberPicker } from "./MemberPicker";
import type { useProfiles } from "./useProfiles";

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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => isEscape(event) && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => isOutsideClick(event) && onCancel()}
      onKeyDown={(event) => isEscape(event) && onCancel()}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-message-title" data-testid="new-message-dialog">
        <div className="dialog-header">
          <button className="dialog-close" onClick={onCancel} aria-label="Close" title="Close">
            <Icon name="x" size={16} />
          </button>
          <h2 id="new-message-title" className="dialog-title">
            New message
          </h2>
          <p className="dialog-description">Start a direct message with someone on this relay, or with one of your agents.</p>
        </div>
        <div className="dialog-body">
          {error && <div className="error-banner">{error}</div>}
          <MemberPicker members={members} profiles={profiles} onPick={onPick} />
        </div>
        <div className="dialog-footer">
          <button className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
