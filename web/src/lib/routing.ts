export type AppView = "auth" | "onboarding" | "app";

export interface AuthAccount {
  uid: string;
  email: string | null;
}

export interface RoutingState {
  account: AuthAccount | null;
  hasIdentity: boolean;
}

/** No Account -> auth; Account without Identity -> onboarding; both -> app. */
export function resolveInitialView({ account, hasIdentity }: RoutingState): AppView {
  if (!account) return "auth";
  if (!hasIdentity) return "onboarding";
  return "app";
}
