import type { ChannelOut } from "./api";

export type SidebarMode = "channels" | "dms" | "admin" | "settings";

export type AdminTab = "invites" | "members" | "channels";

export type SettingsSection = "appearance" | "profile";

/** What the main area shows. `adminTab` is the tab Admin was asked to open on — Channels,
 * from an empty Channel list (#136) — and `adminVisit` changes with each such request, so
 * the console re-opens on that tab even when it is already on screen. `settingsSection` and
 * `settingsVisit` do the same for Settings, opened on Profile from the account menu (#148). */
export interface Navigation {
  mode: SidebarMode;
  adminTab?: AdminTab;
  adminVisit: number;
  settingsSection?: SettingsSection;
  settingsVisit: number;
}

export const START_NAVIGATION: Navigation = { mode: "channels", adminTab: undefined, adminVisit: 0, settingsVisit: 0 };

export function navigateTo(
  current: Navigation,
  to: { mode: SidebarMode; adminTab?: AdminTab; settingsSection?: SettingsSection },
): Navigation {
  const adminVisit = to.adminTab ? current.adminVisit + 1 : current.adminVisit;
  const settingsVisit = to.settingsSection ? current.settingsVisit + 1 : current.settingsVisit;
  return { mode: to.mode, adminTab: to.adminTab, adminVisit, settingsSection: to.settingsSection, settingsVisit };
}

export interface SidebarItem {
  id: string;
  label: string;
  /** A Lucide glyph name (src/components/icons/icons.ts). */
  icon: "hash" | "lock" | "user" | "bot" | "shield" | "settings";
  active: boolean;
  unread: boolean;
  /** The Playwright hook the flows already drive: `channel-list-item` for a Channel row,
   * `conversation-list-item` for a Direct message one, `mode-*` for the rest. */
  testId: string;
  mode: SidebarMode;
  channelId?: string;
  /** A Direct message row's other participants — what opens the conversation. */
  peerPubkeys?: string[];
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
  /** When the group's own label is a destination (Channels), the mode it opens and its hook. */
  mode?: SidebarMode;
  testId?: string;
  /** The "+" beside the label that starts a Direct message, as the prototype's quick action. */
  newMessageLabel?: string;
}

/**
 * What the persistent sidebar lists (#68): every Channel this Identity may
 * read, then each Direct message conversation, newest first as given (#142),
 * then — only when this person may manage the Workspace — the admin console,
 * and Settings. An item is "active" when it is what the main area shows, so a
 * Channel is not lit while a conversation is.
 */
export function sidebarGroups({
  channels,
  selectedChannelId,
  unreadChannelIds,
  mode,
  canManage,
  conversations,
  selectedConversationKey,
  unreadConversationKeys,
  nameOf,
  isAgent,
}: {
  channels: ChannelOut[];
  selectedChannelId: string | null;
  unreadChannelIds: Set<string>;
  mode: SidebarMode;
  canManage: boolean;
  conversations: { key: string; peerPubkeys: string[] }[];
  selectedConversationKey: string | null;
  unreadConversationKeys: Set<string>;
  nameOf: (pubkey: string) => string;
  isAgent: (pubkey: string) => boolean;
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
  const conversationItems: SidebarItem[] = conversations.map(({ key, peerPubkeys }) => ({
    id: `dm:${key}`,
    label: peerPubkeys.map(nameOf).join(", "),
    icon: peerPubkeys.length === 1 && isAgent(peerPubkeys[0]!) ? "bot" : "user",
    active: mode === "dms" && key === selectedConversationKey,
    unread: unreadConversationKeys.has(key),
    testId: "conversation-list-item",
    mode: "dms",
    peerPubkeys,
  }));
  const workspaceItems: SidebarItem[] = [
    ...(canManage
      ? [{ id: "admin", label: "Admin", icon: "shield" as const, active: mode === "admin", unread: false, testId: "mode-admin", mode: "admin" as const }]
      : []),
    { id: "settings", label: "Settings", icon: "settings", active: mode === "settings", unread: false, testId: "mode-settings", mode: "settings" },
  ];
  return [
    { label: "Channels", items: channelItems, mode: "channels", testId: "mode-channels" },
    { label: "Direct messages", items: conversationItems, newMessageLabel: "New message" },
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
