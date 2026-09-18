import { describe, expect, test } from "bun:test";
import type { User } from "firebase/auth";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileSettingsCards } from "./ProfileSettings";
import type { Profile } from "./useProfiles";

const PUBKEY = "6bbf5828".padEnd(64, "a");
const user = { providerData: [{ providerId: "password" }], getIdToken: async () => "id-token" } as unknown as User;

const render = (profile: Profile | undefined, withUser = true) =>
  renderToStaticMarkup(
    <ProfileSettingsCards
      profile={profile}
      pubkey={PUBKEY}
      user={withUser ? user : null}
      accountPassword={null}
      onSignOut={() => {}}
    />,
  );

/** Settings › Profile reads back what the app knows (#150): the published profile, the Identity,
 * and the Key Backup — never a hex key, and never a claim the Account has not answered yet. */
describe("ProfileSettings", () => {
  test("reads back the published name and bio", () => {
    const html = render({ name: "Ana Petrova", about: "Building things" });
    expect(html).toContain("Ana Petrova");
    expect(html).toContain("Building things");
    expect(html).not.toContain("Not set yet");
  });

  test("says so, rather than leaving a blank, when nothing has been published", () => {
    const html = render(undefined);
    expect(html).toContain("Not set yet");
  });

  test("shows the Identity as an abbreviated npub, never as hex", () => {
    const html = render(undefined);
    expect(html).toContain("npub1");
    expect(html).not.toContain(PUBKEY.slice(0, 16));
  });

  test("claims nothing about the Key Backup until the Account has answered", () => {
    const html = render(undefined);
    expect(html).toContain("Checking…");
    expect(html).not.toContain("Manage");
  });

  test("offers the way out of this device, with the warning above it", () => {
    const html = render(undefined);
    expect(html).toContain("Delete my data");
    expect(html).toContain("this cannot be undone");
    expect(html).not.toContain('data-testid="sign-out-dialog"');
  });

  test("leaves Send feedback to the Settings shell, which closes every section with it (#151)", () => {
    expect(render(undefined)).not.toContain("Send feedback");
  });

  test("renders without a Firebase session, which the preview harness has none of", () => {
    expect(render({ name: "Ana Petrova" }, false)).toContain("Ana Petrova");
  });
});
