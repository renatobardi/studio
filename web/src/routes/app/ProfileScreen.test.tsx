import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConnectionState } from "../../lib/relay";
import { ProfileEditForm, ProfileScreenBody } from "./ProfileScreen";
import { shortNpub, type Profile } from "./useProfiles";

const PUBKEY = "6bbf5828".padEnd(64, "a");
const noop = { publish: async () => {} };
const signer = { signEvent: async () => ({}) as never };

const render = (profile: Profile | undefined, connectionState: ConnectionState = "open") =>
  renderToStaticMarkup(
    <ProfileScreenBody
      profile={profile}
      shownName={profile?.name ?? shortNpub(PUBKEY)}
      client={noop}
      signer={signer}
      pubkey={PUBKEY}
      relayUrl="wss://relay.studio.test"
      connectionState={connectionState}
      onClose={() => {}}
    />,
  );

/** The prototype's "Your profile" screen (#150): what this Identity published, the Info card, and
 * "Edit profile" — with only what the MVP has (docs/UI/REFERENCE.md › Decisões). */
describe("ProfileScreen", () => {
  test("shows the published name and bio over the abbreviated npub", () => {
    const html = render({ name: "Ana Petrova", about: "Building things" });
    expect(html).toContain("Ana Petrova");
    expect(html).toContain("Building things");
    expect(html).toContain("npub1");
    expect(html).not.toContain(PUBKEY.slice(0, 16));
  });

  test("leaves the bio out entirely when there is none, rather than showing an empty line", () => {
    expect(render(undefined)).not.toContain("profile-bio");
  });

  test("the Info card names the relay this session is on", () => {
    expect(render(undefined)).toContain("wss://relay.studio.test");
  });

  test("the presence dot follows the relay connection, which is all the MVP knows about presence", () => {
    expect(render(undefined, "reconnecting")).toContain('data-connection="reconnecting"');
  });

  test("opens read-only, with Edit profile as the way into the form", () => {
    const html = render({ name: "Ana Petrova" });
    expect(html).toContain("Edit profile");
    expect(html).not.toContain('placeholder="Display name"');
  });

  test("leaves out what the MVP does not have: no NIP-05, no Message, no Channels tab", () => {
    const html = render({ name: "Ana Petrova" });
    expect(html).not.toContain("Huddle");
    expect(html).not.toContain("Memories");
    expect(html).not.toContain("Wave");
  });
});

/** The same screen turned into the form: the onboarding avatars, the name, the bio. */
describe("ProfileEditForm", () => {
  const form = (overrides: Partial<Parameters<typeof ProfileEditForm>[0]> = {}) =>
    renderToStaticMarkup(
      <ProfileEditForm
        name="Ana Petrova"
        picture="🦊"
        about="Building things"
        saving={false}
        error={null}
        onName={() => {}}
        onPicture={() => {}}
        onAbout={() => {}}
        onCancel={() => {}}
        onSave={() => {}}
        {...overrides}
      />,
    );

  test("offers the onboarding avatars and marks the one in use", () => {
    const html = form();
    expect(html).toContain('aria-label="Avatar"');
    expect(html).toContain("🌸");
    expect(html).toContain('aria-pressed="true"');
  });

  test("edits the name and the bio, and nothing else the MVP does not publish", () => {
    const html = form();
    expect(html).toContain('placeholder="Display name"');
    expect(html).toContain('placeholder="A little about you"');
    expect(html).toContain("Ana Petrova");
    expect(html).toContain("Building things");
  });

  test("says it is saving and holds both actions while it does", () => {
    const html = form({ saving: true });
    expect(html).toContain("Saving…");
    expect(html.match(/disabled/g)).toHaveLength(2);
  });

  test("shows what went wrong beside the actions, so a refusal is not silent", () => {
    expect(form({ error: "The Workspace refused this request" })).toContain("The Workspace refused this request");
  });
});
