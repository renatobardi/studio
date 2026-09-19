import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { hasNip07 } from "../../lib/custody";
import type { Custody } from "../../lib/onboardingSteps";
import type { RelayClient } from "../../lib/relay";
import { askForKeyBackup, keyBackupRow } from "../../lib/settingsProfile";
import { KeyBackupDialog } from "./KeyBackupDialog";
import { SignOutDialog } from "./SignOutDialog";
import { shortNpub, useProfiles, type Profile } from "./useProfiles";

/** Settings › Profile as the prototype has it (#150): PROFILE INFO and IDENTITY read back, the
 * Key Backup managed from here, and SIGN OUT with the warning and its tinted destructive button.
 * Editing lives on the `profile` screen, where the prototype's "Edit profile" leads. The NIP-05
 * handle row is left out — Studio issues no handle in the MVP (docs/UI/REFERENCE.md › Decisões). */
export function ProfileSettings({
  client,
  pubkey,
  user,
  onSignOut,
}: Readonly<{
  client: RelayClient;
  pubkey: string;
  /** Null in the preview harness and wherever no Firebase session is at hand: the Key Backup
   * is then only reported, never managed. */
  user: User | null;
  onSignOut: () => void;
}>) {
  const { profiles, ensure } = useProfiles(client);
  useEffect(() => ensure([pubkey]), [pubkey, ensure]);
  return (
    <ProfileSettingsCards
      profile={profiles.get(pubkey)}
      pubkey={pubkey}
      user={user}
      onSignOut={onSignOut}
    />
  );
}

/** The cards themselves, over the profile the pane above already has: what this Identity is,
 * what the Account knows about its Key Backup, and the way out of this device. */
export function ProfileSettingsCards({
  profile,
  pubkey,
  user,
  onSignOut,
}: Readonly<{
  profile: Profile | undefined;
  pubkey: string;
  user: User | null;
  onSignOut: () => void;
}>) {
  const [custody] = useState<Custody>(() => (hasNip07() ? "extension" : "local"));
  /** Whether the Account holds a Key Backup — null until it has answered. */
  const [storedBackup, setStoredBackup] = useState<boolean | null>(null);
  const [managing, setManaging] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => askForKeyBackup(custody, user, setStoredBackup), [custody, user]);

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
      {managing && user && (
        <KeyBackupDialog
          user={user}
          pubkey={pubkey}
          onClose={() => setManaging(false)}
          onStored={() => setStoredBackup(true)}
        />
      )}
      {signingOut && <SignOutDialog onCancel={() => setSigningOut(false)} onConfirm={onSignOut} />}
    </section>
  );
}
