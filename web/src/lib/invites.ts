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
