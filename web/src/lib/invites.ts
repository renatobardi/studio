import type { InviteOut } from "./api";

/**
 * Invites as the interface deals with them (#46): the link an admin hands
 * somebody, the limits they set on it, and plain words for the states the API
 * reports. Kept free of React and of `fetch` so each of those is a fact a test
 * can pin down.
 */

/** The code an invite link carries, or null when this URL is not one. */
export function inviteCodeFromUrl(search: string): string | null {
  const code = new URLSearchParams(search).get("invite")?.trim();
  return code || null;
}

/** The code in what somebody pasted: the whole invite link, or just its code.
 * A link without an invite is null — a code cannot start with a scheme
 * (`token_urlsafe` never makes a `:`), so it was never meant as one. */
export function inviteCodeFromInput(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  if (!/^https?:\/\//i.test(input)) return input;
  try {
    return inviteCodeFromUrl(new URL(input).search);
  } catch {
    return null;
  }
}

/** Why the invite may not be redeemed yet, or null once both are confirmed.
 * Age first, then the terms — the order and words of the prototype. */
export function invitePolicyError(accepted: { age: boolean; terms: boolean }): string | null {
  if (!accepted.age) return "Confirm that you are at least 18 years old.";
  if (!accepted.terms) return "Agree to the Terms of Service and Privacy Policy.";
  return null;
}

/** The link an admin copies. Reaching the app this way is the whole point:
 * the code survives sign-in and onboarding without anybody re-typing it. */
export function inviteLink(origin: string, code: string): string {
  const url = new URL(origin);
  url.searchParams.set("invite", code);
  return url.toString();
}

export interface InviteLimitFields {
  /** Days from now, as typed. Empty means no expiry. */
  expiresInDays: string;
  /** Empty means unlimited. */
  maxUses: string;
}

export interface InviteLimits {
  expires_at: number | null;
  max_uses: number | null;
}

export type InviteLimitsResult =
  | { ok: true; body: InviteLimits }
  | { ok: false; error: string };

function parseCount(raw: string): number | null | "not-a-number" {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : "not-a-number";
}

/**
 * The limits to send, or the reason not to send anything. The server refuses
 * limits that could never admit anybody too — this is only so that a typo
 * answers immediately instead of as a failed request.
 */
export function inviteLimits(fields: InviteLimitFields, nowSeconds: number): InviteLimitsResult {
  const days = parseCount(fields.expiresInDays);
  if (days === "not-a-number") return { ok: false, error: "Expiry must be a whole number of days." };
  if (days !== null && days < 1) return { ok: false, error: "Expiry must be at least one day." };

  const uses = parseCount(fields.maxUses);
  if (uses === "not-a-number") return { ok: false, error: "The use limit must be a whole number." };
  if (uses !== null && uses < 1) return { ok: false, error: "An invite must allow at least one use." };

  return {
    ok: true,
    body: { expires_at: days === null ? null : nowSeconds + days * 86400, max_uses: uses },
  };
}

/** One line per invite in the admin list: whether it still admits anybody,
 * how much of it is spent, and when it stops. The state comes from the server
 * — deciding it here would be a second copy of a rule that can drift. */
export function describeInvite(invite: InviteOut): string {
  const uses =
    invite.max_uses === null
      ? `${invite.use_count} uses`
      : `${invite.use_count}/${invite.max_uses} uses`;
  const expiry =
    invite.expires_at === null
      ? "never expires"
      : `expires ${new Date(invite.expires_at * 1000).toLocaleDateString()}`;
  return `${invite.state} · ${uses} · ${expiry}`;
}

const PREVIEW_MESSAGES: Record<string, string> = {
  not_found: "No invite with that code. Check it and try again.",
  revoked: "This invite was revoked. Ask for a new one.",
  expired: "This invite has expired. Ask for a new one.",
  exhausted: "This invite has already been used up. Ask for a new one.",
};

/**
 * Why the invite was turned down, in words. "This invite isn't valid" reads
 * as a typo and sends people back to a code they already typed correctly —
 * only "revoked" or "expired" tells them to go ask for another (#46).
 */
export function invitePreviewMessage(reason: string | null): string {
  // Null (or a reason this build has never heard of) still has to say
  // something: an empty error banner is a dead end, not a message.
  return PREVIEW_MESSAGES[reason ?? ""] ?? "This invite can't be used. Ask for a new one.";
}

const PENDING_INVITE_KEY = "studio.invite.pending";

/**
 * The invite code an opened link carried, held across sign-in and onboarding.
 * It is not a secret — it travelled in a URL to get here — so it lives in
 * `localStorage`, which survives the reload that email verification causes;
 * `sessionStorage` would not.
 *
 * Every access is guarded: private browsing and blocked site data throw on
 * the accessor itself, and an invite nobody can remember must not take the
 * app down with it.
 */
export function rememberInviteCode(code: string): void {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, code);
  } catch {
    // Nothing to remember it with; onboarding falls back to asking.
  }
}

