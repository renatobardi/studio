import { useEffect, useState } from "react";
import { Icon } from "../../components/icons/Icon";
import { SIGN_OUT_PHRASE, signOutBlocker } from "../../lib/signOut";

/** The prototype's "sign-out" dialog (#148): wiping this device's Identity and data is only armed
 * once the backup is confirmed and the phrase typed. The private key the prototype shows in step 1
 * is left out — custody never hands the raw key to the UI (docs/UI/REFERENCE.md › Decisões). */
export function SignOutDialog({ onCancel, onConfirm }: Readonly<{ onCancel: () => void; onConfirm: () => void }>) {
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [phrase, setPhrase] = useState("");
  const blocker = signOutBlocker({ backupConfirmed, phrase });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-out-title"
        onClick={(event) => event.stopPropagation()}
        data-testid="sign-out-dialog"
      >
        <div className="dialog-header">
          <button className="dialog-close" onClick={onCancel} aria-label="Close" title="Close">
            <Icon name="x" size={16} />
          </button>
          <h2 id="sign-out-title" className="dialog-title">
            Sign out and wipe all data?
          </h2>
          <p className="dialog-description">
            This will delete your identity key and cached data from this device, then return Studio to sign-in. This
            cannot be undone.
          </p>
        </div>
        <div className="dialog-body">
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
        </div>
        <div className="dialog-footer">
          <button className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-destructive" onClick={onConfirm} disabled={blocker !== null}>
            Delete my data
          </button>
        </div>
      </div>
    </div>
  );
}
