const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password don't match an account.",
  "auth/user-not-found": "No account uses that email yet. Create one instead.",
  "auth/email-already-in-use": "An account already uses that email. Sign in instead.",
  "auth/network-request-failed":
    "Studio couldn't reach Firebase. Check your connection and try again.",
};

export function mapFirebaseErrorCode(code: string): string {
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}
