import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import type { VerifiedEvent } from "nostr-tools";
import type { Signer } from "./custody";
import { cacheBlob, readCachedBlob } from "./mediaCache";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type MediaErrorCode = "unsupported-type" | "too-large" | "upload-failed" | "fetch-failed" | "hash-mismatch";

export class MediaError extends Error {
  code: MediaErrorCode;

  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
}

/** Rejects up front — before any network call — the same shapes the server would reject. */
export function validateAttachment(file: { type: string; size: number }): void {
  if (!file.type.startsWith("image/")) {
    throw new MediaError("unsupported-type", "Only images can be attached.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new MediaError("too-large", "Images must be 10 MB or smaller.");
  }
}

/** `crypto.subtle` only exists in a secure context (HTTPS, or literally `localhost`) — studio-test
 * runs over plain HTTP behind Tailscale, so a WebCrypto-based hash would break there. `@noble/hashes`
 * (already a transitive dependency of nostr-tools) works the same everywhere. */
export function sha256Hex(data: ArrayBuffer): string {
  const digest = nobleSha256(new Uint8Array(data));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** kind 24242 (BUD-01): a Blossom authorization event — `t` names the action, `expiration`
 * is a short-lived unix timestamp, and `x` (upload only) is the content's sha256. `recipients`
 * (upload only) are the Identities allowed to fetch a Direct Message photo: signed here, with
 * the hash, because the server grants no access from the gift wrap that carries it (#38). */
export function buildBlossomAuthEvent(
  action: "upload" | "get",
  opts: { sha256?: string; ttlSeconds?: number; recipients?: string[] } = {},
  signer: Signer,
): Promise<VerifiedEvent> {
  const tags = [["t", action], ["expiration", String(Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 300))]];
  if (opts.sha256) tags.push(["x", opts.sha256]);
  for (const recipient of opts.recipients ?? []) tags.push(["p", recipient]);
  return signer.signEvent({ kind: 24242, created_at: Math.floor(Date.now() / 1000), tags, content: "" });
}

export function blossomAuthorizationHeader(event: VerifiedEvent): string {
  const bytes = new TextEncoder().encode(JSON.stringify(event));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Nostr ${btoa(binary)}`;
}

/** NIP-92: one `imeta` tag for an attached image, referencing its uploaded blob. */
export function buildImetaTag(descriptor: BlobDescriptor, dim?: string): string[] {
  const tag = ["imeta", `url ${descriptor.url}`, `m ${descriptor.type}`, `x ${descriptor.sha256}`, `size ${descriptor.size}`];
  if (dim) tag.push(`dim ${dim}`);
  return tag;
}

/** The inverse of `buildImetaTag`: recovers each attached image's blob descriptor from a
 * Message's `imeta` tags (silently skipping one missing `url`/`x`, e.g. a malformed tag). */
export function parseImetaTags(tags: string[][]): BlobDescriptor[] {
  const descriptors: BlobDescriptor[] = [];
  for (const tag of tags) {
    if (tag[0] !== "imeta") continue;
    const fields: Record<string, string> = {};
    for (const item of tag.slice(1)) {
      const spaceIndex = item.indexOf(" ");
      if (spaceIndex === -1) continue;
      fields[item.slice(0, spaceIndex)] = item.slice(spaceIndex + 1);
    }
    if (!fields.url || !fields.x) continue;
    descriptors.push({ url: fields.url, sha256: fields.x, size: Number(fields.size ?? 0), type: fields.m ?? "" });
  }
  return descriptors;
}

/** Uploads an image to the Workspace's Blossom-shaped media server, reporting progress as it goes. */
export function uploadBlob(
  mediaUrl: string,
  file: File,
  signer: Signer,
  onProgress?: (loaded: number, total: number) => void,
): Promise<BlobDescriptor> {
  return (async () => {
    validateAttachment(file);
    const bytes = await file.arrayBuffer();
    const sha256 = sha256Hex(bytes);
    const authEvent = await buildBlossomAuthEvent("upload", { sha256 }, signer);

    return new Promise<BlobDescriptor>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${mediaUrl}/upload`);
      xhr.setRequestHeader("Authorization", blossomAuthorizationHeader(authEvent));
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded, event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as BlobDescriptor);
        else reject(new MediaError("upload-failed", `Upload failed (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new MediaError("upload-failed", "Upload failed — check your connection."));
      xhr.send(bytes);
    });
  })();
}

/** Fetches an attached image (following the server's redirect to storage), verifies its
 * sha256, and returns an object URL — the caller must revokeObjectURL when done with it.
 * Served from this Identity's own media cache when it is already there (#6/#39), and
 * verified there too: a cache hit is an earlier download, not a more trusted one. */
export async function fetchBlobObjectUrl(url: string, sha256: string, signer: Signer): Promise<string> {
  const pubkey = await signer.getPublicKey();
  const cached = await readCachedBlob(pubkey, url);
  if (cached && sha256Hex(cached.bytes) === sha256) {
    return URL.createObjectURL(new Blob([cached.bytes], { type: cached.contentType || "application/octet-stream" }));
  }

  const authEvent = await buildBlossomAuthEvent("get", {}, signer);
  const response = await fetch(url, { headers: { Authorization: blossomAuthorizationHeader(authEvent) } });
  if (!response.ok) throw new MediaError("fetch-failed", "Couldn't load the image.");
  const bytes = await response.arrayBuffer();
  const actual = sha256Hex(bytes);
  if (actual !== sha256) throw new MediaError("hash-mismatch", "The downloaded image doesn't match — try reloading.");
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  await cacheBlob(pubkey, url, bytes, contentType);
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
}
