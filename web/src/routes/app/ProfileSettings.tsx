import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import { hasNip07 } from "../../lib/custody";
import type { Custody } from "../../lib/onboardingSteps";
import type { RelayClient } from "../../lib/relay";
import { FEEDBACK_URL, keyBackupRow } from "../../lib/settingsProfile";
import { KeyBackupDialog } from "./KeyBackupDialog";
import { SignOutDialog } from "./SignOutDialog";
import { shortNpub, useProfiles } from "./useProfiles";

/** Settings › Profile as the prototype has it (#150): PROFILE INFO and IDENTITY read back, the
 * Key Backup managed from here, and SIGN OUT with the warning and its tinted destructive button.
 * Editing lives on the `profile` screen, where the prototype's "Edit profile" leads. The NIP-05
 * handle row is left out — Studio issues no handle in the MVP (docs/UI/REFERENCE.md › Decisões). */
export function ProfileSettings({
  client,
  pubkey,
  user,
  accountPassword,
  onSignOut,
}: Readonly<{
  client: RelayClient;
  pubkey: string;
  /** Null in the preview harness and wherever no Firebase session is at hand: the Key Backup
   * is then only reported, never managed. */
  user: User | null;
  accountPassword: string | null;
  onSignOut: () => void;
}>) {
  const { profiles, ensure } = useProfiles(client);
  useEffect(() => ensure([pubkey]), [pubkey, ensure]);
  const profile = profiles.get(pubkey);

  const [custody] = useState<Custody>(() => (hasNip07() ? "extension" : "local"));
  /** Whether the Account holds a Key Backup — null until it has answered. */
  const [storedBackup, setStoredBackup] = useState<boolean | null>(null);
  const [managing, setManaging] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (custody === "extension" || !user) return;
    let cancelled = false;
    user
      .getIdToken()
      .then(api.hasKeyBackup)
      .then((stored) => {
        if (!cancelled) setStoredBackup(stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [custody, user]);

  const backup = keyBackupRow(custody, storedBackup);

  return (
    <section className="settings-section" data-testid="profile-settings">
      <h3 className="settings-section-label">Profile info</h3>
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">Display name</span>
          <span className="settings-row-value">{profile?.name || "Not set yet"}</span>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Bio</span>
          <span className="settings-row-value">{profile?.about || "Not set yet"}</span>
        </div>
      </div>
      <h3 className="settings-section-label">Identity</h3>
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">Public key</span>
          <span className="settings-row-value settings-row-mono">{shortNpub(pubkey)}</span>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Private key backup</span>
          <span className="settings-row-value">{backup.value}</span>
          {backup.manage && user && (
            <button className="btn btn-ghost btn-xs" onClick={() => setManaging(true)}>
              Manage
            </button>
          )}
        </div>
      </div>
      <h3 className="settings-section-label">Sign out</h3>
      <div className="settings-card">
        <p className="settings-card-subcopy">
          Removes your identity key and all local app data from this device. Before signing out, create and test a
          password-protected key backup above — this cannot be undone.
        </p>
        <div className="settings-card-actions">
          <button className="btn btn-destructive btn-xs" onClick={() => setSigningOut(true)}>
            Delete my data
          </button>
        </div>
      </div>
      <div className="settings-card-actions settings-actions-loose">
        <a className="btn btn-outline btn-xs" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          Send feedback
        </a>
      </div>
      {managing && user && (
        <KeyBackupDialog
          user={user}
          accountPassword={accountPassword}
          pubkey={pubkey}
          onClose={() => setManaging(false)}
          onStored={() => setStoredBackup(true)}
        />
      )}
      {signingOut && <SignOutDialog onCancel={() => setSigningOut(false)} onConfirm={onSignOut} />}
    </section>
  );
}
