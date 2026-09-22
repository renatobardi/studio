import { afterEach, describe, expect, jest, test } from "bun:test";
import { act, render as mount } from "@testing-library/react";
import type { Filter } from "nostr-tools";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChannelOut, WorkspaceOut } from "../../lib/api";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
import { PAGE_DEADLINE_MS } from "../../lib/channelPagination";
import { FakeRelay } from "../../lib/testing/fakeRelay";
import { verifiedEvent } from "../../lib/testing/events";
import { ChannelView } from "./ChannelView";

const client = { subscribe: () => () => {} } as unknown as RelayClient;

const render = (channel: ChannelOut) =>
  renderToStaticMarkup(
    <ChannelView
      client={client}
      channel={channel}
      ownPubkey={"1".padEnd(64, "a")}
      signer={{} as Signer}
      opened={null}
      workspace={{ slug: "family", role: "member", media_url: "https://media.example" } as WorkspaceOut}
      workspaceMembers={[]}
      workspaceMembersError={null}
      threadView="split"
      profileLookup={{ profiles: new Map(), ensure: () => {} }}
    />,
  );

const channel = { id: "c1", name: "general", private: false } as ChannelOut;

/** The Channel's header carries the Members pill beside the name (#143). Before the relay has
 * answered, the roster is unknown: the pill is there, unpressed and without a count, and the
 * Members pane is closed. */
describe("ChannelView", () => {
  test("renders the Channel name and its Members pill in the header", () => {
    const html = render(channel);
    expect(html).toContain('aria-label="Channel general"');
    expect(html).toContain('aria-label="Members"');
    expect(html).toContain('aria-pressed="false"');
  });

  test("opens with no Members pane, and no count while the roster is unknown", () => {
    const html = render(channel);
    expect(html).not.toContain('data-testid="members-pane"');
    expect(html).toContain("</svg></button>");
  });

  test("marks a private Channel with the lock icon instead of the hash", () => {
    // The icons render as paths, so the shackle's own path is what tells the two apart.
    const shackle = 'd="M7 11V7a5 5 0 0 1 10 0v4"';
    expect(render({ ...channel, private: true })).toContain(shackle);
    expect(render(channel)).not.toContain(shackle);
  });
});

/** The wiring of #254: what the feed owes after a reconnect reaches the Channel's screen, beside
 * the Messages it already holds — none of which is taken off it meanwhile. */
describe("ChannelView after a reconnect the relay could not answer at once", () => {
  afterEach(() => jest.useRealTimers());

  test("says Messages are owed while they are, and offers to ask again once asking gave up", () => {
    const message = (id: string, createdAt: number) =>
      verifiedEvent({ id, kind: 9, created_at: createdAt, pubkey: "2".padEnd(64, "b"), tags: [["h", "c1"]], content: id, sig: "" });
    jest.useFakeTimers();
    const relay = new FakeRelay([message("held", 100_000)]);
    let stall = true;
    const stalling = {
      subscribe(filters: Filter[], handlers: Parameters<FakeRelay["subscribe"]>[1]) {
        const fills = filters[0]?.since !== undefined && filters[0]?.until !== undefined;
        if (!fills || !stall) return relay.subscribe(filters, handlers);
        return Object.assign(() => {}, { update: () => {} });
      },
    } as unknown as RelayClient;
    const view = mount(
      <ChannelView
        client={stalling}
        channel={channel}
        ownPubkey={"1".padEnd(64, "a")}
        signer={{} as Signer}
        opened={null}
        workspace={{ slug: "family", role: "member", media_url: "https://media.example" } as WorkspaceOut}
        workspaceMembers={[]}
        workspaceMembersError={null}
        threadView="split"
        profileLookup={{ profiles: new Map(), ensure: () => {} }}
      />,
    );
    expect(view.queryByTestId("gap-notice")).toBeNull();

    act(() => {
      relay.disconnect();
      for (let i = 0; i < 700; i++) relay.publish(message(`away${i}`, 200_000 + i));
      relay.reconnect();
    });
    expect(view.getByTestId("gap-notice").textContent).toContain("Recovering messages");
    expect(view.container.textContent).toContain("held");

    act(() => jest.advanceTimersByTime(PAGE_DEADLINE_MS));
    stall = false;
    act(() => view.getByRole("button", { name: "Try again" }).click());
    expect(view.queryByTestId("gap-notice")).toBeNull();
    expect(view.container.textContent).toContain("away0");
  });
});
