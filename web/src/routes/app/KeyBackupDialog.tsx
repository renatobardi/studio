import type { User } from "firebase/auth";
import { getPublicKey } from "nostr-tools";
import { useState } from "react";
import * as api from "../../lib/api";
import { decryptBackup, encryptBackup, needsAccountPassword, validateBackupPassphrase } from "../../lib/backup";
import { loadIdentityNsec } from "../../lib/custody";
import { secretKeyFromNsec } from "../../lib/identity";
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

  const run = async (fn: () => Promise<void>, errorMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError(errorMessage);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () => {
    const invalid = validateBackupPassphrase(passphrase, knownPassword ?? "");
    if (invalid) {
      setError(invalid);
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setError("Passphrases don't match.");
      return;
    }
    return run(async () => {
      const nsec = await loadIdentityNsec();
      if (!nsec) {
        setError("This browser doesn't hold your private key, so there is nothing to back up here.");
        return;
      }
      setBlob(await encryptBackup(nsec, passphrase));
    }, "Couldn't create the Key Backup. Try again.");
  };

  const handleVerify = () => {
    if (!blob) return;
    return run(async () => {
      const decrypted = await decryptBackup(blob, verifyPassphrase);
      if (getPublicKey(secretKeyFromNsec(decrypted)) !== pubkey) {
        setError("That didn't decrypt to your key. Check the passphrase.");
        return;
      }
      setVerified(true);
      await api.putKeyBackup(await user.getIdToken(), btoa(String.fromCodePoint(...blob)));
      onStored();
    }, "Couldn't store your Key Backup. Check the passphrase and try again.");
  };

  const handleDownload = () => {
    if (!blob) return;
    const file = new Blob([blob as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = "studio-key-backup.age";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-backup-title"
        onClick={(event) => event.stopPropagation()}
        data-testid="key-backup-dialog"
      >
        <div className="dialog-header">
          <button className="dialog-close" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="x" size={16} />
          </button>
          <h2 id="key-backup-title" className="dialog-title">
            {verified ? "Your backup is verified" : blob ? "That’s your backup file" : "Back up your key with a password"}
          </h2>
          <p className="dialog-description">
            {verified
              ? "Your file and passphrase can restore your identity."
              : blob
                ? "Now enter your passphrase to prove you can unlock it."
                : "Pick a passphrase you can remember. It locks the backup file — Studio cannot recover it for you, and it must be different from your account password."}
          </p>
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
            <button type="button" className="link" onClick={handleDownload}>
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
