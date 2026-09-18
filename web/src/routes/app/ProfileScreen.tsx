import { nip19 } from "nostr-tools";
import { useEffect, useReducer } from "react";
import { Icon } from "../../components/icons/Icon";
import type { Signer } from "../../lib/custody";
import { NEW_PROFILE_FORM, profileFormReducer, profileFormSeed, saveProfile } from "../../lib/profileForm";
import type { ConnectionState, RelayClient } from "../../lib/relay";
import { Avatar } from "./Avatar";
import { displayName, shortNpub, useProfiles, type Profile } from "./useProfiles";

/** The avatars onboarding offers — the only ones the MVP publishes (#150). */
const EMOJIS = ["🌸", "🦊", "🐙", "🌊", "🔥", "🌙", "🍄", "🐝"];

/**
 * The prototype's "Your profile" screen (`reference/desktop/profile.png`): avatar, name, bio and an
 * INFO card, with "Edit profile" turning the same screen into the form — this is where editing
 * lives now that Settings › Profile reads back (#150). Only what the MVP has: no NIP-05, no
 * presence beyond the relay connection, no Message/Huddle/Wave, no Channels or Memories tabs
 * (docs/UI/REFERENCE.md › Decisões).
 */
export function ProfileScreen({
  client,
  signer,
  pubkey,
  relayUrl,
  connectionState,
  onClose,
}: Readonly<{
  client: RelayClient;
  signer: Signer;
  pubkey: string;
  relayUrl: string;
  connectionState: ConnectionState;
  onClose: () => void;
}>) {
  const { profiles, ensure } = useProfiles(client);
  useEffect(() => ensure([pubkey]), [pubkey, ensure]);
  return (
    <ProfileScreenBody
      profile={profiles.get(pubkey)}
      shownName={displayName(profiles, pubkey)}
      client={client}
      signer={signer}
      pubkey={pubkey}
      relayUrl={relayUrl}
      connectionState={connectionState}
      onClose={onClose}
    />
  );
}

/** The screen over the profile the pane above already has, so everything below is what this
 * Identity published and what the form is doing to it. */
export function ProfileScreenBody({
  profile,
  shownName,
  client,
  signer,
  pubkey,
  relayUrl,
  connectionState,
  onClose,
}: Readonly<{
  profile: Profile | undefined;
  shownName: string;
  client: Pick<RelayClient, "publish">;
  signer: Pick<Signer, "signEvent">;
  pubkey: string;
  relayUrl: string;
  connectionState: ConnectionState;
  onClose: () => void;
}>) {
  const [form, dispatch] = useReducer(profileFormReducer, NEW_PROFILE_FORM);
  const { editing, saving, error } = form;
  const { name, picture, about } = form.fields;

  // Seeded during render, not in an effect: the profile is already in hand by
  // the time this runs, so there is nothing to synchronise with afterwards.
  if (profileFormSeed(profile, form.seededFor, pubkey)) dispatch({ type: "seed", profile, pubkey });

  const handleSave = async () => {
    dispatch({ type: "saving" });
    dispatch({ type: "saved", problem: await saveProfile(client, signer, form.fields) });
  };

  return (
    <div className="profile-screen app-scroll" data-screen-label="Profile" data-testid="profile-screen">
      <div className="profile-column">
        <header className="profile-header">
          <h1 className="profile-subject">Your profile</h1>
          {!editing && (
            <button className="btn btn-outline btn-xs" onClick={() => dispatch({ type: "edit" })}>
              <Icon name="pencil" size={13} />
              <span>Edit profile</span>
            </button>
          )}
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close profile" title="Close profile">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="profile-identity">
          <span className="profile-avatar-wrap">
            <Avatar profile={editing ? { name, picture } : profile} name={editing ? name || "?" : shownName} size={72} />
            <span className="profile-presence" data-connection={connectionState} aria-hidden="true" />
          </span>
          {editing ? (
            <ProfileEditForm
              name={name}
              picture={picture}
              about={about}
              saving={saving}
              error={error}
              onName={(value) => dispatch({ type: "field", field: "name", value })}
              onPicture={(value) => dispatch({ type: "field", field: "picture", value })}
              onAbout={(value) => dispatch({ type: "field", field: "about", value })}
              onCancel={() => dispatch({ type: "cancel", profile })}
              onSave={() => void handleSave()}
            />
          ) : (
            <>
              <h2 className="profile-name">{shownName}</h2>
              <p className="profile-handle">{shortNpub(pubkey)}</p>
              {profile?.about && <p className="profile-bio">{profile.about}</p>}
            </>
          )}
        </div>
        <h3 className="settings-section-label">Info</h3>
        <div className="settings-card">
          <div className="settings-row profile-info-row">
            <Icon name="link" size={14} />
            <span className="profile-info-text">
              <span className="profile-info-label">Public key</span>
              <span className="profile-info-value settings-row-mono">{shortNpub(pubkey)}</span>
            </span>
            <button className="btn btn-ghost btn-xs" onClick={() => void navigator.clipboard.writeText(nip19.npubEncode(pubkey))}>
              Copy
            </button>
          </div>
          <div className="settings-row profile-info-row">
            <Icon name="hash" size={14} />
            <span className="profile-info-text">
              <span className="profile-info-label">Relay</span>
              <span className="profile-info-value settings-row-mono">{relayUrl}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The same screen turned into the form "Edit profile" opens: the avatars onboarding offers,
 * the display name and the bio — nothing the MVP does not publish. */
export function ProfileEditForm({
  name,
  picture,
  about,
  saving,
  error,
  onName,
  onPicture,
  onAbout,
  onCancel,
  onSave,
}: Readonly<{
  name: string;
  picture: string;
  about: string;
  saving: boolean;
  error: string | null;
  onName: (value: string) => void;
  onPicture: (value: string) => void;
  onAbout: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}>) {
  return (
    <>
      <div className="profile-emoji-picker" role="group" aria-label="Avatar">
        {EMOJIS.map((option) => (
          <button
            key={option}
            type="button"
            className={`onboarding-emoji${picture === option ? " active" : ""}`}
            aria-pressed={picture === option}
            onClick={() => onPicture(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="settings-card profile-form">
        <label className="settings-row">
          <span className="settings-row-label">Display name</span>
          <input
            className="input settings-row-input"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Display name"
          />
        </label>
        <label className="settings-row">
          <span className="settings-row-label">Bio</span>
          <textarea
            className="settings-row-input settings-row-textarea"
            value={about}
            onChange={(e) => onAbout(e.target.value)}
            placeholder="A little about you"
            rows={2}
          />
        </label>
        <div className="settings-row settings-row-actions">
          {error && <span className="error-banner">{error}</span>}
          <button className="btn btn-outline btn-xs" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary btn-xs" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
