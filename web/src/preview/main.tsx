/**
 * preview.html — the MVP screens over fixed data, with no relay, API or Firebase behind them.
 *
 * `?screen=` picks a screen (see SCREENS), `theme=dark`, `density=compact|comfy|spacious` and
 * `fontScale=smaller|default|larger` set the appearance before the shell mounts. Vite only
 * builds index.html, so this page exists on the dev server alone; the visual flow drives it
 * (e2e/visual.spec.ts) and so does anyone comparing a screen against docs/UI/reference.
 * `new-message` is here without a flow 10 baseline: the prototype's reference was never
 * captured for it (docs/UI/REFERENCE.md › Decisões 11).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/app.css";
import { applyAppearance, parseAppearance, storeAppearance } from "../lib/appearance";
import { storeChannelId, storeChannelReadAt, storeDmReadAt } from "../lib/custody";
import type { User } from "firebase/auth";
import { AuthScreen } from "../routes/auth/AuthScreen";
import { AppShell } from "../routes/app/AppShell";
import { OnboardingScreen } from "../routes/onboarding/OnboardingScreen";
import type { RelayClient } from "../lib/relay";
import { FakeRelayClient, previewSigner } from "./fakeRelay";
import { Steps, type Step } from "./Steps";
import { ALL_EVENTS, CHANNEL_READ_AT, CHANNELS, DM_READ, MEMBERS, OWN, WORKSPACE } from "./fixtures";

const NEXT: Step = { click: "text=Continue" };
const PASSPHRASE_FIELD = 'input[placeholder="Backup passphrase"]';
const PASSPHRASE = "preview passphrase 12";

/** Onboarding is walked, not jumped to: each step's clicks are the previous step's plus its own. */
const ONBOARDING_TO = (() => {
  const profile: Step[] = [
    { type: ['.onboarding-form-full .field input', "PREVIEW"] },
    { click: '.onboarding-check:nth-child(1) input' },
    { click: '.onboarding-check:nth-child(2) input' },
    { click: "text=Accept and redeem invite" },
  ];
  const avatar: Step[] = [...profile, { type: ['input[placeholder="Your name"]', "Renato Bardi"] }, NEXT];
  const backup: Step[] = [...avatar, NEXT];
  const backupOptions: Step[] = [...backup, NEXT];
  const download: Step[] = [
    ...backupOptions,
    { type: [PASSPHRASE_FIELD, PASSPHRASE] },
    { type: ['input[placeholder="Confirm passphrase"]', PASSPHRASE] },
    { click: "text=Create backup" },
    { waitFor: "text=Verify" },
  ];
  return { profile, avatar, backup, backupOptions, download };
})();

/** Each screen: what mounts, then the clicks that reach it — the same clicks a person makes. */
const SCREENS: Record<string, { mount: "auth" | "onboarding" | "app"; steps: Step[] }> = {
  "auth-signin": { mount: "auth", steps: [] },
  "auth-signup": { mount: "auth", steps: [{ click: "text=Don’t have an account? Create one" }] },
  "auth-reset": { mount: "auth", steps: [{ click: "text=Forgot password?" }] },
  "auth-signin-error": { mount: "auth", steps: [{ type: ['input[type="email"]', "not-an-email"] }, { click: "text=Sign in" }] },
  "onboarding-invite": { mount: "onboarding", steps: [] },
  "onboarding-profile": { mount: "onboarding", steps: ONBOARDING_TO.profile },
  "onboarding-avatar": { mount: "onboarding", steps: ONBOARDING_TO.avatar },
  "onboarding-backup": { mount: "onboarding", steps: ONBOARDING_TO.backup },
  "onboarding-backup-revealed": { mount: "onboarding", steps: [...ONBOARDING_TO.backup, { click: '[aria-label="Reveal private key"]' }] },
  "onboarding-backup-options": { mount: "onboarding", steps: ONBOARDING_TO.backupOptions },
  "onboarding-download": { mount: "onboarding", steps: ONBOARDING_TO.download },
  "onboarding-setup": {
    mount: "onboarding",
    steps: [...ONBOARDING_TO.download, { type: [PASSPHRASE_FIELD, PASSPHRASE] }, { click: "text=Verify" }, { waitFor: "text=Connect" }],
  },
  channel: { mount: "app", steps: [] },
  "channel-thread": { mount: "app", steps: [{ click: ".thread-open" }] },
  "channel-members": { mount: "app", steps: [{ click: '[aria-label="Members"]' }] },
  dm: { mount: "app", steps: [{ click: '[data-testid="conversation-list-item"]' }] },
  "new-message": { mount: "app", steps: [{ click: '[data-testid="dm-new-conversation"]' }] },
  admin: { mount: "app", steps: [{ click: '[data-testid="mode-admin"]' }] },
  settings: { mount: "app", steps: [{ click: '[data-testid="mode-settings"]' }] },
  "settings-profile": { mount: "app", steps: [{ click: '[data-testid="mode-settings"]' }, { click: "text=Profile" }] },
  profile: { mount: "app", steps: [{ click: '[data-testid="account-menu-button"]' }, { click: "text=Profile" }] },
};

