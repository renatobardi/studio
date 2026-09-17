import { describe, expect, test } from "bun:test";
import { initials, navigateTo, sidebarGroups, START_NAVIGATION } from "./sidebar";

const channels = [
  { id: "c1", name: "general", private: false },
  { id: "c2", name: "release-train", private: true },
];

const NAMES: Record<string, string> = { ana: "Ana Petrova", sprig: "Sprig", marina: "Marina Silva" };
const noDms = {
  conversations: [],
  selectedConversationKey: null,
  unreadConversationCounts: new Map<string, number>(),
  nameOf: (pubkey: string) => NAMES[pubkey] ?? pubkey,
  isAgent: (pubkey: string) => pubkey === "sprig",
};

/** The persistent sidebar's contents (#68): Channels, Direct messages and — only for someone
 * who may manage the Workspace — the admin console, plus Settings. What the person may not do
 * is not drawn, rather than drawn and refused later. */
describe("sidebarGroups", () => {
  test("lists every Channel under Channels, marking the open one and the unread ones", () => {
    const groups = sidebarGroups({
      ...noDms,
      channels,
      selectedChannelId: "c2",
      unreadChannelIds: new Set(["c1"]),
      mode: "channels",
      canManage: false,
    });
    const channelGroup = groups.find((g) => g.label === "Channels");
    expect(channelGroup?.items.map((i) => [i.label, i.active, i.unread, i.icon])).toEqual([
      ["general", false, true, "hash"],
      ["release-train", true, false, "lock"],
    ]);
    expect(channelGroup?.items.every((i) => i.testId === "channel-list-item")).toBe(true);
  });

  test("a Channel is not shown as open while another mode is on screen", () => {
    const groups = sidebarGroups({ ...noDms, channels, selectedChannelId: "c1", unreadChannelIds: new Set(), mode: "dms", canManage: false });
    const items = groups.flatMap((g) => g.items);
    expect(items.find((i) => i.label === "general")?.active).toBe(false);
    expect(items.some((i) => i.active)).toBe(false);
  });

  test("the Channels label itself returns to the Channel on screen (flow 7's mode-channels)", () => {
    const groups = sidebarGroups({ ...noDms, channels, selectedChannelId: "c1", unreadChannelIds: new Set(), mode: "admin", canManage: true });
    expect(groups[0]).toMatchObject({ label: "Channels", mode: "channels", testId: "mode-channels" });
  });

  test("hides the admin console from someone who cannot manage the Workspace", () => {
    const items = sidebarGroups({ ...noDms, channels, selectedChannelId: null, unreadChannelIds: new Set(), mode: "channels", canManage: false }).flatMap((g) => g.items);
    expect(items.map((i) => i.mode)).not.toContain("admin");
    expect(items.map((i) => i.testId)).toContain("mode-settings");
  });

  test("offers the admin console to an admin, with the test hook the flows use", () => {
    const items = sidebarGroups({ ...noDms, channels, selectedChannelId: null, unreadChannelIds: new Set(), mode: "admin", canManage: true }).flatMap((g) => g.items);
    const admin = items.find((i) => i.mode === "admin");
    expect(admin?.testId).toBe("mode-admin");
    expect(admin?.active).toBe(true);
  });
});

/** Direct messages as a sidebar section (#142): each conversation is a row, as in the prototype,
 * and opening one shows only that conversation. */
