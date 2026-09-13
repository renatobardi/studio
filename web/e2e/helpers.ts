/**
 * These flows run against a real deployed studio-test stack (real Firebase
 * project, real relay). Credentials come from env, seeded by
 * scripts/ops/seed-e2e-test-account.sh — see that script for what it creates.
 *
 * Flows 2 & 3 (ticket #5) additionally need STUDIO_TEST_WORKSPACE_SLUG and
 * STUDIO_TEST_OWNER_PRIVATE_KEY_HEX — a Workspace owner/admin identity's
 * raw secp256k1 private key, hex-encoded — to grant the run's fresh
 * Identity Channel membership (see ensureChannelMembership below). Neither
 * is something a seed script can precompute: onboarding/restore mint a new
 * pubkey every run.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} — see scripts/ops/seed-e2e-test-account.sh`);
  return value;
}

export const testAccount = {
  email: () => requiredEnv("STUDIO_TEST_EMAIL"),
  password: () => requiredEnv("STUDIO_TEST_PASSWORD"),
};

export const testInviteCode = () => requiredEnv("STUDIO_TEST_INVITE_CODE");
export const testBackupPassphrase = () => requiredEnv("STUDIO_TEST_BACKUP_PASSPHRASE");
export const testWorkspaceSlug = () => requiredEnv("STUDIO_TEST_WORKSPACE_SLUG");

/** A second, independently-seeded test Account — Direct Messages (ticket #7) need two distinct
 * Identities in the same Workspace, unlike flows 2/3/5 which only ever drive one. Requires the
 * env vars below in addition to the ones flow 2/3/5 already need. */
export const testAccountTwo = {
  email: () => requiredEnv("STUDIO_TEST_EMAIL_2"),
  password: () => requiredEnv("STUDIO_TEST_PASSWORD_2"),
};
export const testBackupPassphraseTwo = () => requiredEnv("STUDIO_TEST_BACKUP_PASSPHRASE_2");

/** A Workspace owner/admin identity used only to grant the just-onboarded test Identity Channel
 * membership (see `ensureChannelMembership`) — never used to sign in through the UI. Redeeming
 * an Invite only grants Workspace membership (`repository.py`'s `redeem_invite`); flows 2 & 3
 * need to actually publish into a Channel, which requires an explicit Channel Member row. */
function ownerPrivateKeyHex(): string {
  return requiredEnv("STUDIO_TEST_OWNER_PRIVATE_KEY_HEX");
}

async function ownerAuthProof(url: string, method: string): Promise<string> {
  const { finalizeEvent } = await import("nostr-tools");
  const secretKey = Uint8Array.from(Buffer.from(ownerPrivateKeyHex(), "hex"));
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["u", url], ["method", method]],
      content: "",
    },
    secretKey,
  );
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

export interface OwnerChannel {
  id: string;
  name: string;
  private: boolean;
  role: string | null;
}

/**
 * The second client in flow 7 (#42): a Workspace admin acting through the
 * REST control plane while the browser under test only watches. It is the
 * other admin whose changes must reach the running app through projections,
 * with no reload — see channel-access.spec.ts.
 */
export const ownerApi = {
  async createChannel(apiBase: string, name: string, isPrivate: boolean): Promise<OwnerChannel> {
    return ownerRequest(`${apiBase}/api/workspaces/${testWorkspaceSlug()}/channels`, "POST", {
      name,
      about: "",
      private: isPrivate,
    });
  },
  async addChannelMember(apiBase: string, channelId: string, pubkey: string, role: string): Promise<void> {
    const slug = testWorkspaceSlug();
    await ownerRequest(`${apiBase}/api/workspaces/${slug}/channels/${channelId}/members`, "POST", { pubkey, role });
  },
  async removeChannelMember(apiBase: string, channelId: string, pubkey: string): Promise<void> {
    const slug = testWorkspaceSlug();
    await ownerRequest(`${apiBase}/api/workspaces/${slug}/channels/${channelId}/members/${pubkey}`, "DELETE");
  },
};

