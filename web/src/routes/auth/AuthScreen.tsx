import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  type User,
} from "firebase/auth";
import { useState } from "react";
import { auth } from "../../lib/firebase";
import { mapFirebaseErrorCode } from "../../lib/authErrors";
import { isEmailVerified } from "../../lib/emailVerification";

type AuthStep = "signin" | "signup" | "verify" | "reset" | "sent";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthScreen({
  pendingUnverifiedUser,
  onAuthenticated,
}: {
  // Set when Firebase already has a signed-in-but-unverified user (e.g. a
  // page reload mid-verification) — starts straight at the verify step.
  pendingUnverifiedUser?: User | null;
  onAuthenticated: (user: User, password: string | null) => void;
}) {
  const [step, setStep] = useState<AuthStep>(pendingUnverifiedUser ? "verify" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [pendingUser, setPendingUser] = useState<User | null>(pendingUnverifiedUser ?? null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  const goTo = (next: AuthStep) => {
    setStep(next);
    setError(null);
    if (next === "signin") setPassword("");
  };

  const setFirebaseError = (err: unknown) => {
    const code = (err as { code?: string })?.code ?? null;
    setError({ message: code ? mapFirebaseErrorCode(code) : "Something went wrong. Try again.", code });
  };

  const handleSignIn = async () => {
    if (!EMAIL_RE.test(email)) {
      setError({ message: "Enter a valid email address.", code: null });
      return;
    }
    setBusy(true);
    try {
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      // The gate is the same one `App` applies on every auth state change:
      // an unverified password Account signing in lands on the verify step
      // instead of walking into onboarding.
      if (!isEmailVerified(user)) {
        await sendEmailVerification(user);
        setPendingUser(user);
        setResent(false);
        setStep("verify");
        return;
      }
      onAuthenticated(user, password);
    } catch (err) {
      setFirebaseError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async () => {
    if (!EMAIL_RE.test(email)) {
      setError({ message: "Enter a valid email address.", code: null });
      return;
    }
    if (password.length < 8) {
      setError({ message: "Use 8 characters or more.", code: null });
      return;
    }
    setBusy(true);
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(user);
      setPendingUser(user);
      setStep("verify");
      setResent(false);
    } catch (err) {
      setFirebaseError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyContinue = async () => {
    if (!pendingUser) return;
    setBusy(true);
    try {
      await pendingUser.reload();
      if (isEmailVerified(pendingUser)) {
        onAuthenticated(pendingUser, password);
      } else {
        setError({ message: "Not verified yet — check your inbox and try again.", code: null });
      }
    } catch (err) {
      setFirebaseError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (!pendingUser) return;
    setBusy(true);
    setError(null);
    try {
      await sendEmailVerification(pendingUser);
      setResent(true);
    } catch (err) {
      setFirebaseError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!EMAIL_RE.test(email)) {
      setError({ message: "Enter a valid email address.", code: null });
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setStep("sent");
    } catch (err) {
      setFirebaseError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    try {
      const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
      onAuthenticated(user, null);
    } catch (err) {
      setFirebaseError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centered-screen">
      <div className="card stack" style={{ width: 352 }}>
        <div className="stack" style={{ gap: 4 }}>
          <div style={{ fontSize: 24 }}>🌸</div>
          <h1 style={{ fontSize: 18, margin: 0 }}>Studio</h1>
        </div>

        {error && (
          <div className="error-banner">
            {error.message}
            {error.code && <code>{error.code}</code>}
          </div>
        )}

        {step === "signin" && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              handleSignIn();
            }}
          >
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="button" className="link" onClick={() => goTo("reset")}>
              Forgot password?
            </button>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              Sign in
            </button>
            <div className="divider-or">or</div>
            <button type="button" className="btn btn-outline btn-block" onClick={handleGoogle} disabled={busy}>
              Continue with Google
            </button>
            <button type="button" className="link" onClick={() => goTo("signup")}>
              Don't have an account? Create one
            </button>
          </form>
        )}

        {step === "signup" && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              handleSignUp();
            }}
          >
            <label className="field">
              <span className="field-label">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="meta">Use 8 characters or more. Firebase never stores it in plain text.</span>
            </label>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              Create account
            </button>
            <div className="divider-or">or</div>
            <button type="button" className="btn btn-outline btn-block" onClick={handleGoogle} disabled={busy}>
              Continue with Google
            </button>
            <button type="button" className="link" onClick={() => goTo("signin")}>
              Already have an account? Sign in
            </button>
          </form>
        )}

        {step === "verify" && (
          <div className="stack">
            <p>Verification link sent to {pendingUser?.email}.</p>
            <span className="meta">{resent ? "Resent just now" : "Verification link sent just now"}</span>
            <button className="btn btn-primary btn-block" onClick={handleVerifyContinue} disabled={busy}>
              I verified — continue
            </button>
            <button type="button" className="link" onClick={handleResend} disabled={busy}>
              Resend the link
            </button>
            <button type="button" className="link" onClick={() => goTo("signup")}>
              Use a different email
            </button>
          </div>
        )}

        {step === "reset" && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              handleReset();
            }}
          >
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              Send reset link
            </button>
            <button type="button" className="link" onClick={() => goTo("signin")}>
              Back to sign in
            </button>
          </form>
        )}

        {step === "sent" && (
          <div className="stack">
            <p>✓ Reset link sent just now.</p>
            <button className="btn btn-primary btn-block" onClick={() => goTo("signin")}>
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
