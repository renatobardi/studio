import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Signer } from "../../lib/custody";
import type { Rumor } from "../../lib/nip17";
import type { RelayClient } from "../../lib/relay";
import { ConversationView } from "./ConversationView";
import { shortNpub, type Profile } from "./useProfiles";

const ME = "1".padEnd(64, "a");
const ANA = "2".padEnd(64, "b");
const BRUNO = "3".padEnd(64, "c");

const render = (peerPubkeys: string[], profiles: Map<string, Profile>) =>
  renderToStaticMarkup(
    <ConversationView
      client={{} as RelayClient}
      myPubkey={ME}
      peerPubkeys={peerPubkeys}
      signer={{} as Signer}
      mediaUrl="https://media.example"
      messages={[] as Rumor[]}
      profiles={profiles}
    />,
  );

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
});
