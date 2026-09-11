import { nip44 } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { Signer } from "./custody";
import { MediaError, blossomAuthorizationHeader, buildBlossomAuthEvent, sha256Hex, validateAttachment, type BlobDescriptor } from "./media";

/** Base64 <-> bytes, without going through `atob`/`btoa`'s Latin1-string round trip for large
 * inputs (an image can be several MB — `String.fromCharCode(...bytes)` blows the call stack). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface EncryptedFile {
  /** The per-file NIP-44 key (hex) — carried inside the encrypted rumor, never sent to the server. */
  key: string;
  ciphertextBytes: Uint8Array;
  originalMime: string;
}

/** Direct Message photos (ticket #7): encrypts the file with a random per-file NIP-44 key
 * before it ever reaches the network, so the uploaded bytes are as private as the message text
 * (ADR-0003) — the server only ever sees opaque ciphertext. */
export function encryptFileForDm(bytes: ArrayBuffer, mime: string): EncryptedFile {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const plaintextBase64 = bytesToBase64(new Uint8Array(bytes));
  const ciphertextBase64 = nip44.encrypt(plaintextBase64, key);
  return {
    key: bytesToHex(key),
    ciphertextBytes: new TextEncoder().encode(ciphertextBase64),
    originalMime: mime,
  };
}

export function decryptDmAttachmentBytes(ciphertextBytes: ArrayBuffer, keyHex: string): Uint8Array {
  const ciphertextBase64 = new TextDecoder().decode(ciphertextBytes);
  const plaintextBase64 = nip44.decrypt(ciphertextBase64, hexToBytes(keyHex));
  return base64ToBytes(plaintextBase64);
}

/** Like `uploadBlob` in `./media`, but for already-encrypted bytes: no MIME/size validation
 * against the plaintext file (the caller validated that before encrypting), and the wire
 * Content-Type is always `application/octet-stream` — the server never sees the real type. */
export function uploadEncryptedBlob(
  mediaUrl: string,
  encrypted: EncryptedFile,
  signer: Signer,
  onProgress?: (loaded: number, total: number) => void,
): Promise<BlobDescriptor> {
  return (async () => {
    const sha256 = sha256Hex(encrypted.ciphertextBytes.buffer as ArrayBuffer);
    const authEvent = await buildBlossomAuthEvent("upload", { sha256 }, signer);

    return new Promise<BlobDescriptor>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${mediaUrl}/upload`);
      xhr.setRequestHeader("Authorization", blossomAuthorizationHeader(authEvent));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded, event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as BlobDescriptor);
        else reject(new MediaError("upload-failed", `Upload failed (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new MediaError("upload-failed", "Upload failed — check your connection."));
      xhr.send(encrypted.ciphertextBytes.buffer as ArrayBuffer);
    });
  })();
}

/** Fetches an encrypted DM attachment, verifies the ciphertext's sha256, decrypts it with the
 * per-file key carried in the rumor, and returns an object URL for the original image. */
export async function fetchDmAttachmentObjectUrl(
  url: string,
  sha256: string,
  keyHex: string,
  originalMime: string,
  signer: Signer,
): Promise<string> {
  const authEvent = await buildBlossomAuthEvent("get", {}, signer);
  const response = await fetch(url, { headers: { Authorization: blossomAuthorizationHeader(authEvent) } });
  if (!response.ok) throw new MediaError("fetch-failed", "Couldn't load the image.");
  const ciphertextBytes = await response.arrayBuffer();
  const actual = sha256Hex(ciphertextBytes);
  if (actual !== sha256) throw new MediaError("hash-mismatch", "The downloaded image doesn't match — try reloading.");
  const plaintextBytes = decryptDmAttachmentBytes(ciphertextBytes, keyHex);
  return URL.createObjectURL(new Blob([plaintextBytes as BlobPart], { type: originalMime }));
}

/** kind 14 rumor `imeta` tag for a Direct Message photo: like NIP-92's, plus the per-file
 * `key` the recipient needs to decrypt it. `url`/`x`/`size` describe the *ciphertext* blob;
 * `m` is the original (pre-encryption) MIME type. */
export function buildDmImetaTag(descriptor: BlobDescriptor, keyHex: string, originalMime: string, dim?: string): string[] {
  const tag = [
    "imeta",
    `url ${descriptor.url}`,
    `m ${originalMime}`,
    `x ${descriptor.sha256}`,
    `size ${descriptor.size}`,
    `key ${keyHex}`,
  ];
  if (dim) tag.push(`dim ${dim}`);
  return tag;
}

export interface DmAttachment {
  url: string;
  sha256: string;
  size: number;
  originalMime: string;
  key: string;
}

/** The inverse of `buildDmImetaTag`. */
export function parseDmImetaTags(tags: string[][]): DmAttachment[] {
  const attachments: DmAttachment[] = [];
  for (const tag of tags) {
    if (tag[0] !== "imeta") continue;
    const fields: Record<string, string> = {};
    for (const item of tag.slice(1)) {
      const spaceIndex = item.indexOf(" ");
      if (spaceIndex === -1) continue;
      fields[item.slice(0, spaceIndex)] = item.slice(spaceIndex + 1);
    }
    if (!fields.url || !fields.x || !fields.key) continue;
    attachments.push({
      url: fields.url, sha256: fields.x, size: Number(fields.size ?? 0),
      originalMime: fields.m ?? "", key: fields.key,
    });
  }
  return attachments;
}

export { validateAttachment };
