import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Signer } from "../../lib/custody";
import { buildDmImetaTag } from "../../lib/dmMedia";
import { DM_LOOKING_FOR_OLDER } from "../../lib/conversationCopy";
import { DM_SHOWN_STEP } from "../../lib/dmPagination";
import type { Rumor } from "../../lib/nip17";
import type { RelayClient } from "../../lib/relay";
import { ConversationView } from "./ConversationView";
import * as dmAttachmentImage from "./DmAttachmentImage";
import { shortNpub, type Profile } from "./useProfiles";

const ME = "1".padEnd(64, "a");
const ANA = "2".padEnd(64, "b");
const BRUNO = "3".padEnd(64, "c");

const render = (
  peerPubkeys: string[],
  profiles: Map<string, Profile>,
  history: { messages?: Rumor[]; completeFrom?: number; hasMore?: boolean; pages?: number } = {},
) =>
  renderToStaticMarkup(
    <ConversationView
      client={{} as RelayClient}
      ownPubkey={ME}
      peerPubkeys={peerPubkeys}
      signer={{} as Signer}
      mediaUrl="https://media.example"
      messages={history.messages ?? []}
      completeFrom={history.completeFrom ?? -Infinity}
      hasMore={history.hasMore ?? false}
      pages={history.pages ?? 0}
      onLoadOlder={() => {}}
      profiles={profiles}
    />,
  );

const text = (id: string, createdAt: number): Rumor => ({
  id,
  pubkey: ANA,
  created_at: createdAt,
  kind: 14,
  tags: [],
  content: `text ${id}.`,
});

const named = (pubkey: string, name: string) => new Map([[pubkey, { name } as Profile]]);

/** A Direct Message names the person, not their key (#153): the header carries the name over the
 * short npub, the composer says where the Message goes, and the timeline opens with the relay's
 * encryption notice. */
describe("ConversationView", () => {
  test("heads a one-to-one conversation with the name and the short npub", () => {
    const html = render([ANA], named(ANA, "Ana Petrova"));
    expect(html).toContain("<h1 class=\"conversation-name\">Ana Petrova</h1>");
    expect(html).toContain(`<span class="conversation-handle">${shortNpub(ANA)}</span>`);
  });

  test("names the person in the composer placeholder", () => {
    expect(render([ANA], named(ANA, "Ana Petrova"))).toContain('placeholder="Message Ana Petrova"');
  });

  test("opens the timeline with the end-to-end encryption notice", () => {
    expect(render([ANA], named(ANA, "Ana Petrova"))).toContain(
      "Direct messages are end-to-end encrypted on this relay.",
    );
  });

  test("drops the avatar and the handle from a group conversation, and lists both names", () => {
    const profiles = new Map([
      [ANA, { name: "Ana Petrova" } as Profile],
      [BRUNO, { name: "Bruno Sá" } as Profile],
    ]);
    const html = render([ANA, BRUNO], profiles);
    expect(html).toContain("Ana Petrova, Bruno Sá");
    expect(html).not.toContain("conversation-handle");
  });

  test("gives the newest Message's photo the highest download priority", () => {
    // #181/#188: a conversation queues every photo of its history at once; the one just sent is
    // the one being waited on, so it must not queue behind the oldest.
    const photo = (sha: string, createdAt: number): Rumor => ({
      id: sha.slice(0, 8),
      pubkey: ANA,
      created_at: createdAt,
      kind: 14,
      tags: [buildDmImetaTag({ url: `https://media.example/${sha}`, sha256: sha, size: 1, type: "application/octet-stream" }, "k".repeat(64), "image/png")],
      content: "",
    });
    const stub = spyOn(dmAttachmentImage, "DmAttachmentImage").mockImplementation(({ attachment, priority }) => (
      <i data-photo={attachment.sha256} data-priority={priority} />
    ));

    const html = renderToStaticMarkup(
      <ConversationView
        client={{} as RelayClient}
        ownPubkey={ME}
        peerPubkeys={[ANA]}
        signer={{} as Signer}
        mediaUrl="https://media.example"
        messages={[photo("o".repeat(64), 1), photo("n".repeat(64), 2)]}
        completeFrom={-Infinity}
        pages={0}
        hasMore={false}
        onLoadOlder={() => {}}
        profiles={named(ANA, "Ana Petrova")}
      />,
    );
    stub.mockRestore();

    const priorityOf = (sha: string) => Number(new RegExp(`data-photo="${sha}" data-priority="(-?\\d+)"`).exec(html)?.[1]);
    expect(priorityOf("n".repeat(64))).toBeGreaterThan(priorityOf("o".repeat(64)));
  });

  test("mounts only the newest step of the conversation, so older photos are not fetched (#185)", () => {
    const messages = Array.from({ length: DM_SHOWN_STEP + 10 }, (_, i) => text(`m${i}`, i));
    const html = render([ANA], named(ANA, "Ana Petrova"), { messages });
    expect(html.match(/data-testid="dm-message"/g)).toHaveLength(DM_SHOWN_STEP);
    expect(html).not.toContain("text m9.");
    expect(html).toContain("text m10.");
    expect(html).toContain("Load older messages");
  });

  test("leaves out Messages whose history is not complete yet, and offers to load it", () => {
    const html = render([ANA], named(ANA, "Ana Petrova"), {
      messages: [text("old", 10), text("new", 30)],
      completeFrom: 20,
      hasMore: true,
    });
    expect(html).not.toContain("text old.");
    expect(html).toContain("text new.");
    expect(html).toContain("Load older messages");
  });

  test("a conversation whose last Message is older than the history says so, instead of opening blank", () => {
    // Its Messages are all below where the history is complete: the panel would otherwise be an
    // empty box next to a sidebar row that says there is a conversation there (#231).
    const html = render([ANA], named(ANA, "Ana Petrova"), {
      messages: [text("old", 10)],
      completeFrom: 20,
      hasMore: true,
    });
    expect(html).not.toContain("text old.");
    expect(html).toContain(DM_LOOKING_FOR_OLDER);
  });

  test("says nothing about looking once there is something to show", () => {
    const html = render([ANA], named(ANA, "Ana Petrova"), {
      messages: [text("old", 10), text("new", 30)],
      completeFrom: 20,
      hasMore: true,
    });
    expect(html).not.toContain(DM_LOOKING_FOR_OLDER);
  });

  test("offers nothing older once all of it is on screen", () => {
    expect(render([ANA], named(ANA, "Ana Petrova"), { messages: [text("only", 1)] })).not.toContain(
      "Load older messages",
    );
  });
});
