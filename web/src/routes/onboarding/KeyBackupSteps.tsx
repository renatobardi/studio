import { Icon } from "../../components/icons/Icon";
import { KEY_BACKUP_FILENAME } from "../../lib/keyBackup";

/**
 * The two Key Backup cards: pick a passphrase, then prove it unlocks the file (#31, #36).
 *
 * Onboarding walks them as its own steps and Settings › Profile reopens them from "Manage"
 * (#150) — the same markup either way, so a backup made later is made exactly as the first
 * one was. Only the cards live here: each caller keeps its own titles, errors and actions.
 */
export function BackupPassphraseCard({
  passphrase,
  confirm,
  onPassphrase,
  onConfirm,
  busy,
  onCreate,
}: Readonly<{
  passphrase: string;
  confirm: string;
  onPassphrase: (value: string) => void;
  onConfirm: (value: string) => void;
  busy: boolean;
  onCreate: () => void;
}>) {
  return (
    <div className="onboarding-card">
      <label className="field">
        <span className="field-label">Passphrase</span>
        <input
          type="password"
          placeholder="Backup passphrase"
          value={passphrase}
          onChange={(e) => onPassphrase(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">Confirm passphrase</span>
        <input
          type="password"
          placeholder="Confirm passphrase"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
        />
      </label>
      <span className="onboarding-card-action">
        <button className="btn btn-primary btn-xs" disabled={busy} onClick={onCreate}>
          Create backup
        </button>
      </span>
    </div>
  );
}

export function BackupVerifyCard({
  verified,
  unsaved = false,
  passphrase,
  onPassphrase,
  busy,
  onVerify,
}: Readonly<{
  verified: boolean;
  /** Proved, but the upload to the Account failed: retrying runs the verify step again (#200). */
  unsaved?: boolean;
  passphrase: string;
  onPassphrase: (value: string) => void;
  busy: boolean;
  onVerify: () => void;
}>) {
  return (
    <div className="onboarding-card">
      <div className="auth-panel">
        <Icon name="shield" size={15} />
        <span className="auth-panel-text">
          <span className="auth-panel-title auth-panel-mono">{KEY_BACKUP_FILENAME}</span>
          <span className="auth-panel-meta">Created just now</span>
        </span>
      </div>
      {!verified && (
        <>
          <label className="field">
            <span className="field-label">Passphrase</span>
            <input
              type="password"
              placeholder="Backup passphrase"
              value={passphrase}
              onChange={(e) => onPassphrase(e.target.value)}
            />
          </label>
          <span className="onboarding-card-action">
            <button className="btn btn-primary btn-xs" disabled={busy} onClick={onVerify}>
              Verify
            </button>
          </span>
        </>
      )}
      {verified && (
        <div className="auth-panel auth-panel-plain">
          <span className="auth-check">
            <Icon name="check" size={15} />
          </span>
          <span className="auth-panel-text">
            <span className="auth-panel-title">✓ Verified</span>
            <span className="auth-panel-meta">
              {unsaved ? "Not saved to your Account yet." : "Your passphrase unlocked the backup."}
            </span>
          </span>
        </div>
      )}
      {verified && unsaved && (
        <span className="onboarding-card-action">
          <button className="btn btn-primary btn-xs" disabled={busy} onClick={onVerify}>
            Try again
          </button>
        </span>
      )}
    </div>
  );
}
