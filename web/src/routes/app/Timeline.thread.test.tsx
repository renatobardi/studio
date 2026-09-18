import { describe, expect, test } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent } from "nostr-tools";
import { renderToStaticMarkup } from "react-dom/server";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
import type { Profile } from "./useProfiles";
import { Timeline } from "./Timeline";

const authorKey = generateSecretKey();
const author = getPublicKey(authorKey);
const replierKey = generateSecretKey();
const replier = getPublicKey(replierKey);

function sign(
  secretKey: Uint8Array,
  kind: number,
  tags: string[][],
  content: string,
  createdAt: number,
): VerifiedEvent {
  return finalizeEvent({ kind, tags, content, created_at: createdAt }, secretKey);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function render(replies: VerifiedEvent[], profiles: Map<string, Profile> = new Map()) {
  const message = sign(authorKey, 9, [["h", "chan1"]], "shall we?", nowSeconds() - 3600);
  return renderToStaticMarkup(
    <Timeline
      client={{} as unknown as RelayClient}
      channelId="chan1"
      pubkey={author}
      signer={{} as unknown as Signer}
      mediaUrl="https://media.example"
      messages={[message]}
      replies={replies.map((reply) => sign(replierKey, 1111, [["E", message.id]], reply.content, reply.created_at))}
      reactions={[]}
      deletions={[]}
      hasMore={false}
      onLoadOlder={() => {}}
      profiles={profiles}
      opened={null}
      openThreadRootId={null}
      onOpenThread={() => {}}
    />,
  );
}

/** A reply only carries the two fields `render` reuses — its own signature is rebuilt there
 * against the Message it answers. */
const reply = (content: string, agoSeconds: number) =>
  ({ content, created_at: nowSeconds() - agoSeconds }) as VerifiedEvent;

/** The prototype's thread pill says who is in the conversation and how fresh it is
 * ("4 replies · last reply 12m ago"), not just the count (#146). */
describe("Timeline thread pill", () => {
  test("carries the reply count and how long ago the latest reply landed", () => {
    const html = render([reply("on my way", 7200), reply("yes", 720)]);
    expect(html).toContain("2 replies");
    expect(html).toContain("last reply 12m ago");
  });

  test("draws an avatar for each participant, and a name when their profile is known", () => {
    const profiles = new Map<string, Profile>([[replier, { name: "Ana Petrova" }]]);
    const html = render([reply("yes", 60)], profiles);
    expect(html).toContain('class="thread-open-avatars"');
    expect(html).toContain(">AP<");
  });

  test("a Message with no replies has no pill at all", () => {
    const html = render([]);
    expect(html).not.toContain("thread-open-row");
    expect(html).not.toContain("last reply");
  });
});
