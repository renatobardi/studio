import { useState } from "react";

export type AppView = "loading" | "auth" | "onboarding" | "app";

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
 *
 * Callers show "loading" themselves while an Account/Identity/Workspace
 * lookup is in flight — this function only ever sees the settled result
 * (#103).
 */
export function resolveInitialView({ account, hasIdentity, hasWorkspace }: RoutingState): AppView {
  if (!account) return "auth";
  if (!hasIdentity || !hasWorkspace) return "onboarding";
  return "app";
}

/**
 * What is left of the typed Account password once the app moves to `view` (#189). Onboarding needs
 * it to keep the Key Backup passphrase different from it (#36); past that — in the signed-in app,
 * or back at sign-in after Sign out — nothing does, so nothing holds it. Settings asks for it again
 * through AccountPasswordGate.
 */
export function accountPasswordKeptFor(view: AppView, password: string | null): string | null {
  return view === "loading" || view === "onboarding" ? password : null;
}

/** The App's view, and the typed Account password alongside it: every `setView` re-judges the
 * password with `accountPasswordKeptFor`, so Sign out, or reaching the signed-in app, lets go of
 * it (#189). */
export function useAppView() {
  const [view, setViewState] = useState<AppView>("loading");
  const [accountPassword, setAccountPassword] = useState<string | null>(null);
  const setView = (next: AppView) => {
    setViewState(next);
    setAccountPassword((held) => accountPasswordKeptFor(next, held));
  };
  return { view, setView, accountPassword, setAccountPassword };
}
