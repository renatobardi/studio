import { describe, expect, test } from "bun:test";
import type { ChannelOut } from "./api";
import {
  accessLostAfterRefresh,
  canManageChannels,
  initialSelection,
  keepSelection,
  manageableChannels,
  rosterPubkeys,
  subscribeRoster,
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

describe("rosterPubkeys", () => {
  test("lists the Channel Members a 39002 projection names, one per p tag", () => {
    const roster = { tags: [["d", "c1"], ["p", "aa", "admin"], ["p", "bb"], ["e", "xx"]] };
    expect(rosterPubkeys(roster)).toEqual(["aa", "bb"]);
  });

  test("is empty for a Channel with no Members left", () => {
    expect(rosterPubkeys({ tags: [["d", "c1"]] })).toEqual([]);
  });
});

describe("subscribeRoster", () => {
  function fakeClient() {
    const calls: { filters: unknown[]; handlers: { onEvent?: (event: never) => void } }[] = [];
    let closed = false;
    const client = {
      subscribe: (filters: unknown[], handlers: { onEvent?: (event: never) => void }) => {
        calls.push({ filters, handlers });
        return () => {
          closed = true;
        };
      },
    };
    return { client, calls, isClosed: () => closed };
  }

  test("asks the relay for this Channel's 39002 projection and reports its Members", () => {
    const { client, calls } = fakeClient();
    const seen: string[][] = [];
    subscribeRoster(client as never, "c1", (pubkeys) => seen.push(pubkeys));
    expect(calls[0].filters).toEqual([{ kinds: [39002], "#d": ["c1"] }]);
    calls[0].handlers.onEvent?.({ tags: [["p", "aa"], ["e", "xx"], ["p", "bb"]] } as never);
    expect(seen).toEqual([["aa", "bb"]]);
  });

  test("hands back the relay's unsubscribe, so the caller closes exactly one subscription", () => {
    const { client, isClosed } = fakeClient();
    subscribeRoster(client as never, "c1", () => {})();
    expect(isClosed()).toBe(true);
  });
});
