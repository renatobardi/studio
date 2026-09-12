export type AppView = "auth" | "onboarding" | "app";

export interface AuthAccount {
  uid: string;
  email: string | null;
}

export interface RoutingState {
  account: AuthAccount | null;
  hasIdentity: boolean;
  /** Whether a Workspace was resolved for that Identity. The app shell has
   * nothing to show without one. */
  hasWorkspace: boolean;
}

/**
 * No Account -> auth; an Account still missing an Identity or a Workspace ->
 * onboarding; all three -> app.
 *
 * The key is stored the moment it is linked or restored, so "has an Identity
 * but reached no Workspace" is a state an interruption can leave behind
 * (#36). Onboarding is what can finish that; the app shell can only report a
 * dead end.
 */
export function resolveInitialView({ account, hasIdentity, hasWorkspace }: RoutingState): AppView {
  if (!account) return "auth";
  if (!hasIdentity || !hasWorkspace) return "onboarding";
  return "app";
}
