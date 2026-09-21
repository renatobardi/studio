import { describe, expect, test } from "bun:test";
import type { Filter, VerifiedEvent } from "nostr-tools";
import { ProfileStore, type ProfileClient } from "./profileStore";
import type { ConnectionState, SubscriptionHandlers } from "./relay";
import { verifiedEvent } from "./testing/events";

interface FakeSubscription {
  filters: Filter[];
  handlers: SubscriptionHandlers;
  closed: boolean;
}

/** Stands in for `RelayClient`: a REQ goes out only while the connection is open — on open it
 * re-issues each subscription's current filters once, as `resubscribeAll` does. */
function fakeClient(initial: ConnectionState = "open") {
  const subscriptions: FakeSubscription[] = [];
  const stateListeners = new Set<(state: ConnectionState) => void>();
  let reqs = 0;
  const client = {
    state: initial,
    onStateChange(listener: (state: ConnectionState) => void) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribe(filters: Filter[], handlers: SubscriptionHandlers) {
      const sub: FakeSubscription = { filters, handlers, closed: false };
      subscriptions.push(sub);
      if (client.state === "open") reqs += 1;
      const close = () => {
        sub.closed = true;
      };
      return Object.assign(close, {
        update(next: Filter[]) {
          sub.filters = next;
          if (client.state === "open") reqs += 1;
        },
      });
    },
  } satisfies ProfileClient;
  const setState = (state: ConnectionState) => {
    client.state = state;
    for (const listener of stateListeners) listener(state);
    if (state === "open") reqs += subscriptions.filter((sub) => !sub.closed).length;
  };
  return { client, subscriptions, setState, reqs: () => reqs };
}

function profileEvent(pubkey: string, content: string): VerifiedEvent {
  return verifiedEvent({ id: `e-${pubkey}`, kind: 0, pubkey, created_at: 0, tags: [], content, sig: "" });
}

describe("ProfileStore.ensure", () => {
  test("widens one subscription instead of opening another per batch", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);

    store.ensure(["a"]);
    store.ensure(["b", "c"]);

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.filters).toEqual([{ kinds: [0], authors: ["a", "b", "c"] }]);
    expect(subscriptions[0]!.closed).toBe(false);
  });

  test("asks for nothing when every pubkey was already requested", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);

    store.ensure(["a"]);
    store.ensure(["a"]);

    expect(subscriptions[0]!.filters).toEqual([{ kinds: [0], authors: ["a"] }]);
  });

  test("keeps listening past EOSE, so another client's profile edit still lands", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);
    store.ensure(["a"]);
    const sub = subscriptions[0]!;

    sub.handlers.onEvent(profileEvent("a", JSON.stringify({ name: "Ana" })));
    sub.handlers.onEose?.();

    expect(sub.closed).toBe(false);

    // kind 0 is replaceable: the later edit must reach this session (#86).
    sub.handlers.onEvent(profileEvent("a", JSON.stringify({ name: "Ana Maria" })));
    expect(store.getSnapshot().get("a")).toEqual({ name: "Ana Maria" });
  });

  test("ignores a profile whose content is not JSON", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);
    store.ensure(["a"]);

    subscriptions[0]!.handlers.onEvent(profileEvent("a", "not json"));

    expect(store.getSnapshot().has("a")).toBe(false);
  });

  test("notifies listeners with a fresh snapshot on each profile", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().size));
    store.ensure(["a"]);

    const before = store.getSnapshot();
    subscriptions[0]!.handlers.onEvent(profileEvent("a", JSON.stringify({ name: "Ana" })));

    expect(seen).toEqual([1]);
    expect(before).not.toBe(store.getSnapshot());
  });
});

