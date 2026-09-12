import type { ChannelOut } from "./api";

const WORKSPACE_MANAGER_ROLES = new Set(["owner", "admin"]);

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
