import { describe, expect, test } from "bun:test";
import type { Filter, VerifiedEvent } from "nostr-tools";
import { ProfileStore, type ProfileClient } from "./profileStore";
import type { SubscriptionHandlers } from "./relay";

interface FakeSubscription {
  filters: Filter[];
  handlers: SubscriptionHandlers;
  closed: boolean;
}

function fakeClient(): { client: ProfileClient; subscriptions: FakeSubscription[] } {
  const subscriptions: FakeSubscription[] = [];
  const client: ProfileClient = {
    subscribe(filters, handlers) {
      const sub: FakeSubscription = { filters, handlers, closed: false };
      subscriptions.push(sub);
      const close = () => {
        sub.closed = true;
      };
      return Object.assign(close, {
        update(next: Filter[]) {
          sub.filters = next;
        },
      });
    },
  };
  return { client, subscriptions };
}

function profileEvent(pubkey: string, content: string): VerifiedEvent {
  return { id: `e-${pubkey}`, kind: 0, pubkey, content } as VerifiedEvent;
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
});
