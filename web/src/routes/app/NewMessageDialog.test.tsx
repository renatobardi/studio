import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Profile } from "../../lib/profileStore";
import { NewMessageDialog } from "./NewMessageDialog";

const ANA = "a".repeat(64);
const SPRIG = "5".repeat(64);
const profiles = new Map<string, Profile>([
  [ANA, { name: "Ana Petrova" } as Profile],
  [SPRIG, { name: "Sprig" } as Profile],
]);

const render = (error: string | null = null) =>
  renderToStaticMarkup(
    <NewMessageDialog
      members={[
        { pubkey: ANA, role: "member" },
        { pubkey: SPRIG, role: "agent" },
      ]}
      profiles={profiles}
      error={error}
      onPick={() => {}}
      onCancel={() => {}}
    />,
  );

/** The prototype's "new-message" dialog (#142): the Workspace member list is the whole picker,
 * so there is no "To" field and no "Start conversation" button (docs/UI/REFERENCE.md › Decisões). */
describe("NewMessageDialog", () => {
  test("is a labelled modal titled after the prototype's own dialog", () => {
    const html = render();
    expect(html).toContain('data-testid="new-message-dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="new-message-title"');
    expect(html).toContain("New message");
  });

  test("offers every Member given, with their role, and nothing to type a key into", () => {
    const html = render();
    expect(html).toContain("Ana Petrova");
    expect(html).toContain("Sprig");
    expect(html).toContain('data-testid="dm-member-option"');
    expect(html).not.toContain("<input");
  });

  test("shows why the Member list is missing, when it is", () => {
    expect(render("Could not load the Member list.")).toContain("Could not load the Member list.");
    expect(render()).not.toContain("error-banner");
  });
});
