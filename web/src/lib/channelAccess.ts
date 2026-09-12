import type { ChannelOut } from "./api";

const WORKSPACE_MANAGER_ROLES = new Set(["owner", "admin"]);

/** The Workspace-signed projections that change what an Identity may reach:
 * Channel metadata (39000), Channel member lists (39002) and the add/remove
 * moderation events (9000/9001). Any of them can mean a Channel appeared or
 * disappeared for a caller, so each one re-reads the REST list — the
 * authority is the table, not the event (ADR-0002). */
export const ACCESS_PROJECTION_KINDS = [39000, 39002, 9000, 9001];

/** Where the app opens: the Channel this Identity last had open, or the first
 * one it can still reach. */
export function initialSelection(channels: ChannelOut[], rememberedId?: string): string | null {
  return channels.find((c) => c.id === rememberedId)?.id ?? channels[0]?.id ?? null;
}

/** The active Channel after the list changed — null once it is no longer
 * listed. Deliberately not a jump to a neighbour: leaving the view is what
 * tells the reader they lost access, and what stops further sends (#42).
 * The backend stays the authority; this only stops the client from pretending. */
export function keepSelection(channels: ChannelOut[], current: string | null): string | null {
  return channels.some((c) => c.id === current) ? current : null;
}

/** The Channels this caller may manage Members of — every Channel for a
 * Workspace owner/admin, and for anyone else the ones they are Channel admin
 * of. Mirrors `_require_channel_manager` in the API. */
export function manageableChannels(workspaceRole: string, channels: ChannelOut[]): ChannelOut[] {
  if (WORKSPACE_MANAGER_ROLES.has(workspaceRole)) return channels;
  return channels.filter((channel) => channel.role === "admin");
}

/** Whether to offer the admin console at all. */
export function canManageChannels(workspaceRole: string, channels: ChannelOut[]): boolean {
  return WORKSPACE_MANAGER_ROLES.has(workspaceRole) || manageableChannels(workspaceRole, channels).length > 0;
}

export function isWorkspaceManager(workspaceRole: string): boolean {
  return WORKSPACE_MANAGER_ROLES.has(workspaceRole);
}

/** Whether the "you lost access" notice should be showing after the Channel
 * list was re-read.
 *
 * It latches. One administrative change projects several events the app
 * subscribes to — removing a Channel Member emits both a member list (39002)
 * and a remove (9001) — and each of them re-reads the list. Only the first
 * pass still has the lost Channel selected; recomputing on the second would
 * clear the notice a moment after raising it. Choosing another Channel is
 * what takes it back down (#42). */
export function accessLostAfterRefresh(
  shown: boolean,
  selected: string | null,
  kept: string | null,
): boolean {
  return shown || (selected !== null && kept === null);
}
