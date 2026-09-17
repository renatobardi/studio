import { Icon } from "../../components/icons/Icon";
import { Sakura } from "../../components/brand/Sakura";
import type { Theme } from "../../lib/appearance";
import type { ConnectionState } from "../../lib/relay";
import { initials, type SidebarGroup, type SidebarItem, type SidebarMode } from "../../lib/sidebar";
import { ChannelsEmptyState } from "./ChannelsEmptyState";
import { ConnectionBadge } from "./ConnectionBadge";

/** The persistent 256px sidebar of the prototype: grouped destinations above, the account —
 * name, Workspace with the sakura, theme toggle — in the footer (#68). Only MVP destinations:
 * no search, no Inbox, no Workspace switching. */
export function Sidebar({
  groups,
  onSelect,
  onSelectMode,
  canCreateChannels,
  onCreateChannel,
  ownName,
  workspaceName,
  role,
  connectionState,
  theme,
  onToggleTheme,
  onSignOut,
}: Readonly<{
  groups: SidebarGroup[];
  onSelect: (item: SidebarItem) => void;
  onSelectMode: (mode: SidebarMode) => void;
  canCreateChannels: boolean;
  onCreateChannel: () => void;
  ownName: string;
  workspaceName: string;
  role: string;
  connectionState: ConnectionState;
  theme: Theme;
  onToggleTheme: () => void;
  onSignOut: () => void;
}>) {
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
        <div className="sidebar-status">
          <ConnectionBadge state={connectionState} />
          <span className="meta">Connected as {role}</span>
        </div>
        <div className="account-row">
          <span className="account-avatar" aria-hidden="true">
            {initials(ownName)}
          </span>
          <span className="account-text">
            <span className="account-name">{ownName}</span>
            <span className="account-workspace">
              <Sakura size={12} sw={7} />
              <span className="account-workspace-name">{workspaceName}</span>
            </span>
          </span>
          <button
            className="sidebar-icon-button"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
          </button>
          <button className="sidebar-icon-button" onClick={onSignOut} aria-label="Sign out" title="Sign out">
            <Icon name="log-out" size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
