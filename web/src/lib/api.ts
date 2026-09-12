import { nip98 } from "nostr-tools";
import type { Signer } from "./custody";

/** A fresh NIP-98 proof for one request — these are signed per-call, never reused. */
export function authProof(url: string, method: string, signer: Signer): Promise<string> {
  return nip98.getToken(url, method, (event) => signer.signEvent(event), true);
}

export interface WorkspaceOut {
  slug: string;
  name: string;
  relay_url: string;
  media_url: string;
  role: string;
}

export interface AccountOut {
  uid: string;
  email: string;
  /** The Identity bound to this Account, or null while it has none. */
  pubkey: string | null;
}

export interface InvitePreview {
  workspace_name: string;
  valid: boolean;
  /** Why it cannot be used — "not_found", "revoked", "expired" or
   * "exhausted" — or null when it can (#46). */
  reason: string | null;
}

export interface ChannelOut {
  id: string;
  name: string;
  about: string;
  private: boolean;
  /** The caller's own role in this Channel, or null when they are not a
   * Channel Member (a public Channel is listed either way). */
  role: string | null;
}

export interface ChannelMemberOut {
  pubkey: string;
  role: string;
}

export interface WorkspaceMemberOut {
  pubkey: string;
  role: string;
}

export interface InviteOut {
  code: string;
  role: string;
  expires_at: number | null;
  max_uses: number | null;
  use_count: number;
  revoked: boolean;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Public preview of an Invite — no auth, used before any Identity exists. */
export function previewInvite(code: string): Promise<InvitePreview> {
  return request(`/invites/${encodeURIComponent(code)}`);
}

/** Redeems an Invite for the caller's Identity. `nip98Token` proves pubkey ownership (Authorization: Nostr ...). */
export function redeemInvite(code: string, nip98Token: string): Promise<WorkspaceOut> {
  return request(`/invites/${encodeURIComponent(code)}/redeem`, {
    method: "POST",
    headers: { Authorization: nip98Token },
  });
}

export function getAccount(firebaseIdToken: string): Promise<AccountOut> {
  return request("/account", { headers: { Authorization: `Bearer ${firebaseIdToken}` } });
}

/**
 * The signed NIP-98 event itself, rather than an `Authorization` value —
 * link-identity carries the proof in the body, because the header already
 * carries the Firebase token that says which Account is being linked.
 */
export async function identityProof(
  url: string,
  method: string,
  signer: Signer,
): Promise<Record<string, unknown>> {
  const token = await nip98.getToken(url, method, (event) => signer.signEvent(event), false);
  return JSON.parse(atob(token)) as Record<string, unknown>;
}

/** Binds this Account to the Identity that signed `proof`. The server refuses
 * a second, different Identity (409) — that immutability is what protects the
 * Key Backup (#36). */
export function linkIdentity(
  firebaseIdToken: string,
  proof: Record<string, unknown>,
): Promise<AccountOut> {
  return request("/account/link-identity", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firebaseIdToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ proof }),
  });
}

export function putKeyBackup(firebaseIdToken: string, blobBase64: string): Promise<{ status: string }> {
  return request("/account/key-backup", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${firebaseIdToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ blob_base64: blobBase64 }),
  });
}

export function getKeyBackup(firebaseIdToken: string): Promise<{ blob_base64: string }> {
  return request("/account/key-backup", { headers: { Authorization: `Bearer ${firebaseIdToken}` } });
}

