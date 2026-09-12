import { describe, expect, test } from "bun:test";
import type { ChannelOut } from "./api";
import { canManageChannels, initialSelection, keepSelection, manageableChannels } from "./channelAccess";

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