export function pendingInviteCode(): string | null {
  try {
    return localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

export function forgetInviteCode(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Already unreachable; there is nothing left to clear.
  }
}

/**
 * What the invite step holds besides the code being typed: the two
 * confirmations the prototype asks for before anything is redeemed, the
 * refusal standing under them, and whether the ways in that need no invite
 * are showing (#152).
 */
export interface InviteStepState {
  age: boolean;
  terms: boolean;
  /** Sits under the boxes, where they are — never in the error banner. */
  policyError: string | null;
  noInvite: boolean;
}

export const INITIAL_INVITE_STEP: InviteStepState = {
  age: false,
  terms: false,
  policyError: null,
  noInvite: false,
};

/** Ticking or unticking a box answers the refusal, so the refusal goes: it
 * was about that box, and leaving it up accuses somebody of what they just
 * did. */
export function withAgeAccepted(state: InviteStepState, age: boolean): InviteStepState {
  return { ...state, age, policyError: null };
}

export function withTermsAccepted(state: InviteStepState, terms: boolean): InviteStepState {
  return { ...state, terms, policyError: null };
}

/** "I don't have an invite" opens the ways in that need none, and closes them
 * again. What was already agreed to stays agreed to. */
export function withNoInviteToggled(state: InviteStepState): InviteStepState {
  return { ...state, noInvite: !state.noInvite };
}

export interface InviteStepAttempt {
  state: InviteStepState;
  /** The code to preview, or null when the step refuses to go on. */
  code: string | null;
  /** For the error banner, or null when nothing belongs there. */
  error: string | null;
}

/**
 * What pressing "Accept and redeem invite" decides. Consent is asked for
 * before the server is: previewing first would tell somebody who may not use
 * the invite that their invite is good.
 */
export function submitInviteStep(state: InviteStepState, typed: string): InviteStepAttempt {
  const policyError = invitePolicyError({ age: state.age, terms: state.terms });
  if (policyError) return { state: { ...state, policyError }, code: null, error: null };
  const code = inviteCodeFromInput(typed);
  return {
    state: { ...state, policyError: null },
    code,
    error: code ? null : "Paste the invite link you were sent, or just its code.",
  };
}

/** Under the field: the Workspace the code was found to admit to, or what the
 * link looks like until one is known. */
export function inviteFieldHint(workspaceName: string | null): string {
  return workspaceName ? `Joining ${workspaceName}` : "The link should start with https://";
}

/** Only what the boxes report, so the handlers below stay free of React. */
export interface CheckboxEvent {
  target: { checked: boolean };
}

export interface InviteStepDeps {
  state: InviteStepState;
  /** The invite link or code, as typed. */
  typed: string;
  setState: (state: InviteStepState) => void;
  setError: (message: string) => void;
  /** Ask the server about a code that got past the step's own checks. */
  redeem: (code: string) => void;
}

export interface InviteStepHandlers {
  onAge: (event: CheckboxEvent) => void;
  onTerms: (event: CheckboxEvent) => void;
  onNoInvite: () => void;
  onSubmit: () => void;
}

/**
 * What each control on the invite step does. The screen wires these to the
 * boxes and the button and renders the state; deciding is all here, where a
 * test can press them without a browser (#152).
 */
export function inviteStepHandlers(deps: InviteStepDeps): InviteStepHandlers {
  return {
    onAge: (event) => deps.setState(withAgeAccepted(deps.state, event.target.checked)),
    onTerms: (event) => deps.setState(withTermsAccepted(deps.state, event.target.checked)),
    onNoInvite: () => deps.setState(withNoInviteToggled(deps.state)),
    onSubmit: () => {
      const attempt = submitInviteStep(deps.state, deps.typed);
      deps.setState(attempt.state);
      if (attempt.error) deps.setError(attempt.error);
      if (attempt.code) deps.redeem(attempt.code);
    },
  };
}
