import { nip19 } from "nostr-tools";
import { useEffect, useState } from "react";
import { Icon } from "../../components/icons/Icon";
import type { Signer } from "../../lib/custody";
import { profileEventTemplate } from "../../lib/identity";
import { profileFormSeed } from "../../lib/profileForm";
import type { ConnectionState, RelayClient } from "../../lib/relay";
import { relayRejection } from "../../lib/relayReasons";
import { Avatar } from "./Avatar";
import { displayName, shortNpub, useProfiles } from "./useProfiles";

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

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [picture, setPicture] = useState("");
  const [about, setAbout] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Adjusted during render, not in an effect: the profile is already in hand by
  // the time this runs, so there is nothing to synchronise with afterwards.
  const seed = profileFormSeed(profiles.get(pubkey), seededFor, pubkey);
  if (seed) {
    setSeededFor(pubkey);
    setName(seed.name);
    setPicture(seed.picture);
    setAbout(seed.about);
  }

  const profile = profiles.get(pubkey);
  const shownName = displayName(profiles, pubkey);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const template = profileEventTemplate({ name, picture: picture || undefined, about: about || undefined });
      await client.publish(await signer.signEvent(template));
      setEditing(false);
    } catch (error) {
      setError(relayRejection(error) ?? "Couldn't save your profile. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    const current = profiles.get(pubkey);
    setName(current?.name ?? "");
    setPicture(current?.picture ?? "");
    setAbout(current?.about ?? "");
  };

  return (
    <div className="profile-screen app-scroll" data-screen-label="Profile" data-testid="profile-screen">
      <div className="profile-column">
        <header className="profile-header">
          <h1 className="profile-subject">Your profile</h1>
          {!editing && (
            <button className="btn btn-outline btn-xs" onClick={() => setEditing(true)}>
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
            <>
              <div className="profile-emoji-picker" role="group" aria-label="Avatar">
                {EMOJIS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`onboarding-emoji${picture === option ? " active" : ""}`}
                    aria-pressed={picture === option}
                    onClick={() => setPicture(option)}
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
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Display name"
                  />
                </label>
                <label className="settings-row">
                  <span className="settings-row-label">Bio</span>
                  <textarea
                    className="settings-row-input settings-row-textarea"
                    value={about}
                    onChange={(e) => setAbout(e.target.value)}
                    placeholder="A little about you"
                    rows={2}
                  />
                </label>
                <div className="settings-row settings-row-actions">
                  {error && <span className="error-banner">{error}</span>}
                  <button className="btn btn-outline btn-xs" disabled={saving} onClick={cancel}>
                    Cancel
                  </button>
                  <button className="btn btn-primary btn-xs" disabled={saving} onClick={() => void handleSave()}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </>
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
