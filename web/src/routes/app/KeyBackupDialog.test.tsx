import { describe, expect, test } from "bun:test";
import type { User } from "firebase/auth";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyBackupDialog } from "./KeyBackupDialog";

const user = (providerId: string) =>
  ({ providerData: [{ providerId }], getIdToken: async () => "id-token" }) as unknown as User;

const render = (providerId: string) =>
  renderToStaticMarkup(
    <KeyBackupDialog
      user={user(providerId)}
      pubkey={"6bbf5828".padEnd(64, "a")}
      onClose={() => {}}
      onStored={() => {}}
    />,
  );

/** "Manage" reopens the onboarding Key Backup steps from Settings › Profile (#150) — same cards,
 * same rules, and the Account password asked for again — the signed-in app never holds it (#36, #189). */
describe("KeyBackupDialog", () => {
  test("asks a password Account for its password first, to keep the passphrase different", () => {
    const html = render("password");
    expect(html).toContain('data-testid="key-backup-dialog"');
    expect(html).toContain("Confirm your account password");
    expect(html).not.toContain("Create backup");
  });

  test("a Google account has no password to differ from, so it goes straight to the passphrase", () => {
    const html = render("google.com");
    expect(html).toContain("Back up your key with a password");
    expect(html).toContain("Create backup");
  });

  test("is a labelled modal dialog, closeable and cancellable", () => {
    const html = render("google.com");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="key-backup-title"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("Cancel");
  });

  test("offers the optional download only once there is a file to download", () => {
    expect(render("google.com")).not.toContain("Download backup file");
  });
});
