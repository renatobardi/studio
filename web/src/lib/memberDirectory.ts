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

export interface ChannelMemberEntry {
  pubkey: string;
  role: string;
}

/**
 * A Channel's roster (kind 39002) grouped the way the members pane lists it: People with the
 * role that governs them in this Channel, and Agents apart.
 *
 * The label mirrors `_require_channel_manager` in the API: a Workspace owner is Owner, a
 * Workspace admin or a Channel admin (kind 39001) is Admin — both manage the Channel — and
 * everyone else is Member. Someone the Workspace list does not name yet reads as a Member
 * until it does. Presence is not part of it: the MVP protocol has no presence event (#145).
 */
export function channelMemberGroups(
  roster: readonly string[],
  workspaceMembers: readonly WorkspaceMemberOut[],
  channelAdmins: readonly string[],
): { people: ChannelMemberEntry[]; agents: ChannelMemberEntry[] } {
  const workspaceRole = new Map(workspaceMembers.map((member) => [member.pubkey, member.role]));
  const people: ChannelMemberEntry[] = [];
  const agents: ChannelMemberEntry[] = [];
  for (const pubkey of roster) {
    const role = workspaceRole.get(pubkey);
    if (role === "agent") agents.push({ pubkey, role: "Agent" });
    else if (role === "owner") people.push({ pubkey, role: "Owner" });
    else if (role === "admin" || channelAdmins.includes(pubkey)) people.push({ pubkey, role: "Admin" });
    else people.push({ pubkey, role: "Member" });
  }
  return { people, agents };
}

/** Who "Add people and agents" offers for what was typed: Workspace Members not already in the
 * Channel whose name contains it. Only Workspace Members — the API refuses anyone else. */
export function addableMembers(
  members: readonly WorkspaceMemberOut[],
  roster: readonly string[],
  query: string,
  nameOf: (pubkey: string) => string | null,
): WorkspaceMemberOut[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return members
    .filter((member) => !roster.includes(member.pubkey))
    .filter((member) => nameOf(member.pubkey)?.toLocaleLowerCase().includes(needle))
    .sort((left, right) => compareByName(nameOf(left.pubkey), nameOf(right.pubkey)));
}
