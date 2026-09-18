import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SIGN_OUT_PHRASE } from "../../lib/signOut";
import { SignOutDialog } from "./SignOutDialog";

const html = () => renderToStaticMarkup(<SignOutDialog onCancel={() => {}} onConfirm={() => {}} />);

/** Sign out (#148): the two steps that arm the destructive button, and the raw private key the
 * prototype showed in step 1 deliberately absent (docs/UI/REFERENCE.md › Decisões). What the
 * handlers decide — an outside click, Escape, the gate itself — is asserted in lib/signOut. */
describe("SignOutDialog", () => {
  test("the dialog says what it wipes, and cannot be undone", () => {
    expect(html()).toContain("Sign out and wipe all data?");
    expect(html()).toContain("This cannot be undone.");
    expect(html()).toContain('data-testid="sign-out-dialog"');
  });

  test("step 1 is an unticked checkbox for the key backup", () => {
    expect(html()).toContain("1. Confirm you can restore your identity");
    expect(html()).toContain('role="checkbox" aria-checked="false"');
  });

  test("step 2 asks for the phrase, with the field starting empty", () => {
    expect(html()).toContain(`2. Type “${SIGN_OUT_PHRASE}” to confirm`);
    expect(html()).toContain(`id="sign-out-phrase"`);
    expect(html()).toContain(`placeholder="${SIGN_OUT_PHRASE}"`);
  });

  test("the destructive button starts disabled, the hint saying which step is missing", () => {
    expect(html()).toContain('class="sign-out-hint">Confirm your key backup first.');
    expect(html()).toContain('class="btn btn-destructive" disabled="">Delete my data');
  });

  test("the dialog never puts the private key itself on screen", () => {
    expect(html()).not.toContain("nsec");
  });
});
