import { useCallback, useEffect, useRef, useState } from "react";
import { authProof, listChannels, type ChannelOut, type WorkspaceOut } from "../../lib/api";
import {
  ACCESS_PROJECTION_KINDS,
  accessLostAfterRefresh,
  canManageChannels,
  initialSelection,
  keepSelection,
} from "../../lib/channelAccess";
import {
  clearIdentity,
  loadChannelId,
  loadChannelReadAt,
  storeChannelId,
  storeChannelReadAt,
  type Signer,
} from "../../lib/custody";
import { RelayClient, type ConnectionState, type RelayProblem } from "../../lib/relay";
import { humanRelayReason } from "../../lib/relayReasons";
import { oldestRead, seedMissing, touch, unreadChannelIds, type ReadState } from "../../lib/unread";
import { AdminPane } from "./AdminPane";
import { AppearanceSettings } from "./AppearanceSettings";
import { ChannelList } from "./ChannelList";
import { ChannelView } from "./ChannelView";
import { ConnectionBadge } from "./ConnectionBadge";
import { DirectMessagesPane } from "./DirectMessagesPane";
import { IosInstallHint } from "./IosInstallHint";
import { ProfileEditor } from "./ProfileEditor";

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function AppShell({
  workspace,
  signer,
  onSignOut,
}: Readonly<{
  workspace: WorkspaceOut;
  signer: Signer;
  onSignOut: () => void;
}>) {
  const [client] = useState(() => new RelayClient(workspace.relay_url, signer));
  /** Where the access subscription starts. Fixed at mount, not at the moment
   * the REQ goes out: a membership change landing between the first Channel
   * fetch and that REQ would otherwise be missed, and nothing reconciles it
   * until the next administrative change (#42). */
  const [mountedAt] = useState(nowSeconds);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  /** What the relay refused and why. Without it a rejected subscription reads
   * as "Connected" over an empty timeline (#47). */
  const [relayProblem, setRelayProblem] = useState<RelayProblem | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelOut[] | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  /** Null until the stored marks are read back — writing before that would
   * race the load and wipe them. */
  const [readAt, setReadAt] = useState<ReadState | null>(null);
  const [activityAt, setActivityAt] = useState<ReadState>({});
  const [mode, setMode] = useState<"channels" | "dms" | "admin" | "settings">("channels");

  const selectedRef = useRef<string | null>(null);
  const readAtRef = useRef<ReadState>({});

  useEffect(() => {
    const unsubscribeState = client.onStateChange(setConnectionState);
    const unsubscribeProblem = client.onProblem(setRelayProblem);
    client.connect().catch(() => {});
    return () => {
      unsubscribeState();
      unsubscribeProblem();
      client.close();
    };
  }, [client]);

  useEffect(() => {
    signer.getPublicKey().then(setPubkey).catch(() => {});
  }, [signer]);

  useEffect(() => {
    selectedRef.current = selectedChannelId;
  }, [selectedChannelId]);

  useEffect(() => {
    if (readAt === null) return;
    readAtRef.current = readAt;
    void storeChannelReadAt(readAt);
  }, [readAt]);

  const fetchChannels = useCallback(async () => {
    const url = `${window.location.origin}/api/workspaces/${workspace.slug}/channels`;
    return listChannels(workspace.slug, await authProof(url, "GET", signer));
  }, [workspace.slug, signer]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, lastChannelId, storedReadAt] = await Promise.all([
        fetchChannels(),
        loadChannelId(),
        loadChannelReadAt(),
      ]);
      if (cancelled) return;
      const resumed = selectedRef.current ?? initialSelection(list, lastChannelId);
      const now = nowSeconds();
      let marks = seedMissing(storedReadAt, list.map((c) => c.id), now);
      // Opening a Channel reads it — including the one resumed from last time.
      if (resumed !== null) marks = touch(marks, resumed, now);
      // All three setState calls together, in the same tick — keeping them batched into one
      // render (as they were before this file needed a second, async lastChannelId source)
      // matters: a channels-then-selectedChannelId split across two renders churns the
      // unread-subscription effect below through subscribe→unsubscribe→resubscribe, which used
      // to crash the app on still-CONNECTING sockets (see relay.ts's send() guard).
      setReadAt(marks);
      setChannels(list);
      setSelectedChannelId(resumed);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchChannels]);

  /** Re-reads the Channel list and re-settles the navigation around it: a
   * Channel this Identity just gained appears, one it just lost disappears,
   * and the active Channel is left behind if it was the one lost (#42). */
  const refreshChannels = useCallback(async () => {
    const list = await fetchChannels();
    // Read the selection once, here: the updater below runs whenever React
    // gets to it, by which time the ref may already have been cleared.
    const selected = selectedRef.current;
    const kept = keepSelection(list, selected);
    setReadAt((prev) => seedMissing(prev ?? {}, list.map((c) => c.id), nowSeconds()));
    setChannels(list);
    setAccessLost((shown) => accessLostAfterRefresh(shown, selected, kept));
    setSelectedChannelId(kept);
  }, [fetchChannels]);

  const loaded = channels !== null;
  useEffect(() => {
    if (!loaded) return;
    return client.subscribe([{ kinds: ACCESS_PROJECTION_KINDS, since: mountedAt }], {
      onEvent: () => void refreshChannels().catch(() => {}),
    });
  }, [client, loaded, mountedAt, refreshChannels]);

  const channelIds = channels?.map((c) => c.id) ?? [];
  const channelIdsKey = channelIds.join(",");
  useEffect(() => {
    if (channelIdsKey === "" || pubkey === null) return;
    // From the oldest last-read mark, not from now: that is what makes a
    // Message sent while the app was closed still count as unread (#42).
    const since = oldestRead(readAtRef.current, channelIds, nowSeconds());
    return client.subscribe([{ kinds: [9], "#h": channelIds, since }], {
      onEvent: (event) => {
        const channelId = event.tags.find((t) => t[0] === "h")?.[1];
        if (!channelId || event.pubkey === pubkey) return;
        setActivityAt((prev) => touch(prev, channelId, event.created_at));
        // The open Channel is being read as it arrives — and only that one: a
        // Channel that is not on screen keeps its older last-read mark (#42).
        if (channelId === selectedRef.current) {
          setReadAt((prev) => touch(prev ?? {}, channelId, event.created_at));
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- channelIdsKey already tracks channelIds' contents
  }, [client, channelIdsKey, pubkey]);

  const selectChannel = (channelId: string) => {
    setAccessLost(false);
    setSelectedChannelId(channelId);
    void storeChannelId(channelId);
    setReadAt((prev) => touch(prev ?? {}, channelId, nowSeconds()));
  };

  const handleSignOut = async () => {
    client.close();
    await clearIdentity();
    onSignOut();
  };

  const unread = unreadChannelIds(readAt ?? {}, activityAt);
  const canManage = canManageChannels(workspace.role, channels ?? []);

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <h1>{workspace.name}</h1>
        <div className="app-shell-header-right">
          <nav className="app-shell-mode-switch" aria-label="Channels or Direct Messages">
            <button
              className={`btn btn-outline${mode === "channels" ? " active" : ""}`}
              onClick={() => setMode("channels")}
              data-testid="mode-channels"
            >
              Channels
            </button>
            <button
              className={`btn btn-outline${mode === "dms" ? " active" : ""}`}
              onClick={() => setMode("dms")}
              data-testid="mode-dms"
            >
              Direct Messages
            </button>
            {canManage && (
              <button
                className={`btn btn-outline${mode === "admin" ? " active" : ""}`}
                onClick={() => setMode("admin")}
                data-testid="mode-admin"
              >
                Admin
              </button>
            )}
            <button
              className={`btn btn-outline${mode === "settings" ? " active" : ""}`}
              onClick={() => setMode("settings")}
              data-testid="mode-settings"
            >
              Settings
            </button>
          </nav>
          <ConnectionBadge state={connectionState} />
          <span className="meta">Connected as {workspace.role}</span>
          <button className="btn btn-outline" onClick={() => void handleSignOut()}>
            Sign out
          </button>
        </div>
      </header>
      {relayProblem && (
        <div className="error-banner" data-testid="relay-problem">
          {humanRelayReason(relayProblem.reason)}
          {/* A refused AUTH keeps being true until the connection is re-made, so
              only the one-off refusals (a lagging subscription, a NOTICE) can be
              put away by hand. */}
          {relayProblem.kind !== "auth" && (
            <button className="link" onClick={() => setRelayProblem(null)} data-testid="relay-problem-dismiss">
              Dismiss
            </button>
          )}
        </div>
      )}
      <div className="app-shell-body">
        {mode === "channels" && (
          <>
            {channels && (
              <ChannelList
                channels={channels}
                selectedChannelId={selectedChannelId}
                unreadChannelIds={unread}
                onSelect={selectChannel}
              />
            )}
            {accessLost && (
              <p className="meta" data-testid="channel-access-lost">
                You no longer have access to that Channel.
              </p>
            )}
            {selectedChannelId && pubkey && (
              <ChannelView
                key={selectedChannelId}
                client={client}
                channelId={selectedChannelId}
                pubkey={pubkey}
                signer={signer}
                mediaUrl={workspace.media_url}
              />
            )}
            {channels?.length === 0 && <p className="meta">No Channels yet.</p>}
          </>
        )}
        {mode === "dms" && pubkey && (
          <DirectMessagesPane
            client={client}
            myPubkey={pubkey}
            signer={signer}
            mediaUrl={workspace.media_url}
            workspaceSlug={workspace.slug}
          />
        )}
        {mode === "admin" && canManage && (
          <AdminPane client={client} signer={signer} slug={workspace.slug} workspaceRole={workspace.role} />
        )}
        {mode === "settings" && pubkey && (
          <div className="stack">
            <IosInstallHint />
            <ProfileEditor client={client} signer={signer} pubkey={pubkey} />
            <AppearanceSettings />
          </div>
        )}
      </div>
    </div>
  );
}
