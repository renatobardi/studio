import { useState } from "react";
import { Icon } from "../../components/icons/Icon";
import type { Appearance } from "../../lib/appearance";
import type { SettingsSection } from "../../lib/sidebar";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
import { AppearanceSettings } from "./AppearanceSettings";
import { IosInstallHint } from "./IosInstallHint";
import { ProfileEditor } from "./ProfileEditor";

const SECTIONS: { id: SettingsSection; label: string; icon: "pencil" | "user"; description: string }[] = [
  { id: "appearance", label: "Appearance", icon: "pencil", description: "How Studio looks on this device." },
  { id: "profile", label: "Profile", icon: "user", description: "Update how your name, avatar, and bio appear across Studio." },
];

/** Settings as the prototype lays it out (#71): a 208px list of sections on the left, the
 * chosen section's header and content on the right. Only the MVP sections exist. */
export function SettingsView({
  initialSection = "appearance",
  client,
  signer,
  pubkey,
  appearance,
  onAppearanceChange,
  onClose,
}: Readonly<{
  /** Where it opens: Profile, from the account menu (#148). */
  initialSection?: SettingsSection;
  client: RelayClient;
  signer: Signer;
  pubkey: string;
  appearance: Appearance;
  onAppearanceChange: (next: Appearance) => void;
  onClose: () => void;
}>) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;

  return (
    <div className="settings" data-screen-label="Settings">
      <aside className="settings-sections" aria-label="Settings sections">
        <h1 className="settings-title">Settings</h1>
        <section className="settings-group">
          <h2 className="settings-group-label">Personal</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-section-item${s.id === section ? " active" : ""}`}
              aria-current={s.id === section ? "page" : undefined}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={14} />
              <span>{s.label}</span>
            </button>
          ))}
        </section>
      </aside>
      <div className="settings-content">
        <div className="settings-column">
          <div className="settings-header">
            <div className="settings-header-text">
              <h2 className="settings-section-title">{current.label}</h2>
              <p className="settings-section-description">{current.description}</p>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close settings" title="Close settings">
              <Icon name="x" size={14} />
            </button>
          </div>
          {section === "appearance" && (
            <>
              <IosInstallHint />
              <AppearanceSettings appearance={appearance} onChange={onAppearanceChange} />
            </>
          )}
          {section === "profile" && <ProfileEditor client={client} signer={signer} pubkey={pubkey} />}
        </div>
      </div>
    </div>
  );
}