async function ownerRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: await ownerAuthProof(url, method),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Adds `pubkey` as a member of the Workspace's first Channel, using the fixed owner/admin
 * identity above. Idempotent — adding an existing member is a no-op server-side
 * (`ControlPlaneRepository.add_channel_member`). */
export async function ensureChannelMembership(pageURL: string, pubkey: string): Promise<void> {
  const apiBase = new URL(pageURL).origin;
  const slug = testWorkspaceSlug();
  const listUrl = `${apiBase}/api/workspaces/${slug}/channels`;
  const listResponse = await fetch(listUrl, { headers: { Authorization: await ownerAuthProof(listUrl, "GET") } });
  if (!listResponse.ok) throw new Error(`list channels failed: ${listResponse.status}`);
  const channels = (await listResponse.json()) as { id: string }[];
  const channel = channels[0];
  if (!channel) throw new Error(`Workspace ${slug} has no Channel for flows 2/3 to use`);

  const addUrl = `${apiBase}/api/workspaces/${slug}/channels/${channel.id}/members`;
  const addResponse = await fetch(addUrl, {
    method: "POST",
    headers: { Authorization: await ownerAuthProof(addUrl, "POST"), "content-type": "application/json" },
    body: JSON.stringify({ pubkey }),
  });
  if (!addResponse.ok) {
    throw new Error(`add channel member failed: ${addResponse.status} ${await addResponse.text()}`);
  }
}

interface RestoreCredentials {
  email: string;
  password: string;
  backupPassphrase: string;
}

/** Sign in and restore the Identity from Key Backup for arbitrary credentials — the shared
 * implementation behind `reachAppViaRestore` (the default test account) and Flow 4's second
 * party (`testAccountTwo`). Requires a Key Backup to already exist for the account. Also grants
 * Channel membership (see `ensureChannelMembership`) so a flow can publish into a Channel too,
 * even though Direct Messages themselves only need Workspace membership. */
export async function reachAppViaRestoreWithCredentials(
  page: import("@playwright/test").Page,
  credentials: RestoreCredentials,
): Promise<string> {
  await page.goto("/");

  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // No invite is entered: an Account that already has an Identity opens
  // straight on the restore step, and reconnects through the Workspaces that
  // Identity is already a Member of (#36).
  const passphraseField = page.getByPlaceholder("Backup passphrase");
  // An Account whose email was never verified is held on the verify step (#96),
  // and the restore field simply never appears — say so instead of timing out
  // on a locator 30s later.
  const verifyGate = page.getByRole("button", { name: "I verified — continue" });
  await passphraseField.or(verifyGate).first().waitFor({ timeout: 15_000 });
  if (await verifyGate.isVisible()) {
    throw new Error(
      `${credentials.email} is held on the verify step — its email is not verified in Firebase. ` +
        `Verify it (scripts/ops/verify-e2e-account-two.sh for the second Account) and re-run.`,
    );
  }
  await passphraseField.fill(credentials.backupPassphrase);
  await page.getByRole("button", { name: "Restore" }).click();

  await page.getByRole("button", { name: /^Connect/ }).first().click();
  await page.getByRole("heading", { name: /You're in/ }).waitFor({ timeout: 15_000 });

  const pubkey = await page.getByTestId("own-pubkey").textContent();
  if (!pubkey) throw new Error("own-pubkey test hook not found — cannot grant Channel membership");
  await ensureChannelMembership(page.url(), pubkey);

  await page.getByRole("button", { name: "Finish" }).click();
  return pubkey;
}

/** Sign in and restore the Identity from Key Backup (same steps as flow 5,
 * restore.spec.ts) — the deterministic way for a flow to reach the app
 * shell without depending on run order or re-running onboarding's Key
 * Backup creation. Requires a Key Backup to already exist for this account
 * (onboarding.spec.ts creates one). Also grants Channel membership (see
 * `ensureChannelMembership`) since flows 2 & 3 need to publish into one. */
export async function reachAppViaRestore(page: import("@playwright/test").Page): Promise<string> {
  return reachAppViaRestoreWithCredentials(page, {
    email: testAccount.email(),
    password: testAccount.password(),
    backupPassphrase: testBackupPassphrase(),
  });
}
