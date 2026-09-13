import { describe, expect, test } from "bun:test";
import { initials, sidebarGroups } from "./sidebar";

const channels = [
  { id: "c1", name: "general", private: false },
  { id: "c2", name: "release-train", private: true },
];

/** The persistent sidebar's contents (#68): Channels, Direct messages and — only for someone
 * who may manage the Workspace — the admin console, plus Settings. What the person may not do
 * is not drawn, rather than drawn and refused later. */
describe("sidebarGroups", () => {
  test("lists every Channel under Channels, marking the open one and the unread ones", () => {
    const groups = sidebarGroups({
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
    const groups = sidebarGroups({ channels, selectedChannelId: "c1", unreadChannelIds: new Set(), mode: "dms", canManage: false });
    const items = groups.flatMap((g) => g.items);
    expect(items.find((i) => i.label === "general")?.active).toBe(false);
    expect(items.find((i) => i.mode === "dms")?.active).toBe(true);
  });

  test("the Channels label itself returns to the Channel on screen (flow 7's mode-channels)", () => {
    const groups = sidebarGroups({ channels, selectedChannelId: "c1", unreadChannelIds: new Set(), mode: "admin", canManage: true });
    expect(groups[0]).toMatchObject({ label: "Channels", mode: "channels", testId: "mode-channels" });
  });

  test("hides the admin console from someone who cannot manage the Workspace", () => {
    const items = sidebarGroups({ channels, selectedChannelId: null, unreadChannelIds: new Set(), mode: "channels", canManage: false }).flatMap((g) => g.items);
    expect(items.map((i) => i.mode)).not.toContain("admin");
    expect(items.map((i) => i.testId)).toEqual(expect.arrayContaining(["mode-dms", "mode-settings"]));
  });

  test("offers the admin console to an admin, with the test hook the flows use", () => {
    const items = sidebarGroups({ channels, selectedChannelId: null, unreadChannelIds: new Set(), mode: "admin", canManage: true }).flatMap((g) => g.items);
    const admin = items.find((i) => i.mode === "admin");
    expect(admin?.testId).toBe("mode-admin");
    expect(admin?.active).toBe(true);
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
