import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { nip98 } from "nostr-tools";
import { useEffect, useState } from "react";
import * as api from "./lib/api";
import type { WorkspaceOut } from "./lib/api";
import { auth } from "./lib/firebase";
import { clearIdentity, getSigner, loadWorkspaceSlug } from "./lib/custody";
import { resolveInitialView, type AppView } from "./lib/routing";
import { AuthScreen } from "./routes/auth/AuthScreen";
import { OnboardingScreen } from "./routes/onboarding/OnboardingScreen";
import { AppShell } from "./routes/app/AppShell";

export function App() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<AppView>("auth");
  const [user, setUser] = useState<User | null>(null);
  const [accountPassword, setAccountPassword] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceOut | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      const signer = firebaseUser ? await getSigner() : null;

      let resumedWorkspace: WorkspaceOut | null = null;
      if (signer) {
        const slug = await loadWorkspaceSlug();
        if (slug) {
          try {
            const url = `${window.location.origin}/api/workspaces/${slug}`;
            const proof = await nip98.getToken(url, "GET", (e) => signer.signEvent(e), true);
            resumedWorkspace = await api.getWorkspace(slug, proof);
          } catch {
            resumedWorkspace = null;
          }
        }
      }

      setWorkspace(resumedWorkspace);
      setView(
        resolveInitialView({
          account: firebaseUser ? { uid: firebaseUser.uid, email: firebaseUser.email } : null,
          hasIdentity: signer !== null,
        }),
      );
      setLoading(false);
    });
  }, []);

  if (loading) return null;

  if (view === "auth") {
    return (
      <AuthScreen
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
        accountPassword={accountPassword}
        onComplete={(ws) => {
          setWorkspace(ws);
          setView("app");
        }}
      />
    );
  }

  if (view === "app") {
    if (workspace) {
      return (
        <AppShell
          workspace={workspace}
          onSignOut={async () => {
            await clearIdentity();
            await signOut(auth);
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
