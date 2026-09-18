import type { User } from "firebase/auth";
import { useState } from "react";
import { needsAccountPassword } from "../../lib/backup";
import {
  confirmKeyBackup,
  downloadKeyBackup,
  keyBackupHeading,
  keyBackupStep,
  requestKeyBackup,
  runKeyBackupStep,
} from "../../lib/keyBackup";
import { isActivationKey, isOutsideClick } from "../../lib/signOut";
import { Icon } from "../../components/icons/Icon";
import { AccountPasswordGate } from "../onboarding/AccountPasswordGate";
import { BackupPassphraseCard, BackupVerifyCard } from "../onboarding/KeyBackupSteps";

/**
 * "Manage", from Settings › Profile's Private key backup row (#150): the onboarding Key Backup
 * steps again, for the key this browser already holds — so somebody who skipped the backup, or
 * lost the file, can make a new one without signing out. Same cards, same rules as the first
 * time (#31, #36): the passphrase must differ from the Account password, and nothing reaches
 * the server until it has been proved to unlock the file.
 */
export function KeyBackupDialog({
  user,
  accountPassword,
  pubkey,
  onClose,
  onStored,
}: Readonly<{
  user: User;
  accountPassword: string | null;
  /** The Identity this browser signs with — what the backup has to decrypt to. */
  pubkey: string;
  onClose: () => void;
  onStored: () => void;
}>) {
  const [knownPassword, setKnownPassword] = useState<string | null>(accountPassword);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [verifyPassphrase, setVerifyPassphrase] = useState("");
  const [blob, setBlob] = useState<Uint8Array | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mustConfirmAccountPassword = needsAccountPassword(
    user.providerData.map((provider) => provider.providerId),
    knownPassword,
  );
  const step = keyBackupStep(blob, verified);
  const heading = keyBackupHeading(step);

  const report = { busy: setBusy, error: setError };

  const handleCreate = () =>
    runKeyBackupStep(
      () =>
        requestKeyBackup({
          passphrase,
          confirm: passphraseConfirm,
          accountPassword: knownPassword,
          onCreated: setBlob,
        }),
      report,
    );

  const handleVerify = () =>
    blob &&
    runKeyBackupStep(
      () =>
        confirmKeyBackup({
          blob,
          passphrase: verifyPassphrase,
          pubkey,
          getIdToken: () => user.getIdToken(),
          onUnlocked: () => setVerified(true),
          onStored,
        }),
      report,
    );

  return (
    // The backdrop closes on a click that landed on the backdrop itself, so the dialog inside
    // it needs no stopPropagation; the keyboard equivalent of that click sits beside it. Escape
    // is deliberately not wired here — this dialog can be holding a backup file that has not
    // been verified yet, and the two other dialogs' Escape-to-close would drop it.
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (isOutsideClick(event)) onClose();
      }}
      onKeyDown={(event) => {
        if (isOutsideClick(event) && isActivationKey(event)) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-backup-title"
        data-testid="key-backup-dialog"
      >
        <div className="dialog-header">
          <button className="dialog-close" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="x" size={16} />
          </button>
          <h2 id="key-backup-title" className="dialog-title">
            {heading.title}
          </h2>
          <p className="dialog-description">{heading.description}</p>
        </div>
        <div className="dialog-body">
          {error && <div className="error-banner">{error}</div>}
          {mustConfirmAccountPassword ? (
            <AccountPasswordGate user={user} onConfirmed={setKnownPassword} />
          ) : blob ? (
            <BackupVerifyCard
              verified={verified}
              passphrase={verifyPassphrase}
              onPassphrase={setVerifyPassphrase}
              busy={busy}
              onVerify={handleVerify}
            />
          ) : (
            <BackupPassphraseCard
              passphrase={passphrase}
              confirm={passphraseConfirm}
              onPassphrase={setPassphrase}
              onConfirm={setPassphraseConfirm}
              busy={busy}
              onCreate={handleCreate}
            />
          )}
        </div>
        <div className="dialog-footer">
          {blob && (
            <button type="button" className="link" onClick={() => downloadKeyBackup(blob)}>
              Download backup file (optional)
            </button>
          )}
          <button className="btn btn-outline" onClick={onClose}>
            {verified ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
