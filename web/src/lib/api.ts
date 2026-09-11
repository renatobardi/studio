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

export interface InvitePreview {
  workspace_name: string;
  valid: boolean;
}

export interface ChannelOut {
  id: string;
  name: string;
  about: string;
  private: boolean;
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

class ApiError extends Error {
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

export function getAccount(firebaseIdToken: string): Promise<{ uid: string; email: string; pubkey: string | null }> {
  return request("/account", { headers: { Authorization: `Bearer ${firebaseIdToken}` } });
}

export function linkIdentity(firebaseIdToken: string, nip98Token: string) {
  return request("/account/link-identity", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firebaseIdToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ proof: nip98Token }),
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
