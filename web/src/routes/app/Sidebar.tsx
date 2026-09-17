import { useEffect, useState } from "react";
import { Icon } from "../../components/icons/Icon";
import { Sakura } from "../../components/brand/Sakura";
import type { Theme } from "../../lib/appearance";
import type { ConnectionState } from "../../lib/relay";
import { initials, type SidebarGroup, type SidebarItem, type SidebarMode } from "../../lib/sidebar";
import { ChannelsEmptyState } from "./ChannelsEmptyState";
import { SignOutDialog } from "./SignOutDialog";

/** The persistent 256px sidebar of the prototype: grouped destinations above, the account —
 * name, Workspace with the sakura, theme toggle — in the footer (#68). Only MVP destinations:
 * no search, no Inbox, no Workspace switching. The account block opens Profile, Settings and
 * Sign out; its presence dot is the relay connection, lit only while open (#148). */
export function Sidebar({
  groups,
  onSelect,
  onSelectMode,
  canCreateChannels,
  onCreateChannel,
  ownName,
  ownHandle,
  workspaceName,
  connectionState,
  theme,
  onToggleTheme,
  onOpenProfile,
  onOpenSettings,
  onSignOut,
}: Readonly<{
  groups: SidebarGroup[];
  onSelect: (item: SidebarItem) => void;
  onSelectMode: (mode: SidebarMode) => void;
  canCreateChannels: boolean;
  onCreateChannel: () => void;
  ownName: string;
  /** The own npub, shortened, under the name in the menu. */
  ownHandle: string;
  workspaceName: string;
  connectionState: ConnectionState;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const choose = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar-scroll">
        {groups.map((group) => (
          <section key={group.label} className="sidebar-group">
            {group.mode ? (
              <button className="sidebar-group-label" data-testid={group.testId} onClick={() => onSelectMode(group.mode!)}>
                {group.label}
              </button>
            ) : (
              <h2 className="sidebar-group-label">{group.label}</h2>
            )}
            <nav className="sidebar-nav" aria-label={group.label}>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`sidebar-item${item.active ? " active" : ""}${item.unread ? " unread" : ""}`}
                  aria-current={item.active ? "page" : undefined}
                  onClick={() => onSelect(item)}
                  data-testid={item.testId}
                >
                  <Icon name={item.icon} size={14} />
                  <span className="sidebar-item-label">{item.label}</span>
                  {item.unread && <span className="unread-dot" aria-label="unread" />}
                </button>
              ))}
              {group.items.length === 0 && (
                <ChannelsEmptyState className="sidebar-empty" canCreate={canCreateChannels} onCreate={onCreateChannel} />
              )}
            </nav>
          </section>
        ))}
      </div>
      <div className="sidebar-footer">
        <div className="account-row">
          <button
            className="account-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Open account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="account-menu-button"
          >
            <span className="account-avatar-wrap">
              <span className="account-avatar" aria-hidden="true">
                {initials(ownName)}
              </span>
              <span className="account-presence" data-connection={connectionState} aria-hidden="true" />
            </span>
            <span className="account-text">
              <span className="account-name">{ownName}</span>
              <span className="account-workspace">
                <Sakura size={12} sw={7} />
                <span className="account-workspace-name">{workspaceName}</span>
              </span>
            </span>
          </button>
          <button
            className="sidebar-icon-button"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
          </button>
        </div>
        {menuOpen && (
          <>
            <div className="menu-dismiss" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <div className="account-menu" role="menu" aria-label="Account" data-testid="account-menu">
              <div className="account-menu-header">
                <p className="account-menu-name">{ownName}</p>
                <p className="account-menu-handle">{ownHandle}</p>
              </div>
              <button className="menu-item" role="menuitem" onClick={choose(onOpenProfile)}>
                <Icon name="user" size={14} />
                <span>Profile</span>
              </button>
              <button className="menu-item" role="menuitem" onClick={choose(onOpenSettings)}>
                <Icon name="pencil" size={14} />
                <span>Settings</span>
              </button>
              <div className="menu-separator" role="separator" />
              <button className="menu-item destructive" role="menuitem" onClick={choose(() => setSigningOut(true))}>
                <Icon name="x" size={14} />
                <span>Sign out</span>
              </button>
            </div>
          </>
        )}
      </div>
      {signingOut && <SignOutDialog onCancel={() => setSigningOut(false)} onConfirm={onSignOut} />}
    </aside>
  );
}
