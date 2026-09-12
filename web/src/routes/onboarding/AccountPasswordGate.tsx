import { EmailAuthProvider, reauthenticateWithCredential, type User } from "firebase/auth";
import { useState } from "react";

/**
 * Asks for the Account password again and checks it against Firebase.
 *
 * The password is never persisted, so after a reload the Key Backup step has
 * nothing to compare a passphrase against — and "different from your account
 * password" would quietly become a rule that passes anything (#36). Verified
 * rather than merely typed: an unchecked answer enforces nothing.
 *
 * The confirmed password is handed back for this session only; this component
 * keeps no copy.
 */
export function AccountPasswordGate({
  user,
  onConfirmed,
}: {
  user: User;
  onConfirmed: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const credential = EmailAuthProvider.credential(user.email ?? "", password);
      await reauthenticateWithCredential(user, credential);
      setPassword("");
      onConfirmed(password);
    } catch {
      setError("That isn't your account password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      <h1 className="onboarding-title">Confirm your account password</h1>
      <p className="meta">
        Your password is never stored, so we need it again to check that your Key Backup passphrase
        is a different one.
      </p>
      <div className="onboarding-actions">
        <input
          type="password"
          placeholder="Account password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn btn-primary btn-block" disabled={busy || !password} onClick={confirm}>
          Confirm
        </button>
      </div>
    </>
  );
}
