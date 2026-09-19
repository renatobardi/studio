import { addChannelMember, apiPath, authProof, proofUrl, type WorkspaceMemberOut } from "./api";
import type { Signer } from "./custody";

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
  ownPubkey: string,
  nameOf: (pubkey: string) => string | null,
): WorkspaceMemberOut[] {
  return members
    .filter((member) => member.pubkey !== ownPubkey)
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

/** What the members pane lists: the Channel's roster in its two groups, or — once something is
 * typed into "Add people and agents" — the Workspace Members that match it. */
export type MembersPaneList =
  | { mode: "roster"; people: ChannelMemberEntry[]; agents: ChannelMemberEntry[] }
  | { mode: "candidates"; candidates: WorkspaceMemberOut[] };

/** The pane's "Add people and agents" box: what is typed, and what the last add left behind. */
export interface MemberSearch {
  query: string;
  error: string | null;
}

/** The one list the pane shows for the current box. A search that matches nobody stays a
 * search: falling back to the roster would read as if the typing had done nothing (#145). */
export function membersPaneList(
  roster: readonly string[],
  workspaceMembers: readonly WorkspaceMemberOut[],
  channelAdmins: readonly string[],
  query: string,
  nameOf: (pubkey: string) => string | null,
): MembersPaneList {
  if (!query.trim()) return { mode: "roster", ...channelMemberGroups(roster, workspaceMembers, channelAdmins) };
  return { mode: "candidates", candidates: addableMembers(workspaceMembers, roster, query, nameOf) };
}

/** Adding a Workspace Member to this Channel from the members pane — the admin console's own
 * route, signed for it. The box it leaves: emptied once the Member is in, and on a refusal kept
 * as typed beside the reason, so the next attempt starts where this one stopped (#145). */
export async function addMemberToChannel(
  search: MemberSearch,
  slug: string,
  channelId: string,
  pubkey: string,
  signer: Signer,
): Promise<MemberSearch> {
  try {
    const url = proofUrl(apiPath("workspaces", slug, "channels", channelId, "members"));
    await addChannelMember(slug, channelId, pubkey, "member", await authProof(url, "POST", signer));
    return { query: "", error: null };
  } catch {
    return { ...search, error: "Couldn't add that Member." };
  }
}
