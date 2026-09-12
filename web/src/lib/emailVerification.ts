/** The shape of a Firebase user this rule needs — kept structural so the rule
 * is testable without a Firebase app. */
export interface VerifiableUser {
  emailVerified: boolean;
  providerData: readonly { providerId: string }[];
}

/**
 * Whether this Account has cleared the email gate.
 *
 * A password Account is only verified once the link is clicked. A federated
 * one (Google) is verified by construction — the provider proved the address
 * and Studio never sends it a link, so gating on `emailVerified` would strand
 * it on the verify step forever.
 *
 * The single place this rule lives: `App` decides the initial view with it and
 * `AuthScreen` decides where a sign-in lands, and the two disagreeing is what
 * used to let an unverified sign-in walk straight into onboarding.
 */
export function isEmailVerified(user: VerifiableUser | null | undefined): boolean {
  if (!user) return false;
  return user.emailVerified || user.providerData.some((p) => p.providerId !== "password");
}
