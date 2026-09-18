import { describe, expect, test } from "bun:test";
import type { VerifiedEvent } from "nostr-tools";
import { renderToStaticMarkup } from "react-dom/server";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
import { Timeline } from "./Timeline";

const ME = "1".padEnd(64, "a");
const OTHER = "2".padEnd(64, "b");

const message = (id: string, pubkey: string, createdAt: number, content: string) =>
  ({ id, pubkey, created_at: createdAt, content, kind: 9, tags: [], sig: "" }) as unknown as VerifiedEvent;

function render(messages: VerifiedEvent[], opened: { readAt: number; openedAt: number } | null) {
  return renderToStaticMarkup(
    <Timeline
      client={{} as RelayClient}
      channelId="channel"
      pubkey={ME}
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

  test("draws no divider before a Channel has been opened", () => {
    expect(render([away], null)).not.toContain("new-divider");
  });
});
