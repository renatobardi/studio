import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BackupPassphraseCard, BackupVerifyCard } from "./KeyBackupSteps";

/** The two cards onboarding walks and "Manage" reopens (#31, #36, #150) — the same markup either
 * way, so a backup made later is made exactly as the first one was. */
describe("BackupPassphraseCard", () => {
  test("asks for the passphrase twice before it will create anything", () => {
    const html = renderToStaticMarkup(
      <BackupPassphraseCard
        passphrase="correct horse"
        confirm=""
        onPassphrase={() => {}}
        onConfirm={() => {}}
        busy={false}
        onCreate={() => {}}
      />,
    );
    expect(html).toContain('placeholder="Backup passphrase"');
    expect(html).toContain('placeholder="Confirm passphrase"');
    expect(html).toContain("Create backup");
    expect(html).not.toContain("disabled");
  });

  test("its action is out of reach while a backup is being made", () => {
    const html = renderToStaticMarkup(
      <BackupPassphraseCard
        passphrase=""
        confirm=""
        onPassphrase={() => {}}
        onConfirm={() => {}}
        busy
        onCreate={() => {}}
      />,
    );
    expect(html).toContain("disabled");
  });
});

describe("BackupVerifyCard", () => {
  test("names the file and asks for the passphrase that has to unlock it", () => {
    const html = renderToStaticMarkup(
      <BackupVerifyCard verified={false} passphrase="" onPassphrase={() => {}} busy={false} onVerify={() => {}} />,
    );
    expect(html).toContain("studio-key-backup.age");
    expect(html).toContain("Verify");
    expect(html).not.toContain("✓ Verified");
  });

  test("once verified it stops asking and says the passphrase opened the file", () => {
    const html = renderToStaticMarkup(
      <BackupVerifyCard verified passphrase="" onPassphrase={() => {}} busy={false} onVerify={() => {}} />,
    );
    expect(html).toContain("✓ Verified");
    expect(html).toContain("Your passphrase unlocked the backup.");
    expect(html).not.toContain('placeholder="Backup passphrase"');
    expect(html).not.toContain("Try again");
  });

  test("verified but not in the Account, it says so and offers to try again (#200)", () => {
    const html = renderToStaticMarkup(
      <BackupVerifyCard verified unsaved passphrase="" onPassphrase={() => {}} busy={false} onVerify={() => {}} />,
    );
    expect(html).toContain("✓ Verified");
    expect(html).toContain("Not saved to your Account yet.");
    expect(html).toContain("Try again");
  });
});
