import { useState } from "react";
import { Icon } from "../../components/icons/Icon";
import { SIGN_OUT_PHRASE, signOutBlocker } from "../../lib/signOut";
import { Dialog } from "./Dialog";
import { useEscape } from "./useEscape";

/** The prototype's "sign-out" dialog (#148): wiping this device's Identity and data is only armed
 * once the backup is confirmed and the phrase typed. The private key the prototype shows in step 1
 * is left out — custody never hands the raw key to the UI (docs/UI/REFERENCE.md › Decisões). */
export function SignOutDialog({ onCancel, onConfirm }: Readonly<{ onCancel: () => void; onConfirm: () => void }>) {
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [phrase, setPhrase] = useState("");
  const blocker = signOutBlocker({ backupConfirmed, phrase });

  // Escape closes wherever the focus is, which the backdrop's own handler cannot see.
  useEscape(onCancel);

  return (
    <Dialog
      name="sign-out"
      title="Sign out and wipe all data?"
      description="This will delete your identity key and cached data from this device, then return Studio to sign-in. This cannot be undone."
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-destructive" onClick={onConfirm} disabled={blocker !== null}>
            Delete my data
          </button>
        </>
      }
    >
      <div className="sign-out-step">
        <p className="sign-out-label">1. Confirm you can restore your identity</p>
        <button
          className="sign-out-check"
          role="checkbox"
          aria-checked={backupConfirmed}
          onClick={() => setBackupConfirmed((confirmed) => !confirmed)}
        >
          <span className={`sign-out-box${backupConfirmed ? " checked" : ""}`}>
            {backupConfirmed && <Icon name="check" size={10} />}
          </span>
          <span>I have tested a key backup or saved my private key somewhere safe.</span>
        </button>
      </div>
      <div className="sign-out-step sign-out-phrase">
        <label className="sign-out-label" htmlFor="sign-out-phrase">
          2. Type “{SIGN_OUT_PHRASE}” to confirm
        </label>
        <input
          id="sign-out-phrase"
          className="input"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          placeholder={SIGN_OUT_PHRASE}
          autoComplete="off"
          spellCheck={false}
        />
        {blocker && <p className="sign-out-hint">{blocker}</p>}
      </div>
    </Dialog>
  );
}
