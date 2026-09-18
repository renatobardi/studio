import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChannelOut, WorkspaceOut } from "../../lib/api";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
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
      threadView="split"
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
