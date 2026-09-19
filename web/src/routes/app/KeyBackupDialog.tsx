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
import { AccountPasswordGate } from "../onboarding/AccountPasswordGate";
import { BackupPassphraseCard, BackupVerifyCard } from "../onboarding/KeyBackupSteps";
import { Dialog } from "./Dialog";

/**
 * "Manage", from Settings › Profile's Private key backup row (#150): the onboarding Key Backup
 * steps again, for the key this browser already holds — so somebody who skipped the backup, or
 * lost the file, can make a new one without signing out. Same cards, same rules as the first
 * time (#31, #36): the passphrase must differ from the Account password, and nothing reaches
 * the server until it has been proved to unlock the file.
 */
export function KeyBackupDialog({
  user,
  pubkey,
  onClose,
  onStored,
}: Readonly<{
  user: User;
  /** The Identity this browser signs with — what the backup has to decrypt to. */
  pubkey: string;
  onClose: () => void;
  onStored: () => void;
}>) {
  // Asked for here, never handed down: the signed-in app holds no Account password (#189).
  const [knownPassword, setKnownPassword] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [verifyPassphrase, setVerifyPassphrase] = useState("");
  const [blob, setBlob] = useState<Uint8Array | null>(null);
  const [verified, setVerified] = useState(false);
  const [stored, setStored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mustConfirmAccountPassword = needsAccountPassword(
    user.providerData.map((provider) => provider.providerId),
    knownPassword,
  );
  const step = keyBackupStep(blob, verified, stored);
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
          onStored: () => {
            setStored(true);
            onStored();
          },
        }),
      report,
    );

  return (
    // Escape is deliberately not wired here — this dialog can be holding a backup file that has
    // not been verified yet, and the two other dialogs' Escape-to-close would drop it.
    <Dialog
      name="key-backup"
      title={heading.title}
      description={heading.description}
      onClose={onClose}
      escapeCloses={false}
      footer={
        <>
          {blob && (
            <button type="button" className="link" onClick={() => downloadKeyBackup(blob)}>
              Download backup file (optional)
            </button>
          )}
          <button className="btn btn-outline" onClick={onClose}>
            {step === "verified" ? "Done" : "Cancel"}
          </button>
        </>
      }
    >
      {error && <div className="error-banner">{error}</div>}
      {mustConfirmAccountPassword ? (
        <AccountPasswordGate user={user} onConfirmed={setKnownPassword} />
      ) : blob ? (
        <BackupVerifyCard
          verified={verified}
          unsaved={step === "unsaved"}
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
    </Dialog>
  );
}