describe("ProfileStore.close", () => {
  test("releases the subscription so it does not outlive the hook", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);
    store.ensure(["a"]);

    store.close();

    expect(subscriptions[0]!.closed).toBe(true);
  });

  test("subscribes again after a close, rather than reusing a dead handle", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);
    store.ensure(["a"]);
    store.close();

    store.ensure(["b"]);

    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[1]!.filters).toEqual([{ kinds: [0], authors: ["a", "b"] }]);
  });

  test("subscribes again for the same pubkeys after a close — StrictMode replays the mount (#143)", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);
    store.ensure(["a"]);
    store.close();

    store.ensure(["a"]);

    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[1]!.filters).toEqual([{ kinds: [0], authors: ["a"] }]);
  });
});

/** A relay that has nothing for an author says so only by ending the query (#196): the store
 * records that answer, so "not published" can be told apart from "not heard back yet". */
describe("ProfileStore answers", () => {
  test("an author the relay answered without a kind 0 is known to have none", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);
    store.ensure(["a", "b"]);
    subscriptions[0]!.handlers.onEvent(profileEvent("a", JSON.stringify({ name: "Ana" })));
    expect(store.getSnapshot().has("b")).toBe(false);

    subscriptions[0]!.handlers.onEose?.();

    expect(store.getSnapshot().get("a")).toEqual({ name: "Ana" });
    expect(store.getSnapshot().get("b")).toEqual({});
  });

  test("an EOSE answers only the authors of the REQ it ends", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);
    store.ensure(["a"]);
    store.ensure(["b"]);

    subscriptions[0]!.handlers.onEose?.();
    expect(store.getSnapshot().get("a")).toEqual({});
    expect(store.getSnapshot().has("b")).toBe(false);

    subscriptions[0]!.handlers.onEose?.();
    expect(store.getSnapshot().get("b")).toEqual({});
  });

  test("asked before the connection opens, the one REQ it then sends answers every author", () => {
    // The shell asks for its own pubkey and the Members' before the relay has authenticated: the
    // client sends a single REQ on open, so a single EOSE has to answer both batches.
    const { client, subscriptions, setState } = fakeClient("connecting");
    const store = new ProfileStore(client);
    store.ensure(["members"]);
    store.ensure(["own"]);
    setState("open");
    subscriptions[0]!.handlers.onEose?.();
    expect([...store.getSnapshot().keys()].sort()).toEqual(["members", "own"]);
  });

  test("a REQ lost with a dropped connection is answered by the one the reconnect sends", () => {
    const { client, subscriptions, setState } = fakeClient();
    const store = new ProfileStore(client);
    store.ensure(["a"]);
    store.ensure(["b"]);
    setState("reconnecting");
    setState("open");
    subscriptions[0]!.handlers.onEose?.();
    expect([...store.getSnapshot().keys()].sort()).toEqual(["a", "b"]);
  });

  test("each EOSE still answers only its own REQ while the connection stays open", () => {
    const { client, subscriptions, setState, reqs } = fakeClient("connecting");
    const store = new ProfileStore(client);
    store.ensure(["a"]);
    setState("open");
    store.ensure(["b"]);
    expect(reqs()).toBe(2);
    subscriptions[0]!.handlers.onEose?.();
    expect(store.getSnapshot().has("b")).toBe(false);
  });

  test("a closed store stops following the connection", () => {
    const { client, subscriptions, setState } = fakeClient();
    const store = new ProfileStore(client);
    store.ensure(["a"]);
    store.close();
    setState("open");
    subscriptions[0]!.handlers.onEose?.();
    expect(store.getSnapshot().size).toBe(0);
  });

  test("a kind 0 published later replaces the empty answer", () => {
    const { client, subscriptions } = fakeClient();
    const store = new ProfileStore(client);
    let heard = 0;
    store.subscribe(() => (heard += 1));
    store.ensure(["a"]);
    subscriptions[0]!.handlers.onEose?.();
    subscriptions[0]!.handlers.onEvent(profileEvent("a", JSON.stringify({ name: "Ana" })));
    expect(store.getSnapshot().get("a")).toEqual({ name: "Ana" });
    expect(heard).toBe(2);
  });
});