/** Whether the server holds a Key Backup for this Account — 404 means none. */
export async function hasKeyBackup(firebaseIdToken: string): Promise<boolean> {
  try {
    await getKeyBackup(firebaseIdToken);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}

/**
 * The caller's own Workspaces. A restore on a new browser has no invite and
 * no local state, so this is how it finds where to reconnect (#36).
 */
export function listWorkspaces(firebaseIdToken: string): Promise<WorkspaceOut[]> {
  return request("/workspaces", { headers: { Authorization: `Bearer ${firebaseIdToken}` } });
}

/**
 * Creates a Workspace with this Identity as its owner. The slug is validated
 * server-side (kebab-case: it namespaces every event row and is a URL path
 * segment, ADR-0005) and decides the Workspace's own `relay_url`.
 */
export function createWorkspace(
  nip98Token: string,
  body: { slug: string; name: string },
): Promise<WorkspaceOut> {
  return request("/workspaces", {
    method: "POST",
    headers: { Authorization: nip98Token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Re-fetches a previously-joined Workspace, e.g. on app resume. Member-only. */
export function getWorkspace(slug: string, nip98Token: string): Promise<WorkspaceOut> {
  return request(`/workspaces/${encodeURIComponent(slug)}`, {
    headers: { Authorization: nip98Token },
  });
}

/** The caller's Channels in this Workspace. */
export function listChannels(slug: string, nip98Token: string): Promise<ChannelOut[]> {
  return request(`/workspaces/${encodeURIComponent(slug)}/channels`, {
    headers: { Authorization: nip98Token },
  });
}

// --- Admin: Invites --------------------------------------------------------

export function createInvite(
  slug: string,
  nip98Token: string,
  body: { role?: string; expires_at?: number | null; max_uses?: number | null } = {},
): Promise<InviteOut> {
  return request(`/workspaces/${encodeURIComponent(slug)}/invites`, {
    method: "POST",
    headers: { Authorization: nip98Token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function listInvites(slug: string, nip98Token: string): Promise<InviteOut[]> {
  return request(`/workspaces/${encodeURIComponent(slug)}/invites`, {
    headers: { Authorization: nip98Token },
  });
}

export function revokeInvite(slug: string, code: string, nip98Token: string): Promise<{ status: string }> {
  return request(`/workspaces/${encodeURIComponent(slug)}/invites/${encodeURIComponent(code)}`, {
    method: "DELETE",
    headers: { Authorization: nip98Token },
  });
}

// --- Admin: Workspace Members -----------------------------------------------

export function listWorkspaceMembers(slug: string, nip98Token: string): Promise<WorkspaceMemberOut[]> {
  return request(`/workspaces/${encodeURIComponent(slug)}/members`, {
    headers: { Authorization: nip98Token },
  });
}

export function setWorkspaceMemberRole(
  slug: string,
  pubkey: string,
  role: string,
  nip98Token: string,
): Promise<WorkspaceMemberOut> {
  return request(`/workspaces/${encodeURIComponent(slug)}/members/${encodeURIComponent(pubkey)}`, {
    method: "PATCH",
    headers: { Authorization: nip98Token, "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

export function removeWorkspaceMember(
  slug: string,
  pubkey: string,
  nip98Token: string,
): Promise<{ status: string }> {
  return request(`/workspaces/${encodeURIComponent(slug)}/members/${encodeURIComponent(pubkey)}`, {
    method: "DELETE",
    headers: { Authorization: nip98Token },
  });
}

// --- Admin: Channels ---------------------------------------------------------

export function createChannel(
  slug: string,
  nip98Token: string,
  body: { name: string; about: string; private: boolean },
): Promise<ChannelOut> {
  return request(`/workspaces/${encodeURIComponent(slug)}/channels`, {
    method: "POST",
    headers: { Authorization: nip98Token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function listChannelMembers(
  slug: string,
  channelId: string,
  nip98Token: string,
): Promise<ChannelMemberOut[]> {
  return request(
    `/workspaces/${encodeURIComponent(slug)}/channels/${encodeURIComponent(channelId)}/members`,
    { headers: { Authorization: nip98Token } },
  );
}

export function addChannelMember(
  slug: string,
  channelId: string,
  pubkey: string,
  role: string,
  nip98Token: string,
): Promise<{ status: string }> {
  return request(
    `/workspaces/${encodeURIComponent(slug)}/channels/${encodeURIComponent(channelId)}/members`,
    {
      method: "POST",
      headers: { Authorization: nip98Token, "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey, role }),
    },
  );
}

export function removeChannelMember(
  slug: string,
  channelId: string,
  pubkey: string,
  nip98Token: string,
): Promise<{ status: string }> {
  return request(
    `/workspaces/${encodeURIComponent(slug)}/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(pubkey)}`,
    { method: "DELETE", headers: { Authorization: nip98Token } },
  );
}
