import type { WorkspaceMemberOut } from "./api";

/**
 * Who a Direct Message may be started with: the other Workspace Members.
 *
 * The Workspace member list is the source (REST, or the 13534 projection it
 * mirrors) — a Channel's 39002 roster only knows about that Channel, so it
 * would hide Members you share no Channel with. The server still decides
 * whether the wrap is accepted; this only decides what the picker offers, and
 * replaces the npub field the MVP flow no longer has (#47).
 */
export function selectableMembers(
  members: readonly WorkspaceMemberOut[],
  myPubkey: string,
  nameOf: (pubkey: string) => string | null,
): WorkspaceMemberOut[] {
  return members
    .filter((member) => member.pubkey !== myPubkey)
    .sort((left, right) => compareByName(nameOf(left.pubkey), nameOf(right.pubkey)));
}

/** Nameless Members sort last rather than under whatever their pubkey starts with. */
function compareByName(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}