describe("sidebarGroups › Direct messages", () => {
  const conversations = [
    { key: "ana,me", peerPubkeys: ["ana"] },
    { key: "me,sprig", peerPubkeys: ["sprig"] },
    { key: "marina,me,sprig", peerPubkeys: ["marina", "sprig"] },
  ];
  const dmGroup = (overrides: Partial<Parameters<typeof sidebarGroups>[0]> = {}) =>
    sidebarGroups({
      ...noDms,
      channels,
      selectedChannelId: "c1",
      unreadChannelIds: new Set(),
      mode: "dms",
      canManage: false,
      conversations,
      ...overrides,
    }).find((g) => g.label === "Direct messages");

  test("lists the conversations in the order given, named after the other participants", () => {
    const group = dmGroup();
    expect(group?.items.map((i) => [i.label, i.icon, i.peerPubkeys])).toEqual([
      ["Ana Petrova", "user", ["ana"]],
      ["Sprig", "bot", ["sprig"]],
      ["Marina Silva, Sprig", "user", ["marina", "sprig"]],
    ]);
    expect(group?.items.every((i) => i.testId === "conversation-list-item" && i.mode === "dms")).toBe(true);
    expect(group?.newMessageLabel).toBe("New message");
  });

  test("marks the open conversation and how many Messages each unread one has", () => {
    const group = dmGroup({ selectedConversationKey: "me,sprig", unreadConversationCounts: new Map([["ana,me", 3]]) });
    expect(group?.items.map((i) => [i.label, i.active, i.unread, i.unreadCount])).toEqual([
      ["Ana Petrova", false, true, 3],
      ["Sprig", true, false, null],
      ["Marina Silva, Sprig", false, false, null],
    ]);
  });

  test("a conversation is not shown as open while another mode is on screen", () => {
    expect(dmGroup({ selectedConversationKey: "ana,me", mode: "channels" })?.items[0]?.active).toBe(false);
  });

  test("replaces the single Direct messages entry the Workspace group used to have", () => {
    const labels = sidebarGroups({ ...noDms, channels, selectedChannelId: null, unreadChannelIds: new Set(), mode: "channels", canManage: true }).map((g) => g.label);
    expect(labels).toEqual(["Channels", "Direct messages", "Workspace"]);
    const workspace = sidebarGroups({ ...noDms, channels, selectedChannelId: null, unreadChannelIds: new Set(), mode: "channels", canManage: true }).at(-1);
    expect(workspace?.items.map((i) => i.testId)).toEqual(["mode-admin", "mode-settings"]);
  });
});

/** Moving between modes, and opening Admin on a given tab — Channels, from an empty Channel
 * list (#136). */
describe("navigateTo", () => {
  test("the app starts on Channels, with no Admin tab asked for", () => {
    expect(START_NAVIGATION).toMatchObject({ mode: "channels", adminTab: undefined });
  });

  test("asking for an Admin tab opens Admin on it, again each time it is asked for", () => {
    const first = navigateTo(START_NAVIGATION, { mode: "admin", adminTab: "channels" });
    expect(first).toMatchObject({ mode: "admin", adminTab: "channels" });
    // Already in Admin: a new visit is what makes the console re-open on the tab.
    const again = navigateTo(first, { mode: "admin", adminTab: "channels" });
    expect(again.adminVisit).not.toBe(first.adminVisit);
  });

  test("ordinary navigation asks for no tab and leaves an open console as it is", () => {
    const inAdmin = navigateTo(START_NAVIGATION, { mode: "admin", adminTab: "channels" });
    const viaSidebar = navigateTo(inAdmin, { mode: "admin" });
    expect(viaSidebar).toMatchObject({ mode: "admin", adminTab: undefined, adminVisit: inAdmin.adminVisit });
    expect(navigateTo(viaSidebar, { mode: "dms" }).mode).toBe("dms");
  });

  test("the account menu opens Settings on Profile, again each time it is asked for (#148)", () => {
    const first = navigateTo(START_NAVIGATION, { mode: "settings", settingsSection: "profile" });
    expect(first).toMatchObject({ mode: "settings", settingsSection: "profile" });
    const again = navigateTo(first, { mode: "settings", settingsSection: "profile" });
    expect(again.settingsVisit).not.toBe(first.settingsVisit);
    // Settings from the sidebar list asks for no section.
    expect(navigateTo(again, { mode: "settings" })).toMatchObject({ settingsSection: undefined, settingsVisit: again.settingsVisit });
  });
});

describe("initials", () => {
  test("takes the first letter of the first two words", () => {
    expect(initials("Renato Bardi")).toBe("RB");
    expect(initials("Ana Maria Silva")).toBe("AM");
  });
  test("one word gives one letter, nothing gives a placeholder", () => {
    expect(initials("sprig")).toBe("S");
    expect(initials("   ")).toBe("?");
  });
  test("a bare pubkey-style name is not spelled out", () => {
    expect(initials("npub1abc")).toBe("N");
  });
});
