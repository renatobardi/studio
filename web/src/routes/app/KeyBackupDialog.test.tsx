import { describe, expect, test } from "bun:test";
import type { User } from "firebase/auth";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyBackupDialog } from "./KeyBackupDialog";

const user = (providerId: string) =>
  ({ providerData: [{ providerId }], getIdToken: async () => "id-token" }) as unknown as User;

const render = (providerId: string, accountPassword: string | null) =>
  renderToStaticMarkup(
    <KeyBackupDialog
      user={user(providerId)}
      accountPassword={accountPassword}
      pubkey={"6bbf5828".padEnd(64, "a")}
      onClose={() => {}}
      onStored={() => {}}
    />,
  );

/** "Manage" reopens the onboarding Key Backup steps from Settings › Profile (#150) — same cards,
 * same rules, and the Account password asked for again when this session no longer has it (#36). */
describe("KeyBackupDialog", () => {
  test("opens on the passphrase card when the Account password is still at hand", () => {
    const html = render("password", "hunter22");
    expect(html).toContain('data-testid="key-backup-dialog"');
    expect(html).toContain("Back up your key with a password");
    expect(html).toContain("Create backup");
    expect(html).not.toContain("Confirm your account password");
  });

  test("asks for the Account password first when this session no longer holds it", () => {
    const html = render("password", null);
    expect(html).toContain("Confirm your account password");
    expect(html).not.toContain("Create backup");
  });

  test("a Google account has no password to differ from, so it goes straight to the passphrase", () => {
    expect(render("google.com", null)).toContain("Create backup");
  });

  test("is a labelled modal dialog, closeable and cancellable", () => {
    const html = render("google.com", null);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="key-backup-title"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("Cancel");
  });

  test("offers the optional download only once there is a file to download", () => {
    expect(render("google.com", null)).not.toContain("Download backup file");
  });
});
