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
import { authCopy, type AuthStep } from "../../lib/authCopy";
import { mapFirebaseErrorCode } from "../../lib/authErrors";
import { isEmailVerified } from "../../lib/emailVerification";
import { Sakura } from "../../components/brand/Sakura";
import { Icon } from "../../components/icons/Icon";

// Every repetition excludes the separator that follows it, so there is nothing
// for the engine to backtrack over on a near-miss.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function AuthScreen({
  notice,
  pendingUnverifiedUser,
  onAuthenticated,
}: Readonly<{
  // What the previous session left behind on this browser, when signing out
  // could not wipe all of it (#39) — shown here because this is the screen
  // sign-out returns to.
  notice?: string | null;
  // Set when Firebase already has a signed-in-but-unverified user (e.g. a
  // page reload mid-verification) — starts straight at the verify step.
  pendingUnverifiedUser?: User | null;
  onAuthenticated: (user: User, password: string | null) => void;
}>) {
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
        // No resend here: signup already sent the link, and the verify step
        // offers "Resend" on demand — resending on every attempt is what runs
        // the Account into auth/too-many-requests.
        setPendingUser(user);
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

  const copy = authCopy(step);
  const showForm = step === "signin" || step === "signup" || step === "reset";
  const showGoogle = step === "signin" || step === "signup";
  const submit = () => {
    if (step === "signin") return handleSignIn();
    if (step === "signup") return handleSignUp();
    if (step === "reset") return handleReset();
    if (step === "verify") return handleVerifyContinue();
    goTo("signin");
  };

  return (
    <div className="auth-screen" data-screen-label="Sign in">
      <div className="auth-column">
        <Sakura size={32} sw={7} />
        <h1 className="auth-title">{copy.title}</h1>
        <p className="auth-body">{copy.body}</p>

        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {notice && (
            <div className="error-banner" data-testid="sign-out-notice">
              {notice}
            </div>
          )}

          {showForm && (
            <div className="auth-fields">
              {step === "signup" && (
                <label className="auth-field">
                  <span className="auth-field-label">Name</span>
                  <input className="input" value={name} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
                </label>
              )}
              <label className="auth-field">
                <span className="auth-field-label">Email</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  placeholder="you@example.com"
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                />
              </label>
              {step !== "reset" && (
                // div, not label: a label wrapping "Forgot password?" makes the button
                // a second getByLabel("Password") match (#111); the input is already
                // named via aria-labelledby, so it doesn't need the implicit label.
                <div className="auth-field">
                  <span className="auth-field-label auth-field-head">
                    <span id="auth-password-label">Password</span>
                    {step === "signin" && (
                      <button type="button" className="auth-forgot" onClick={() => goTo("reset")}>
                        Forgot password?
                      </button>
                    )}
                  </span>
                  <input
                    className="input"
                    type="password"
                    aria-labelledby="auth-password-label"
                    placeholder={step === "signup" ? "At least 8 characters" : "Your password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(null);
                    }}
                  />
                  {step === "signup" && (
                    <span className="auth-field-hint">Use 8 characters or more. Firebase never stores it in plain text.</span>
                  )}
                </div>
              )}
            </div>
          )}

          {step === "verify" && (
            <div className="auth-fields">
              <div className="auth-panel">
                <span className="auth-panel-icon">
                  <Icon name="mail" size={14} />
                </span>
                <span className="auth-panel-text">
                  <span className="auth-panel-title">{pendingUser?.email}</span>
                  <span className="auth-panel-meta">{resent ? "Link sent again" : "Verification link sent just now"}</span>
                </span>
              </div>
              <button type="button" className="link link-inline auth-resend" onClick={handleResend} disabled={busy}>
                {resent ? "Link sent again" : "Resend the link"}
              </button>
            </div>
          )}

          {step === "sent" && (
            <div className="auth-panel auth-panel-plain">
              <span className="auth-check">
                <Icon name="check" size={15} />
              </span>
              <span className="auth-panel-text">
                <span className="auth-panel-title">{email}</span>
                <span className="auth-panel-meta">Reset link sent just now</span>
              </span>
            </div>
          )}

          {error && (
            <div className="error-banner">
              {error.message}
              {error.code && <code>{error.code}</code>}
            </div>
          )}

          <div className="auth-actions">
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {copy.ctaLabel}
            </button>
            {showGoogle && (
              <div className="auth-actions">
                <div className="divider-or">or</div>
                <button type="button" className="btn btn-outline btn-block" onClick={handleGoogle} disabled={busy}>
                  Continue with Google
                </button>
              </div>
            )}
          </div>
        </form>

        <div className="auth-footer">
          {copy.switchLabel && (
            <button type="button" className="link" onClick={() => goTo(copy.switchStep)}>
              {copy.switchLabel}
            </button>
          )}
          <p className="auth-footnote">{copy.footnote}</p>
        </div>
      </div>
    </div>
  );
}
