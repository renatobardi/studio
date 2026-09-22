import { describe, expect, spyOn, test } from "bun:test";
import { fireEvent, render as mount } from "@testing-library/react";
import type { VerifiedEvent } from "nostr-tools";
import { renderToStaticMarkup } from "react-dom/server";
import * as channelEvents from "../../lib/channelEvents";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
import * as attachmentImage from "./AttachmentImage";
import { Timeline } from "./Timeline";
import { verifiedEvent } from "../../lib/testing/events";

const ME = "1".padEnd(64, "a");
const OTHER = "2".padEnd(64, "b");

const message = (id: string, pubkey: string, createdAt: number, content: string) =>
  verifiedEvent({ id, pubkey, created_at: createdAt, content, kind: 9, tags: [], sig: "" });

function render(messages: VerifiedEvent[], opened: { readAt: number; openedAt: number } | null) {
  return renderToStaticMarkup(
    <Timeline
      client={{} as RelayClient}
      channelId="channel"
      channelName="general"
      ownPubkey={ME}
      signer={{} as Signer}
      mediaUrl="https://media.example"
      messages={messages}
      replies={[]}
      reactions={[]}
      deletions={[]}
      hasMore={false}
      onLoadOlder={() => {}}
      profiles={new Map()}
      opened={opened}
      openThreadRootId={null}
      onOpenThread={() => {}}
    />,
  );
}

/** The "New" divider sits above the first Message that arrived while the Channel was not on
 * screen (#147) — the timeline renders what `messagesWithDivider` decides. */
describe("Timeline", () => {
  const away = message("away", OTHER, 150, "while you were away");

  test("gives a photo the priority of the Message carrying it, not its place in this list", () => {
    // The download queue is the Direct Messages' too, so the scale has to be the same (#234).
    const photo = (id: string, createdAt: number, sha: string) =>
      verifiedEvent({
        ...message(id, OTHER, createdAt, ""),
        tags: [["imeta", `url https://media.example/${sha}`, `x ${sha}`, "m image/png"]],
      });
    const stub = spyOn(attachmentImage, "AttachmentImage").mockImplementation(({ descriptor, priority }) => (
      <i data-photo={descriptor.sha256} data-priority={priority} />
    ));
    const html = render([photo("old", 1000, "a".repeat(64)), photo("new", 2000, "b".repeat(64))], null);
    stub.mockRestore();

    const priorityOf = (sha: string) => Number(new RegExp(`data-photo="${sha}" data-priority="(-?\\d+)"`).exec(html)?.[1]);
    expect(priorityOf("a".repeat(64))).toBe(1000);
    expect(priorityOf("b".repeat(64))).toBe(2000);
  });

  test("draws the divider above the first Message that arrived since the Channel was read", () => {
    const html = render([message("read", OTHER, 50, "already read"), away], { readAt: 100, openedAt: 200 });
    expect(html).toContain('data-testid="new-divider"');
    expect(html.indexOf("already read")).toBeLessThan(html.indexOf("new-divider"));
    expect(html.indexOf("new-divider")).toBeLessThan(html.indexOf("while you were away"));
  });

  test("draws no divider when every Message was already read", () => {
    const html = render([message("read", OTHER, 50, "already read")], { readAt: 100, openedAt: 200 });
    expect(html).not.toContain("new-divider");
  });

  test("draws no divider above a Message of this browser's own Identity", () => {
    // #191: with the prop misnamed the Timeline never knew who "own" was, and this rule went
    // unexercised — every other fixture here is somebody else's.
    const mine = message("mine", ME, 150, "sent from another device");
    expect(render([message("read", OTHER, 50, "already read"), mine], { readAt: 100, openedAt: 200 })).not.toContain(
      "new-divider",
    );
  });

  test("draws no divider before a Channel has been opened", () => {
    expect(render([away], null)).not.toContain("new-divider");
  });
});

/** #194: every row read its Reactions and Thread by filtering the Channel's whole data again —
 * once per Message, on every render. The rows now read one index, built once per render at most
 * (and not at all when only the composer changed, since it is memoised on the data). */
describe("Timeline's per-Message data", () => {
  test("is indexed once for the whole timeline, not once per Message", () => {
    const spy = spyOn(channelEvents, "messageIndex");
    try {
      render([message("a", OTHER, 1, "one"), message("b", OTHER, 2, "two"), message("c", ME, 3, "three")], null);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

/** The scroll that asks for older Messages is wiring: the rule is `createScrollWatcher`, tested in
 * lib/, and what only a mounted Timeline shows is that it is the rule `onScroll` asks (#225). */
describe("Timeline scrolling at the top of the history", () => {
  function mounted() {
    let asked = 0;
    const timelineWith = (messages: VerifiedEvent[]) => (
      <Timeline
        client={{} as RelayClient}
        channelId="channel"
        channelName="general"
        ownPubkey={ME}
        signer={{} as Signer}
        mediaUrl="https://media.example"
        messages={messages}
        replies={[]}
        reactions={[]}
        deletions={[]}
        hasMore
        onLoadOlder={() => (asked += 1)}
        profiles={new Map()}
        opened={null}
        openThreadRootId={null}
        onOpenThread={() => {}}
      />
    );
    const oldest = message("m1", OTHER, 100, "the oldest loaded");
    const { container, rerender } = mount(timelineWith([oldest]));
    const timeline = container.querySelector(".timeline-scroll")!;
    /** A Message arriving: the Timeline renders again, and where it was scrolled to must survive. */
    const receive = () => rerender(timelineWith([oldest, message("m2", OTHER, 200, "just now")]));
    /** happy-dom lays nothing out, so it has nowhere to scroll to: the position is set by hand,
     * and the event is what the Timeline answers. */
    const scrollTo = (top: number) => {
      Object.defineProperty(timeline, "scrollTop", { value: top, configurable: true });
      fireEvent.scroll(timeline);
    };
    return { scrollTo, receive, asked: () => asked };
  }

  test("scrolling down from the top asks for nothing (#225)", () => {
    // A Channel opens at the top of what it loaded, so the first scroll there is the reader going
    // down into it — and asking for a page there fetched one nobody wanted.
    const { scrollTo, asked } = mounted();
    scrollTo(40);
    expect(asked()).toBe(0);
  });

  test("and scrolling back up to it does ask — even with a render in between", () => {
    // Where the reader was is remembered across renders: a watcher made again on each one would
    // read the way back up as coming from 0, and never ask.
    const { scrollTo, receive, asked } = mounted();
    scrollTo(40);
    receive();
    scrollTo(10);
    expect(asked()).toBe(1);
  });
});
