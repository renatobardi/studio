export type AuthStep = "signin" | "signup" | "verify" | "reset" | "sent";

export interface AuthCopy {
  title: string;
  body: string;
  ctaLabel: string;
  /** The quiet link under the card, or null when the step offers none (`sent`). */
  switchLabel: string | null;
  switchStep: AuthStep;
  footnote: string;
}

/** The prototype's `authCopy` table, verbatim (docs/UI/design/Studio.dc.html). */
const COPY: Record<AuthStep, AuthCopy> = {
  signin: {
    title: "Sign in to Studio",
    body: "Use your email and password, or continue with Google.",
    ctaLabel: "Sign in",
    switchLabel: "Don’t have an account? Create one",
    switchStep: "signup",
    footnote: "Studio signs you in with Firebase Authentication, then creates your Nostr identity key.",
  },
  signup: {
    title: "Create your Studio account",
    body: "This is the account you sign in with. Your identity key comes next.",
    ctaLabel: "Create account",
    switchLabel: "Already have an account? Sign in",
    switchStep: "signin",
    footnote: "By continuing you agree to the Terms of Service and Privacy Policy.",
  },
  verify: {
    title: "Verify your email",
    body: "We sent a verification link. Open it, then come back to continue.",
    ctaLabel: "I verified — continue",
    switchLabel: "Use a different email",
    switchStep: "signup",
    footnote: "Verification keeps your account recoverable if you lose your identity key.",
  },
  reset: {
    title: "Reset your password",
    body: "Enter the email on your account and we’ll send a reset link.",
    ctaLabel: "Send reset link",
    switchLabel: "Back to sign in",
    switchStep: "signin",
    footnote: "The link expires in one hour.",
  },
  sent: {
    title: "Check your inbox",
    body: "Follow the link to pick a new password, then sign in again.",
    ctaLabel: "Back to sign in",
    switchLabel: null,
    switchStep: "signin",
    footnote: "Nothing arrived? Check spam, or try another email.",
  },
};

export function authCopy(step: AuthStep): AuthCopy {
  return COPY[step];
}