const params = new URLSearchParams(window.location.search);
const screen = SCREENS[params.get("screen") ?? "channel"] ?? SCREENS.channel!;
const appearance = parseAppearance({
  theme: params.get("theme") ?? "light",
  density: params.get("density") ?? "compact",
  fontScale: params.get("fontScale") ?? "default",
});

const PREVIEW_ACCOUNT = { uid: "preview", email: "renato@studio.app", pubkey: null };

/** Enough of a Firebase User for onboarding to render; nothing here ever reaches Firebase. */
const PREVIEW_USER = {
  uid: PREVIEW_ACCOUNT.uid,
  email: PREVIEW_ACCOUNT.email,
  emailVerified: true,
  providerData: [{ providerId: "password" }],
  getIdToken: () => Promise.resolve("preview"),
  reload: () => Promise.resolve(),
} as unknown as User;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// The shell's own REST calls, answered from the fixtures.
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const path = new URL(requestUrl(input), window.location.origin).pathname;
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
  if (path === `/api/workspaces/${WORKSPACE.slug}/channels`) return json(CHANNELS);
  if (path === `/api/workspaces/${WORKSPACE.slug}/members`) return json(MEMBERS);
  if (path === "/api/account" && (init?.method ?? "GET") === "GET") return json(PREVIEW_ACCOUNT);
  if (path === "/api/account/key-backup" && (init?.method ?? "GET") === "GET") {
    return Promise.resolve(new Response("{}", { status: 404 }));
  }
  if (path === "/api/account/key-backup") return json({ status: "stored" });
  if (path === "/api/account/link-identity") return json({ ...PREVIEW_ACCOUNT, pubkey: OWN.pubkey });
  if (path.startsWith("/api/invites/")) return json({ workspace_name: WORKSPACE.name, valid: true, reason: null });
  if (path.startsWith("/api/")) return Promise.resolve(new Response("preview: not fixtured", { status: 404 }));
  return realFetch(input, init);
};

function mountedScreen(client: RelayClient) {
  if (screen.mount === "auth") return <AuthScreen onAuthenticated={() => {}} />;
  if (screen.mount === "onboarding") {
    return (
      <OnboardingScreen user={PREVIEW_USER} account={null} accountPassword="preview-account-password" onComplete={() => {}} />
    );
  }
  return (
    <AppShell
      workspace={WORKSPACE}
      signer={previewSigner(OWN)}
      user={PREVIEW_USER}
      client={client}
      onSignOut={() => {}}
    />
  );
}

async function main() {
  await storeAppearance(appearance);
  applyAppearance(appearance);
  await storeChannelId(CHANNELS[0]!.id);
  await storeChannelReadAt(CHANNEL_READ_AT);
  await storeDmReadAt(DM_READ);
  const client = new FakeRelayClient(ALL_EVENTS).asClient();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {mountedScreen(client)}
      <Steps steps={screen.steps} />
    </StrictMode>,
  );
}

await main();
