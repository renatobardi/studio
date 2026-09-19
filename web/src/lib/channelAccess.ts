import type { ChannelOut } from "./api";
import type { Filter } from "nostr-tools";
import type { SubscriptionHandle, SubscriptionHandlers } from "./relay";

/** All a roster subscription needs of a `RelayClient` — and all a test has to stand in for. */
export interface RosterClient {
  subscribe(filters: Filter[], handlers: SubscriptionHandlers): SubscriptionHandle;
}

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

/** The Channel Members a kind 39002 projection names — one `p` tag each. The control plane
 * re-publishes it on every membership change, so the latest one is the roster (ADR-0002). */
export function rosterPubkeys(roster: { tags: string[][] }): string[] {
  return roster.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]);
}

/** Whether `candidate` replaces `current` as the same addressable event: newer, or of the same
 * second with the lower id (NIP-01). */
function replaces(candidate: { created_at: number; id: string }, current: { created_at: number; id: string } | undefined): boolean {
  if (current === undefined) return true;
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at;
  return candidate.id < current.id;
}

/** The two projections the Channel's member views read: its roster (39002), which the header
 * pill counts and the members pane lists, and its admins (39001), which the pane labels Admin
 * (#145). One subscription for both, so opening the pane costs nothing extra (#143). Each is
 * replaceable: one older than the one applied — a reconnect's replay, another relay — is
 * ignored rather than rolling the roster back (#197). */
export function subscribeRoster(
  client: RosterClient,
  channelId: string,
  onRoster: (pubkeys: string[]) => void,
  onAdmins: (pubkeys: string[]) => void,
): () => void {
  const applied = new Map<number, { created_at: number; id: string }>();
  return client.subscribe(
    [
      { kinds: [39002], "#d": [channelId] },
      { kinds: [39001], "#d": [channelId] },
    ],
    {
      onEvent: (event) => {
        if (!replaces(event, applied.get(event.kind))) return;
        applied.set(event.kind, event);
        (event.kind === 39001 ? onAdmins : onRoster)(rosterPubkeys(event));
      },
    },
  );
}
