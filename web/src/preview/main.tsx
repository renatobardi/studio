/**
 * preview.html — the MVP screens over fixed data, with no relay, API or Firebase behind them.
 *
 * `?screen=` picks a screen (see SCREENS), `theme=dark`, `density=compact|comfy|spacious` and
 * `fontScale=smaller|default|larger` set the appearance before the shell mounts. Vite only
 * builds index.html, so this page exists on the dev server alone; the visual flow drives it
 * (e2e/visual.spec.ts) and so does anyone comparing a screen against docs/UI/reference.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/app.css";
import { applyAppearance, parseAppearance, storeAppearance } from "../lib/appearance";
import { storeChannelId } from "../lib/custody";
import type { User } from "firebase/auth";
import { AuthScreen } from "../routes/auth/AuthScreen";
import { AppShell } from "../routes/app/AppShell";
import { OnboardingScreen } from "../routes/onboarding/OnboardingScreen";
import { FakeRelayClient, previewSigner } from "./fakeRelay";
import { Steps, type Step } from "./Steps";
import { ALL_EVENTS, CHANNELS, MEMBERS, OWN, WORKSPACE } from "./fixtures";

/** Each screen: what mounts, then the clicks that reach it — the same clicks a person makes. */
const SCREENS: Record<string, { mount: "auth" | "onboarding" | "app"; steps: Step[] }> = {
  "auth-signin": { mount: "auth", steps: [] },
  "auth-signup": { mount: "auth", steps: [{ click: "text=Create one" }] },
  "auth-reset": { mount: "auth", steps: [{ click: "text=Forgot password?" }] },
  "auth-signin-error": { mount: "auth", steps: [{ type: ['input[type="email"]', "not-an-email"] }, { click: "text=Sign in" }] },
  "onboarding-invite": { mount: "onboarding", steps: [] },
  "onboarding-profile": { mount: "onboarding", steps: [{ type: ['input[placeholder="Invite code"]', "PREVIEW"] }, { click: "text=Continue" }] },
  "onboarding-avatar": {
    mount: "onboarding",
    steps: [
      { type: ['input[placeholder="Invite code"]', "PREVIEW"] },
      { click: "text=Continue" },
      { type: ['input[placeholder="Your name"]', "Renato Bardi"] },
      { click: "text=Continue" },
    ],
  },
  "onboarding-backup": {
    mount: "onboarding",
    steps: [
      { type: ['input[placeholder="Invite code"]', "PREVIEW"] },
      { click: "text=Continue" },
      { type: ['input[placeholder="Your name"]', "Renato Bardi"] },
      { click: "text=Continue" },
      { click: "text=Continue" },
    ],
  },
  "onboarding-backup-options": {
    mount: "onboarding",
    steps: [
      { type: ['input[placeholder="Invite code"]', "PREVIEW"] },
      { click: "text=Continue" },
      { type: ['input[placeholder="Your name"]', "Renato Bardi"] },
      { click: "text=Continue" },
      { click: "text=Continue" },
      { click: "text=Continue" },
    ],
  },
  "onboarding-download": {
    mount: "onboarding",
    steps: [
      { type: ['input[placeholder="Invite code"]', "PREVIEW"] },
      { click: "text=Continue" },
      { type: ['input[placeholder="Your name"]', "Renato Bardi"] },
      { click: "text=Continue" },
      { click: "text=Continue" },
      { click: "text=Continue" },
      { type: ['input[placeholder="Backup passphrase"]', "preview passphrase 12"] },
      { type: ['input[placeholder="Confirm passphrase"]', "preview passphrase 12"] },
      { click: "text=Create backup" },
    ],
  },
  channel: { mount: "app", steps: [] },
  "channel-thread": { mount: "app", steps: [{ click: '[data-testid="open-thread"]' }] },
  "channel-members": { mount: "app", steps: [{ click: "text=Members" }] },
  dm: { mount: "app", steps: [{ click: '[data-testid="mode-dms"]' }, { click: '[data-testid="conversation-list-item"]' }] },
  "dm-list": { mount: "app", steps: [{ click: '[data-testid="mode-dms"]' }] },
  admin: { mount: "app", steps: [{ click: '[data-testid="mode-admin"]' }] },
  settings: { mount: "app", steps: [{ click: '[data-testid="mode-settings"]' }] },
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

// The shell's own REST calls, answered from the fixtures.
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, window.location.origin).pathname;
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

async function main() {
  await storeAppearance(appearance);
  applyAppearance(appearance);
  await storeChannelId(CHANNELS[0]!.id);
  const client = new FakeRelayClient(ALL_EVENTS).asClient();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {screen.mount === "auth" ? (
        <AuthScreen onAuthenticated={() => {}} />
      ) : screen.mount === "onboarding" ? (
        <OnboardingScreen user={PREVIEW_USER} account={null} accountPassword="preview-account-password" onComplete={() => {}} />
      ) : (
        <AppShell workspace={WORKSPACE} signer={previewSigner(OWN)} client={client} onSignOut={() => {}} />
      )}
      <Steps steps={screen.steps} />
    </StrictMode>,
  );
}

void main();
