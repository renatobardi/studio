import { describe, expect, test } from "bun:test";
import type { Filter, VerifiedEvent } from "nostr-tools";
import type { ChannelOut } from "./api";
import type { SubscriptionHandlers } from "./relay";
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
  const rosterClient = () => {
    const subscriptions: { filters: Filter[]; handlers: SubscriptionHandlers; closed: boolean }[] = [];
    return {
      subscriptions,
      client: {
        subscribe(filters: Filter[], handlers: SubscriptionHandlers) {
          const sub = { filters, handlers, closed: false };
          subscriptions.push(sub);
          const close = () => {
            sub.closed = true;
          };
          return Object.assign(close, { update: () => {} });
        },
      },
    };
  };
  const projection = (kind: number, pubkeys: string[], createdAt = 100, id = `${kind}-${createdAt}`) =>
    ({ id, kind, created_at: createdAt, tags: [["d", "c1"], ...pubkeys.map((p) => ["p", p])] }) as VerifiedEvent;

  test("asks one subscription for both of the Channel's projections", () => {
    const { client, subscriptions } = rosterClient();

    subscribeRoster(client, "c1", () => {}, () => {});

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.filters).toEqual([
      { kinds: [39002], "#d": ["c1"] },
      { kinds: [39001], "#d": ["c1"] },
    ]);
  });

  test("reads the member list (39002) as the roster and the admin list (39001) as the admins", () => {
    const { client, subscriptions } = rosterClient();
    const roster: string[][] = [];
    const admins: string[][] = [];

    subscribeRoster(client, "c1", (pubkeys) => roster.push(pubkeys), (pubkeys) => admins.push(pubkeys));
    subscriptions[0]!.handlers.onEvent(projection(39002, ["aa", "bb"]));
    subscriptions[0]!.handlers.onEvent(projection(39001, ["aa"]));

    expect(roster).toEqual([["aa", "bb"]]);
    expect(admins).toEqual([["aa"]]);
  });

  test("ignores a projection older than the one already applied, per kind (#197)", () => {
    // A reconnect, or a second relay, can deliver the replaced event after its replacement.
    const { client, subscriptions } = rosterClient();
    const roster: string[][] = [];
    const admins: string[][] = [];
    subscribeRoster(client, "c1", (pubkeys) => roster.push(pubkeys), (pubkeys) => admins.push(pubkeys));
    const { onEvent } = subscriptions[0]!.handlers;

    onEvent(projection(39002, ["aa", "bb"], 200));
    onEvent(projection(39001, ["aa"], 50));
    onEvent(projection(39002, ["aa"], 150));
    onEvent(projection(39001, ["bb"], 60));

    expect(roster).toEqual([["aa", "bb"]]);
    expect(admins).toEqual([["aa"], ["bb"]]);
  });

  test("between two projections of the same second, keeps the lower id, as NIP-01 replaces", () => {
    const { client, subscriptions } = rosterClient();
    const roster: string[][] = [];
    subscribeRoster(client, "c1", (pubkeys) => roster.push(pubkeys), () => {});
    const { onEvent } = subscriptions[0]!.handlers;

    onEvent(projection(39002, ["bb"], 100, "b"));
    onEvent(projection(39002, ["aa"], 100, "a"));
    onEvent(projection(39002, ["cc"], 100, "c"));

    expect(roster).toEqual([["bb"], ["aa"]]);
  });

  test("hands back the unsubscribe, so leaving the Channel closes it", () => {
    const { client, subscriptions } = rosterClient();

    subscribeRoster(client, "c1", () => {}, () => {})();

    expect(subscriptions[0]!.closed).toBe(true);
  });
});
