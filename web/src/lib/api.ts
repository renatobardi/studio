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
