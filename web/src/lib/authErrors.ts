const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password don't match an account.",
  "auth/wrong-password": "That email and password don't match an account.",
  "auth/user-not-found": "No account uses that email yet. Create one instead.",
  "auth/email-already-in-use": "An account already uses that email. Sign in instead.",
  "auth/invalid-email": "That email address isn't valid.",
  "auth/weak-password": "Use 8 characters or more.",
  "auth/user-disabled": "That account is disabled. Ask whoever runs this server.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/popup-closed-by-user": "The Google window closed before sign-in finished.",
  "auth/popup-blocked":
    "Your browser blocked the Google window. Allow popups for Studio and try again.",
  "auth/account-exists-with-different-credential":
    "That email already signs in another way. Use the password form instead.",
  "auth/network-request-failed":
    "Studio couldn't reach Firebase. Check your connection and try again.",
};

export function mapFirebaseErrorCode(code: string): string {
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}
