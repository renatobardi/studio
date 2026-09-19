import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { applyAppearance, loadAppearance } from "./lib/appearance";
import * as api from "./lib/api";
import type { WorkspaceOut } from "./lib/api";
import { auth } from "./lib/firebase";
import { pruneMediaCaches } from "./lib/mediaCache";
import {
  clearIdentity,
  getSigner,
  loadWorkspaceSlug,
  storeWorkspaceSlug,
  type Signer,
} from "./lib/custody";
import { localIdentityMatches } from "./lib/accountIdentity";
import { isEmailVerified } from "./lib/emailVerification";
import { inviteCodeFromUrl, rememberInviteCode } from "./lib/invites";
import { resolveInitialView, useAppView } from "./lib/routing";
import { AuthScreen } from "./routes/auth/AuthScreen";
import { OnboardingScreen } from "./routes/onboarding/OnboardingScreen";
import { AppShell } from "./routes/app/AppShell";

/**
 * Runs the Account/Identity/Workspace lookup for a signed-in Firebase user.
 * Shared by the boot-time onAuthStateChanged listener and by AuthScreen's
 * onAuthenticated — the latter needs its own call because verifying an email
 * mutates the pending user in place without firing a new auth state change
 * (#103).
 */
async function resolveBoot(firebaseUser: User | null) {
  // A freshly created email/password account is already "signed in" as far
  // as Firebase is concerned, but the auth/verify step must gate it until
  // the link is clicked — Google sign-in is verified by construction.
  const verified = isEmailVerified(firebaseUser);

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
  // A NIP-07 extension can refuse on resume exactly as it can at
  // onboarding, and a rejected getPublicKey() here would leave the app on a
  // blank boot forever. With no Identity to resume, onboarding is where the
  // refusal is named and can be retried (#75).
  let ownPubkey: string | null = null;
  if (signer) {
    try {
      const own = await signer.getPublicKey();
      if (localIdentityMatches(own, accountOut?.pubkey ?? null)) ownPubkey = own;
      else signer = null;
    } catch {
      signer = null;
    }
  }

  // Whoever holds this browser now keeps their own cached media and nobody
  // else's — including the leftovers of an Identity that never signed out
  // cleanly (#39). Best effort: booting the app is not the moment to fail
  // on it, and sign-out is where a failed cleanup gets reported.
  await pruneMediaCaches(ownPubkey).catch(() => {});

  let resumedWorkspace: WorkspaceOut | null = null;
  if (signer) {
    resumedWorkspace = await resumeWorkspace(signer, firebaseUser);
  }

  return {
    account: accountOut,
    signer,
    workspace: resumedWorkspace,
    routingAccount: verified && firebaseUser ? { uid: firebaseUser.uid, email: firebaseUser.email } : null,
  };
}

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
  const { view, setView, accountPassword, setAccountPassword } = useAppView();
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceOut | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [account, setAccount] = useState<api.AccountOut | null>(null);
  const [signOutWarning, setSignOutWarning] = useState<string | null>(null);
  // Guards against a slower, superseded resolveBoot() call (e.g. a quick
  // sign-out/sign-in) landing after a fresher one already set the view (#103).
  const bootGen = useRef(0);

  const applyResolved = (myGen: number, resolved: Awaited<ReturnType<typeof resolveBoot>>) => {
    if (myGen !== bootGen.current) return;
    setAccount(resolved.account);
    setWorkspace(resolved.workspace);
    setSigner(resolved.signer);
    setView(
      resolveInitialView({
        account: resolved.routingAccount,
        hasIdentity: resolved.signer !== null,
        hasWorkspace: resolved.workspace !== null,
      }),
    );
  };

  useEffect(() => {
    loadAppearance().then(applyAppearance);
  }, []);

  // An invite link has to survive sign-in, email verification and onboarding
  // before anything can be done with it, so the code is taken off the URL the
  // moment the app boots and held until it is redeemed (#46).
  useEffect(() => {
    const code = inviteCodeFromUrl(window.location.search);
    if (!code) return;
    rememberInviteCode(code);
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState(null, "", url.toString());
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      // An unverified user can only ever land back on "auth" — skip the
      // "loading" gate so a fresh signup's verify step (still on AuthScreen,
      // holding the typed password) isn't unmounted while this resolves.
      if (isEmailVerified(firebaseUser)) setView("loading");
      const myGen = ++bootGen.current;
      try {
        applyResolved(myGen, await resolveBoot(firebaseUser));
      } catch {
        if (myGen === bootGen.current) setView("auth");
      }
    });
    // Subscribes once: setView is stable (useAppView), and applyResolved only reaches state
    // setters and the bootGen ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view === "loading") return null;

  if (view === "auth") {
    return (
      <AuthScreen
        notice={signOutWarning}
        pendingUnverifiedUser={user && !isEmailVerified(user) ? user : null}
        onAuthenticated={(authedUser, password) => {
          setUser(authedUser);
          setAccountPassword(password);
          setView("loading");
          // Verifying an email reloads the pending user in place and doesn't
          // fire a new onAuthStateChanged event, so this path resolves the
          // boot itself instead of waiting for that listener (#103).
          const myGen = ++bootGen.current;
          resolveBoot(authedUser)
            .then((resolved) => applyResolved(myGen, resolved))
            .catch(() => {
              if (myGen === bootGen.current) setView("auth");
            });
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
          user={user}
          onSignOut={async () => {
            // What could not be wiped is said out loud on the screen this
            // returns to, rather than passed off as a clean sign-out (#39).
            setSignOutWarning(null);
            try {
              await clearIdentity();
            } catch (error) {
              setSignOutWarning(error instanceof Error ? error.message : "Some of this session stayed on this browser.");
            }
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
