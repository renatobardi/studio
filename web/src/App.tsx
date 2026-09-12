import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { applyAppearance, loadAppearance } from "./lib/appearance";
import * as api from "./lib/api";
import type { WorkspaceOut } from "./lib/api";
import { auth } from "./lib/firebase";
import {
  clearIdentity,
  getSigner,
  loadWorkspaceSlug,
  storeWorkspaceSlug,
  type Signer,
} from "./lib/custody";
import { localIdentityMatches } from "./lib/accountIdentity";
import { resolveInitialView, type AppView } from "./lib/routing";
import { AuthScreen } from "./routes/auth/AuthScreen";
import { OnboardingScreen } from "./routes/onboarding/OnboardingScreen";
import { AppShell } from "./routes/app/AppShell";

/**
 * Where to reconnect on resume: the Workspace this browser last used, or —
 * when there is no local trace of one (a restore on a new browser, a fresh
 * sign-in) — the first the Account's Identity belongs to (#36).
 */
async function resumeWorkspace(signer: Signer, user: User | null): Promise<WorkspaceOut | null> {
  const slug = await loadWorkspaceSlug();
  if (slug) {
    try {
      const url = `${window.location.origin}/api/workspaces/${slug}`;
      return await api.getWorkspace(slug, await api.authProof(url, "GET", signer));
    } catch {
      // Falls through: the remembered slug may be stale (membership removed).
    }
  }
  if (!user) return null;
  try {
    const workspaces = await api.listWorkspaces(await user.getIdToken());
    const first = workspaces[0];
    if (first) await storeWorkspaceSlug(first.slug);
    return first ?? null;
  } catch {
    return null;
  }
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<AppView>("auth");
  const [user, setUser] = useState<User | null>(null);
  const [accountPassword, setAccountPassword] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceOut | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [account, setAccount] = useState<api.AccountOut | null>(null);

  useEffect(() => {
    loadAppearance().then(applyAppearance);
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      // A freshly created email/password account is already "signed in" as
      // far as Firebase is concerned, but the auth/verify step must gate it
      // until the link is clicked — Google sign-in is verified by construction.
      const verified =
        !!firebaseUser &&
        (firebaseUser.emailVerified || firebaseUser.providerData.some((p) => p.providerId !== "password"));

      // The Account is the source of truth for which Identity this person
      // has: a local key that isn't the linked one must not be signed with,
      // and onboarding must restore rather than generate over it (#36).
      let accountOut: api.AccountOut | null = null;
      if (verified && firebaseUser) {
        try {
          accountOut = await api.getAccount(await firebaseUser.getIdToken());
        } catch {
          accountOut = null;
        }
      }

      let signer = verified ? await getSigner() : null;
      if (signer && !localIdentityMatches(await signer.getPublicKey(), accountOut?.pubkey ?? null)) {
        signer = null;
      }

      let resumedWorkspace: WorkspaceOut | null = null;
      if (signer) {
        resumedWorkspace = await resumeWorkspace(signer, firebaseUser);
      }

      setAccount(accountOut);
      setWorkspace(resumedWorkspace);
      setSigner(signer);
      setView(
        resolveInitialView({
          account: verified && firebaseUser ? { uid: firebaseUser.uid, email: firebaseUser.email } : null,
          hasIdentity: signer !== null,
          hasWorkspace: resumedWorkspace !== null,
        }),
      );
      setLoading(false);
    });
  }, []);

  if (loading) return null;

  if (view === "auth") {
    return (
      <AuthScreen
        pendingUnverifiedUser={user && !user.emailVerified ? user : null}
        onAuthenticated={(authedUser, password) => {
          setUser(authedUser);
          setAccountPassword(password);
          setView("onboarding");
        }}
      />
    );
  }

  if (view === "onboarding" && user) {
    return (
      <OnboardingScreen
        user={user}
        account={account}
        accountPassword={accountPassword}
        onComplete={async (ws) => {
          setWorkspace(ws);
          setSigner(await getSigner());
          setView("app");
        }}
        onAccountChanged={setAccount}
      />
    );
  }

  if (view === "app") {
    if (workspace && signer) {
      return (
        <AppShell
          workspace={workspace}
          signer={signer}
          onSignOut={async () => {
            await clearIdentity();
            await signOut(auth);
            setAccount(null);
            setWorkspace(null);
            setView("auth");
          }}
        />
      );
    }
    return (
      <div className="centered-screen">
        <div className="card stack">
          <p>Couldn't reach your Workspace. Check your connection and try again.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return null;
}
