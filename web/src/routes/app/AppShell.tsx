import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { authProof, listChannels, type ChannelOut, type WorkspaceOut } from "../../lib/api";
import {
  ACCESS_PROJECTION_KINDS,
  accessLostAfterRefresh,
  canManageChannels,
  initialSelection,
  isWorkspaceManager,
  keepSelection,
} from "../../lib/channelAccess";
import { directMessages } from "../../lib/conversations";
import {
  loadChannelId,
  loadChannelReadAt,
  loadDmReadAt,
  storeChannelId,
  storeChannelReadAt,
  storeDmReadAt,
  type Signer,
} from "../../lib/custody";
import { selectableMembers } from "../../lib/memberDirectory";
import { RelayClient, type ConnectionState, type RelayProblem } from "../../lib/relay";
import { relayBanner } from "../../lib/relayReasons";
import {
  initialDmRead,
  markConversationRead,
  oldestRead,
  openChannel,
  seedMissing,
  touch,
  unreadChannelIds,
  type DmReadState,
  type OpenedChannel,
  type ReadState,
} from "../../lib/unread";
import { applyAppearance, DEFAULT_APPEARANCE, loadAppearance, storeAppearance, type Appearance } from "../../lib/appearance";
import { navigateTo, sidebarGroups, START_NAVIGATION } from "../../lib/sidebar";
import { AdminPane } from "./AdminPane";
import { ChannelsEmptyState } from "./ChannelsEmptyState";
import { ChannelView } from "./ChannelView";
import { ConversationView } from "./ConversationView";
import { NewMessageDialog } from "./NewMessageDialog";
import { SettingsView } from "./SettingsView";
import { Sidebar } from "./Sidebar";
import { useDirectMessages } from "./useDirectMessages";
import { displayName, ownDisplayName, profileName, shortNpub, useProfiles } from "./useProfiles";
import { useWorkspaceMembers } from "./useWorkspaceMembers";

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function AppShell({
  workspace,
  signer,
  onSignOut,
  client: providedClient,
}: Readonly<{
  workspace: WorkspaceOut;
  signer: Signer;
  onSignOut: () => void;
  /** The preview harness hands in a relay of fixtures; the app opens the Workspace's own. */
  client?: RelayClient;
}>) {
  const [client] = useState(() => providedClient ?? new RelayClient(workspace.relay_url, signer));
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
  /** The selected Channel's last-read mark as it was when opened — opening reads it at once,
   * so this is what still tells the timeline where "New" starts (#147). */
  const [opened, setOpened] = useState<OpenedChannel | null>(null);
  const [navigation, navigate] = useReducer(navigateTo, START_NAVIGATION);
  const { mode } = navigation;
  /** Theme, density and font scale live here so the sidebar's theme toggle and
   * Settings › Appearance change the same thing (#68, #71). */
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const { profiles, ensure: ensureProfiles } = useProfiles(client);
  /** A choice made before the stored value came back wins over it. */
  const appearanceTouched = useRef(false);
  /** Direct messages live in the sidebar (#142), so they are read from the moment the app opens. */
  const rumors = useDirectMessages(client, signer, pubkey);
  const { members, error: membersError } = useWorkspaceMembers(client, workspace.slug, signer);
  /** The open conversation's other participants — kept apart from the conversation itself, which
   * does not exist yet when a Member was just picked to start one. */
  const [selectedPeerPubkeys, setSelectedPeerPubkeys] = useState<string[] | null>(null);
  const [pickingMember, setPickingMember] = useState(false);
  /** Null until the stored marks are read back, as `readAt`. */
  const [dmRead, setDmRead] = useState<DmReadState | null>(null);

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
    if (pubkey) ensureProfiles([pubkey]);
  }, [pubkey, ensureProfiles]);

  const dm = directMessages({
    rumors,
    myPubkey: pubkey,
    members,
    selectedPeerPubkeys,
    readState: dmRead,
    nameOf: (peer) => displayName(profiles, peer),
  });
  const namedPubkeysKey = dm.namedPubkeys.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- namedPubkeysKey already tracks the pubkeys' contents
  useEffect(() => ensureProfiles(namedPubkeysKey.split(",").filter(Boolean)), [namedPubkeysKey, ensureProfiles]);

  useEffect(() => {
    loadDmReadAt().then((stored) => setDmRead((prev) => prev ?? initialDmRead(stored, nowSeconds())));
  }, []);

  useEffect(() => {
    if (dmRead !== null) void storeDmReadAt(dmRead);
  }, [dmRead]);

  const { selectedKey } = dm;
  const dmLoaded = dmRead !== null;
  const selectedLatestAt = dm.selected?.latest.created_at ?? 0;
  // The open conversation is read as it arrives — and only while it is on screen.
  useEffect(() => {
    if (mode !== "dms" || selectedKey === null || !dmLoaded) return;
    setDmRead((prev) => prev && markConversationRead(prev, selectedKey, nowSeconds(), selectedLatestAt));
  }, [mode, selectedKey, selectedLatestAt, dmLoaded]);

  useEffect(() => {
    loadAppearance().then((loaded) => {
      if (appearanceTouched.current) return;
      setAppearance(loaded);
      applyAppearance(loaded);
    });
  }, []);

  const updateAppearance = (next: Appearance) => {
    appearanceTouched.current = true;
    setAppearance(next);
    applyAppearance(next);
    void storeAppearance(next);
  };

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
      // Opening a Channel reads it — including the one resumed from last time. Its mark is
      // captured first: `touch` is about to overwrite the one the divider needs (#147).
      setOpened(resumed === null ? null : openChannel(marks, resumed, now));
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
    // Again before the touch below, which moves the mark this reads (#147).
    setOpened(openChannel(readAtRef.current, channelId, nowSeconds()));
    setReadAt((prev) => touch(prev ?? {}, channelId, nowSeconds()));
  };

  const handleSignOut = async () => {
    client.close();
    // The wipe itself belongs to whoever owns the screen this returns to: it
    // has somewhere to report a cleanup that failed (App.tsx, #39).
    onSignOut();
  };

  const openConversation = (peerPubkeys: string[]) => {
    setSelectedPeerPubkeys(peerPubkeys);
    navigate({ mode: "dms" });
  };

  const unread = unreadChannelIds(readAt ?? {}, activityAt);
  const canManage = canManageChannels(workspace.role, channels ?? []);
  const selectedChannel = channels?.find((c) => c.id === selectedChannelId) ?? null;
  const banner = relayBanner(connectionState, relayProblem);

  return (
    <div className="app-shell">
      <Sidebar
        groups={sidebarGroups({
          channels: channels ?? [],
          selectedChannelId,
          unreadChannelIds: unread,
          mode,
          canManage,
          conversations: dm.rows,
          selectedConversationKey: selectedKey,
        })}
        onSelect={(item) => {
          if (item.channelId) selectChannel(item.channelId);
          if (item.peerPubkeys) openConversation(item.peerPubkeys);
          else navigate({ mode: item.mode });
        }}
        onSelectMode={(next) => navigate({ mode: next })}
        onNewMessage={() => setPickingMember(true)}
        canCreateChannels={isWorkspaceManager(workspace.role)}
        onCreateChannel={() => navigate({ mode: "admin", adminTab: "channels" })}
        ownName={ownDisplayName(profiles, pubkey)}
        ownHandle={pubkey ? shortNpub(pubkey) : "…"}
        workspaceName={workspace.name}
        connectionState={connectionState}
        theme={appearance.theme}
        onToggleTheme={() => updateAppearance({ ...appearance, theme: appearance.theme === "dark" ? "light" : "dark" })}
        onOpenProfile={() => navigate({ mode: "settings", settingsSection: "profile" })}
        onOpenSettings={() => navigate({ mode: "settings", settingsSection: "appearance" })}
        onSignOut={() => void handleSignOut()}
      />
      <main className="app-main">
        {banner && (
          <div className="error-banner app-banner" data-testid="relay-problem">
            {banner.message}
            {banner.dismissible && (
              <button className="link link-inline" onClick={() => setRelayProblem(null)} data-testid="relay-problem-dismiss">
                Dismiss
              </button>
            )}
          </div>
        )}
        {mode === "channels" && (
          <>
            {accessLost && (
              <p className="meta app-notice" data-testid="channel-access-lost">
                You no longer have access to that Channel.
              </p>
            )}
            {selectedChannel && pubkey && (
              <ChannelView
                key={selectedChannel.id}
                client={client}
                channel={selectedChannel}
                pubkey={pubkey}
                signer={signer}
                mediaUrl={workspace.media_url}
                opened={opened}
              />
            )}
            {channels?.length === 0 && (
              <ChannelsEmptyState
                className="meta app-notice"
                canCreate={isWorkspaceManager(workspace.role)}
                onCreate={() => navigate({ mode: "admin", adminTab: "channels" })}
              />
            )}
          </>
        )}
        {mode === "dms" && pubkey && selectedPeerPubkeys && (
          <ConversationView
            key={selectedKey}
            client={client}
            myPubkey={pubkey}
            peerPubkeys={selectedPeerPubkeys}
            signer={signer}
            mediaUrl={workspace.media_url}
            messages={dm.selected?.messages ?? []}
            profiles={profiles}
          />
        )}
        {mode === "admin" && canManage && (
          <div className="app-scroll">
            <AdminPane
              key={navigation.adminVisit}
              client={client}
              signer={signer}
              slug={workspace.slug}
              workspaceRole={workspace.role}
              initialTab={navigation.adminTab}
            />
          </div>
        )}
        {mode === "settings" && pubkey && (
          <SettingsView
            key={navigation.settingsVisit}
            initialSection={navigation.settingsSection}
            client={client}
            signer={signer}
            pubkey={pubkey}
            appearance={appearance}
            onAppearanceChange={updateAppearance}
            onClose={() => navigate({ mode: "channels" })}
          />
        )}
      </main>
      {pickingMember && pubkey && (
        <NewMessageDialog
          members={selectableMembers(members, pubkey, (member) => profileName(profiles, member))}
          profiles={profiles}
          error={membersError}
          onPick={(member) => {
            setPickingMember(false);
            openConversation([member]);
          }}
          onCancel={() => setPickingMember(false)}
        />
      )}
    </div>
  );
}
