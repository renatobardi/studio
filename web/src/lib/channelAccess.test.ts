import { describe, expect, test } from "bun:test";
import type { ChannelOut } from "./api";
import {
  accessLostAfterRefresh,
  canManageChannels,
  initialSelection,
  keepSelection,
  manageableChannels,
} from "./channelAccess";

function channel(id: string, role: string | null = null): ChannelOut {
  return { id, name: id, about: "", private: false, role };
}

describe("initialSelection", () => {
  test("resumes the remembered Channel when it is still accessible", () => {
    expect(initialSelection([channel("a"), channel("b")], "b")).toBe("b");
  });

  test("falls back to the first accessible Channel when the remembered one is gone", () => {
    expect(initialSelection([channel("a"), channel("b")], "gone")).toBe("a");
  });

  test("selects nothing when there is no Channel at all", () => {
    expect(initialSelection([], "gone")).toBeNull();
  });
});

describe("keepSelection", () => {
  test("keeps the active Channel while it is still listed", () => {
    expect(keepSelection([channel("a"), channel("b")], "b")).toBe("b");
  });

  test("drops the active Channel the moment access to it is lost", () => {
    // Not a jump to another Channel: losing access has to be visible, and
    // leaving the view is what stops further sends (#42).
    expect(keepSelection([channel("a")], "b")).toBeNull();
  });
});

describe("manageableChannels", () => {
  test("a Workspace admin manages every Channel, membership or not", () => {
    const channels = [channel("a"), channel("b", "member")];
    expect(manageableChannels("admin", channels)).toEqual(channels);
  });

  test("a plain Member manages only the Channels they are admin of", () => {
    const managed = channel("b", "admin");
    expect(manageableChannels("member", [channel("a", "member"), managed])).toEqual([managed]);
  });
});

describe("canManageChannels", () => {
  test("is true for a Channel admin who holds no Workspace admin role", () => {
    expect(canManageChannels("member", [channel("a", "admin")])).toBe(true);
  });

  test("is false for a Member who administers nothing", () => {
    expect(canManageChannels("member", [channel("a", "member")])).toBe(false);
  });

  test("is true for a Workspace owner with no Channel of their own", () => {
    expect(canManageChannels("owner", [])).toBe(true);
  });
});

describe("accessLostAfterRefresh", () => {
  test("reports the loss when the active Channel is no longer listed", () => {
    expect(accessLostAfterRefresh(false, "a", null)).toBe(true);
  });

  test("stays quiet while the active Channel is still listed", () => {
    expect(accessLostAfterRefresh(false, "a", "a")).toBe(false);
  });

  test("stays quiet when nothing was open to lose", () => {
    expect(accessLostAfterRefresh(false, null, null)).toBe(false);
  });

  test("keeps the notice up once the selection it refers to has been cleared", () => {
    // Removing a Channel Member projects both a member list (39002) and a
    // remove (9001), and the app re-reads on each. By the second pass the
    // selection is already gone, so recomputing from it would take the notice
    // back down before anyone read it (#42).
    expect(accessLostAfterRefresh(true, null, null)).toBe(true);
  });
});
