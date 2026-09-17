import type { ChannelOut } from "./api";

export type SidebarMode = "channels" | "dms" | "admin" | "settings";

export type AdminTab = "invites" | "members" | "channels";

/** What the main area shows. `adminTab` is the tab Admin was asked to open on — Channels,
 * from an empty Channel list (#136) — and `adminVisit` changes with each such request, so
 * the console re-opens on that tab even when it is already on screen. */
export interface Navigation {
  mode: SidebarMode;
  adminTab?: AdminTab;
  adminVisit: number;
}

export const START_NAVIGATION: Navigation = { mode: "channels", adminTab: undefined, adminVisit: 0 };

export function navigateTo(current: Navigation, to: { mode: SidebarMode; adminTab?: AdminTab }): Navigation {
  const adminVisit = to.adminTab ? current.adminVisit + 1 : current.adminVisit;
  return { mode: to.mode, adminTab: to.adminTab, adminVisit };
}

export interface SidebarItem {
  id: string;
  label: string;
  /** A Lucide glyph name (src/components/icons/icons.ts). */
  icon: "hash" | "lock" | "mail" | "shield" | "settings";
  active: boolean;
  unread: boolean;
  /** The Playwright hook the flows already drive: `channel-list-item` for a Channel row, `mode-*` for the rest. */
  testId: string;
  mode: SidebarMode;
  channelId?: string;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
  /** When the group's own label is a destination (Channels), the mode it opens and its hook. */
  mode?: SidebarMode;
  testId?: string;
}

/**
 * What the persistent sidebar lists (#68): every Channel this Identity may
 * read, then Direct messages, then — only when this person may manage the
 * Workspace — the admin console, and Settings. An item is "active" when it is
 * what the main area shows, so a Channel is not lit while Direct messages are.
 */
export function sidebarGroups({
  channels,
  selectedChannelId,
  unreadChannelIds,
  mode,
  canManage,
}: {
  channels: ChannelOut[];
  selectedChannelId: string | null;
  unreadChannelIds: Set<string>;
  mode: SidebarMode;
  canManage: boolean;
}): SidebarGroup[] {
  const channelItems: SidebarItem[] = channels.map((channel) => ({
    id: `channel:${channel.id}`,
    label: channel.name,
    icon: channel.private ? "lock" : "hash",
    active: mode === "channels" && channel.id === selectedChannelId,
    unread: unreadChannelIds.has(channel.id),
    testId: "channel-list-item",
    mode: "channels",
    channelId: channel.id,
  }));
  const workspaceItems: SidebarItem[] = [
    { id: "dms", label: "Direct messages", icon: "mail", active: mode === "dms", unread: false, testId: "mode-dms", mode: "dms" },
    ...(canManage
      ? [{ id: "admin", label: "Admin", icon: "shield" as const, active: mode === "admin", unread: false, testId: "mode-admin", mode: "admin" as const }]
      : []),
    { id: "settings", label: "Settings", icon: "settings", active: mode === "settings", unread: false, testId: "mode-settings", mode: "settings" },
  ];
  return [
    { label: "Channels", items: channelItems, mode: "channels", testId: "mode-channels" },
    { label: "Workspace", items: workspaceItems },
  ];
}

/** Up to two initials for an avatar tile, as the prototype's "RB". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}
