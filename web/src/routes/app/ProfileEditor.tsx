import { useEffect, useState } from "react";
import { profileEventTemplate } from "../../lib/identity";
import { profileFormSeed } from "../../lib/profileForm";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
import { relayRejection } from "../../lib/relayReasons";
import { Avatar } from "./Avatar";
import { useProfiles } from "./useProfiles";

/** Edits the caller's own kind 0 profile (name, avatar, about) — a plain signed Nostr event,
 * per ADR-0003: profiles are not server-managed state like Invites/Members. */
export function ProfileEditor({
  client,
  signer,
  pubkey,
}: Readonly<{ client: RelayClient; signer: Signer; pubkey: string }>) {
  const { profiles, ensure } = useProfiles(client);
  const [name, setName] = useState("");
  const [picture, setPicture] = useState("");
  const [about, setAbout] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [seededFor, setSeededFor] = useState<string | null>(null);

  useEffect(() => ensure([pubkey]), [pubkey, ensure]);

  // Adjusted during render, not in an effect: the profile is already in hand by
  // the time this runs, so there is nothing to synchronise with afterwards.
  const seed = profileFormSeed(profiles.get(pubkey), seededFor, pubkey);
  if (seed) {
    setSeededFor(pubkey);
    setName(seed.name);
    setPicture(seed.picture);
    setAbout(seed.about);
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const template = profileEventTemplate({ name, picture: picture || undefined, about: about || undefined });
      const event = await signer.signEvent(template);
      await client.publish(event);
      setSaved(true);
    } catch (error) {
      setError(
        relayRejection(error) ?? "Couldn't save your profile. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card stack" data-testid="profile-editor">
      <h2>Your profile</h2>
      <Avatar profile={{ name, picture }} name={name || "?"} />
      <label className="field">
        <span className="field-label">Display name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
      </label>
      <label className="field">
        <span className="field-label">Avatar URL</span>
        <input value={picture} onChange={(e) => setPicture(e.target.value)} placeholder="https://…" />
      </label>
      <label className="field">
        <span className="field-label">About</span>
        <textarea value={about} onChange={(e) => setAbout(e.target.value)} placeholder="A little about you" />
      </label>
      {error && <div className="error-banner">{error}</div>}
      {saved && !saving && <p className="meta">Saved.</p>}
      <button className="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
