import { finalizeEvent, getPublicKey, nip44, nip98 } from "nostr-tools";
import { useState } from "react";
import type { User } from "firebase/auth";
import * as api from "../../lib/api";
import type { WorkspaceOut } from "../../lib/api";
import { decryptBackup, encryptBackup, validateBackupPassphrase } from "../../lib/backup";
import {
  generateIdentity,
  nsecFromSecretKey,
  profileEventTemplate,
  relayListTemplate,
  secretKeyFromNsec,
  serverListTemplate,
} from "../../lib/identity";
import {
  getSigner,
  hasNip07,
  storeIdentity,
  storeWorkspaceSlug,
  type Signer,
} from "../../lib/custody";
import {
  isSkippable,
  nextStep,
  previousStep,
  stepsFor,
  type Custody,
  type OnboardingStep,
} from "../../lib/onboardingSteps";
import { connectAndAuthenticate, publishEvent } from "../../lib/relay";

type Step = OnboardingStep | "restore";

const EMOJIS = ["🌸", "🦊", "🐙", "🌊", "🔥", "🌙", "🍄", "🐝"];

export function OnboardingScreen({
  user,
  accountPassword,
  onComplete,
}: {
  user: User;
  accountPassword: string | null;
  onComplete: (workspace: WorkspaceOut) => void;
}) {
  // A NIP-07 extension holds the key itself, so the app neither generates an
  // Identity nor takes custody of one — and the Key Backup steps fall away
  // (#45). Fixed for the run: an extension appearing mid-flow would change
  // who is being onboarded.
  const [custody] = useState<Custody>(() => (hasNip07() ? "extension" : "local"));
  const steps = stepsFor(custody);

  const [step, setStep] = useState<Step>("invite");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [inviteCode, setInviteCode] = useState("");
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);

  // Only ever set under local custody; an extension's key never reaches here.
  const [identity, setIdentity] = useState<ReturnType<typeof generateIdentity> | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [nsecRevealed, setNsecRevealed] = useState(false);

  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [backupBlob, setBackupBlob] = useState<Uint8Array | null>(null);
  const [backupState, setBackupState] = useState<"idle" | "created" | "verified">("idle");
  const [verifyPassphrase, setVerifyPassphrase] = useState("");

  const [workspace, setWorkspace] = useState<WorkspaceOut | null>(null);

  const [mode, setMode] = useState<"new" | "restore">("new");
  const [restorePassphrase, setRestorePassphrase] = useState("");

  const goBack = () => {
    if (step === "restore") {
      setStep("invite");
      return;
    }
    const previous = previousStep(step, custody);
    if (previous) setStep(previous);
  };

  const advance = (from: OnboardingStep) => {
    const next = nextStep(from, custody);
    if (next) setStep(next);
  };

  const idToken = () => user.getIdToken();

  const runStep = async (fn: () => Promise<void>, errorMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError(errorMessage);
    } finally {
      setBusy(false);
    }
  };

  const handleInviteNext = () =>
    runStep(async () => {
      const preview = await api.previewInvite(inviteCode.trim());
      if (!preview.valid) {
        setError("This invite isn't valid anymore.");
        return;
      }
      setWorkspaceName(preview.workspace_name);
      setStep("profile");
    }, "Couldn't find that invite. Check the code and try again.");

  const handleGoRestore = () => {
    setMode("restore");
    setError(null);
    setStep("restore");
  };

  const handleRestore = () =>
    runStep(async () => {
      const token = await idToken();
      const { blob_base64 } = await api.getKeyBackup(token);
      const blob = Uint8Array.from(atob(blob_base64), (c) => c.charCodeAt(0));
      const nsec = await decryptBackup(blob, restorePassphrase);
      const secretKey = secretKeyFromNsec(nsec);
      setIdentity({ secretKey, publicKey: getPublicKey(secretKey) });
      setPubkey(getPublicKey(secretKey));
      setStep("setup");
    }, "Wrong passphrase, or no Key Backup on file for this account.");

  const handleProfileNext = () => {
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    // The Identity is established here, on the last step nobody can skip —
    // never on leaving the avatar, which they may skip past.
    return runStep(async () => {
      if (custody === "extension") {
        // Ask the extension who it is. Generating an Identity here would
        // leave this person with two: one onboarded, one that signs (#45).
        const signer = await getSigner();
        if (!signer) throw new Error("the NIP-07 extension did not answer");
        setPubkey(await signer.getPublicKey());
      } else if (!identity) {
        const fresh = generateIdentity();
        setIdentity(fresh);
        setPubkey(fresh.publicKey);
      }
      advance("profile");
    }, "Couldn't read your Identity from your Nostr extension. Try again.");
  };

  const handleAvatarNext = () => advance("avatar");

  const handleBackupNext = () => advance("backup");

  const handleCreateBackup = () => {
    if (!identity) return;
    const invalid = validateBackupPassphrase(passphrase, accountPassword ?? "");
    if (invalid) {
      setError(invalid);
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setError("Passphrases don't match.");
      return;
    }
    return runStep(async () => {
      const blob = await encryptBackup(nsecFromSecretKey(identity.secretKey), passphrase);
      setBackupBlob(blob);
      setBackupState("created");
      advance("backup-options");
    }, "Couldn't create the Key Backup. Try again.");
  };

  const handleVerifyBackup = () => {
    if (!backupBlob || !identity) return;
    return runStep(async () => {
      const decrypted = await decryptBackup(backupBlob, verifyPassphrase);
      if (decrypted !== nsecFromSecretKey(identity.secretKey)) {
        setError("That didn't decrypt to your key. Check the passphrase.");
        return;
      }
      setBackupState("verified");
      const blobBase64 = btoa(String.fromCharCode(...backupBlob));
      await api.putKeyBackup(await idToken(), blobBase64);
      advance("download");
    }, "Wrong passphrase — the backup didn't decrypt.");
  };

  const handleDownload = () => {
    if (!backupBlob) return;
    const blob = new Blob([backupBlob as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "studio-key-backup.age";
    a.click();
    URL.revokeObjectURL(url);
  };

  const localSigner = (secretKey: Uint8Array, publicKey: string): Signer => ({
    async getPublicKey() {
      return publicKey;
    },
    async signEvent(template) {
      return finalizeEvent(template, secretKey);
    },
    async nip44Encrypt(other, plaintext) {
      return nip44.encrypt(plaintext, nip44.getConversationKey(secretKey, other));
    },
    async nip44Decrypt(other, ciphertext) {
      return nip44.decrypt(ciphertext, nip44.getConversationKey(secretKey, other));
    },
  });

  const handleSetup = () => {
    if (custody === "local" && !identity) return;
    return runStep(async () => {
      // Under an extension this is the extension's own signer: the key never
      // leaves it, and no parallel Identity is ever created (#45).
      const signer =
        identity !== null
          ? localSigner(identity.secretKey, identity.publicKey)
          : await getSigner();
      if (!signer) throw new Error("no signer available");
      const proof = await nip98.getToken(
        `${window.location.origin}/api/invites/${inviteCode.trim()}/redeem`,
        "POST",
        (e) => signer.signEvent(e),
        true,
      );
      const redeemed = await api.redeemInvite(inviteCode.trim(), proof);
      setWorkspace(redeemed);

      const ws = await connectAndAuthenticate(redeemed.relay_url, signer);
      if (mode === "new") {
        await publishEvent(ws, await signer.signEvent(profileEventTemplate({ name, picture: emoji })));
        await publishEvent(ws, await signer.signEvent(relayListTemplate([redeemed.relay_url])));
        await publishEvent(ws, await signer.signEvent(serverListTemplate([redeemed.media_url])));
      }
      ws.close();

      advance("setup");
    }, "Couldn't connect to the workspace. Try again.");
  };

  const handleFinish = async () => {
    if (!workspace) return;
    if (identity) {
      await storeIdentity(nsecFromSecretKey(identity.secretKey));
    }
    await storeWorkspaceSlug(workspace.slug);
    onComplete(workspace);
  };

  return (
    <div className="onboarding-shell">
      <div className="onboarding-header">
        <div style={{ fontSize: 30 }}>🌸</div>
        <div className="onboarding-progress">
          {steps.map((s) => (
            <span key={s} className={`dot${s === step ? " active" : ""}`} />
          ))}
        </div>
        <div className="account-chip">
          <span className="avatar">{(user.email ?? "?")[0]?.toUpperCase()}</span>
          <span>{user.email}</span>
        </div>
      </div>

      <div className="onboarding-content">
        {error && <div className="error-banner">{error}</div>}

        {step === "invite" && (
          <>
            <h1 className="onboarding-title">Enter your invite</h1>
            <div className="onboarding-actions">
              <input
                className="field-label"
                placeholder="Invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
              <button className="btn btn-primary btn-block" disabled={busy || !inviteCode} onClick={handleInviteNext}>
                Continue
              </button>
              {workspaceName && <span className="meta">Joining {workspaceName}</span>}
              {custody === "local" && (
                <button type="button" className="link" disabled={!inviteCode} onClick={handleGoRestore}>
                  Restore an existing Identity from Key Backup
                </button>
              )}
            </div>
          </>
        )}

        {step === "restore" && (
          <>
            <h1 className="onboarding-title">Restore your Identity</h1>
            <p className="meta">Enter the passphrase for the Key Backup stored on this account.</p>
            <div className="onboarding-actions">
              <input
                type="password"
                placeholder="Backup passphrase"
                value={restorePassphrase}
                onChange={(e) => setRestorePassphrase(e.target.value)}
              />
              <button className="btn btn-primary btn-block" disabled={busy} onClick={handleRestore}>
                Restore
              </button>
            </div>
          </>
        )}

        {step === "profile" && (
          <>
            <h1 className="onboarding-title">What should we call you?</h1>
            <div className="onboarding-actions">
              <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn btn-primary btn-block" disabled={busy} onClick={handleProfileNext}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === "avatar" && (
          <>
            <h1 className="onboarding-title">Pick an avatar</h1>
            <div style={{ display: "flex", gap: 8 }}>
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  className="btn"
                  style={{ fontSize: 20, background: e === emoji ? "var(--accent)" : "transparent" }}
                  onClick={() => setEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-primary btn-block" onClick={handleAvatarNext}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === "backup" && identity && (
          <>
            <h1 className="onboarding-title">This is your key</h1>
            <p className="meta">
              Your Identity is this private key. Anyone who has it can act as you — keep it secret.
            </p>
            <div className={`nsec-reveal${nsecRevealed ? " revealed" : ""}`}>
              {nsecFromSecretKey(identity.secretKey)}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-outline" onClick={() => setNsecRevealed((v) => !v)}>
                {nsecRevealed ? "Hide" : "Reveal"}
              </button>
              <button
                className="btn btn-outline"
                onClick={() => navigator.clipboard.writeText(nsecFromSecretKey(identity.secretKey))}
              >
                Copy
              </button>
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-primary btn-block" onClick={handleBackupNext}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === "backup-options" && (
          <>
            <h1 className="onboarding-title">Create a Key Backup</h1>
            <p className="meta">
              Choose a passphrase for your Key Backup. It must be different from your account password.
            </p>
            <div className="onboarding-actions">
              <input
                type="password"
                placeholder="Backup passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
              <input
                type="password"
                placeholder="Confirm passphrase"
                value={passphraseConfirm}
                onChange={(e) => setPassphraseConfirm(e.target.value)}
              />
              <button className="btn btn-primary btn-block" disabled={busy} onClick={handleCreateBackup}>
                Create backup
              </button>
            </div>
          </>
        )}

        {step === "download" && (
          <>
            <h1 className="onboarding-title">Verify your backup</h1>
            <p className="meta">
              Enter your passphrase once more to confirm the backup decrypts correctly.
            </p>
            <div className="onboarding-actions">
              <input
                type="password"
                placeholder="Backup passphrase"
                value={verifyPassphrase}
                onChange={(e) => setVerifyPassphrase(e.target.value)}
              />
              <button className="btn btn-primary btn-block" disabled={busy} onClick={handleVerifyBackup}>
                Verify
              </button>
              <button className="btn btn-outline btn-block" onClick={handleDownload}>
                Download backup file (optional)
              </button>
              {backupState === "verified" && <span className="meta">✓ Verified</span>}
            </div>
          </>
        )}

        {step === "setup" && (
          <>
            <h1 className="onboarding-title">Connecting you to your workspace</h1>
            <div className="onboarding-actions">
              <button className="btn btn-primary btn-block" disabled={busy} onClick={handleSetup}>
                {busy ? "Connecting…" : "Connect"}
              </button>
            </div>
          </>
        )}

        {step === "config" && workspace && (
          <>
            <h1 className="onboarding-title">You're in {workspace.name}</h1>
            {/* Test-only hook (not sensitive — a Nostr pubkey is a public identifier): lets
                Playwright grant this run's freshly-restored Identity Channel membership before
                it needs to publish anything (flows 2 & 3, e2e/helpers.ts's
                ensureChannelMembership). */}
            {pubkey && <span data-testid="own-pubkey" hidden>{pubkey}</span>}
            <div className="onboarding-actions">
              <button className="btn btn-primary btn-block" onClick={handleFinish}>
                Finish
              </button>
            </div>
          </>
        )}

        {step !== "invite" && (
          <button type="button" className="link" onClick={goBack}>
            Back
          </button>
        )}
        {step !== "restore" && isSkippable(step, custody) && (
          <button type="button" className="link" onClick={() => advance(step)}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
