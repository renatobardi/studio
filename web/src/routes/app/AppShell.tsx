import { useEffect, useState } from "react";
import { authProof, listChannels, type ChannelOut, type WorkspaceOut } from "../../lib/api";
import { clearIdentity, loadChannelId, storeChannelId, type Signer } from "../../lib/custody";
import { RelayClient, type ConnectionState } from "../../lib/relay";
import { AdminPane } from "./AdminPane";
import { AppearanceSettings } from "./AppearanceSettings";
import { ChannelList } from "./ChannelList";
import { ChannelView } from "./ChannelView";
import { ConnectionBadge } from "./ConnectionBadge";
import { DirectMessagesPane } from "./DirectMessagesPane";
import { IosInstallHint } from "./IosInstallHint";
import { ProfileEditor } from "./ProfileEditor";

const MANAGER_ROLES = new Set(["owner", "admin"]);

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
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelOut[] | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [unreadChannelIds, setUnreadChannelIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"channels" | "dms" | "admin" | "settings">("channels");

  useEffect(() => {
    const unsubscribe = client.onStateChange(setConnectionState);
    client.connect().catch(() => {});
    return () => {
      unsubscribe();
      client.close();
    };
  }, [client]);

  useEffect(() => {
    signer.getPublicKey().then(setPubkey).catch(() => {});
  }, [signer]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = `${window.location.origin}/api/workspaces/${workspace.slug}/channels`;
      const [proof, lastChannelId] = await Promise.all([authProof(url, "GET", signer), loadChannelId()]);
      const list = await listChannels(workspace.slug, proof);
      if (cancelled) return;
      // Both setState calls together, in the same tick — keeping them batched into one render
      // (as they were before this file needed a second, async lastChannelId source) matters: a
      // channels-then-selectedChannelId split across two renders churns the unread-subscription
      // effect below through subscribe→unsubscribe→resubscribe, which used to crash the app on
      // still-CONNECTING sockets (see relay.ts's send() guard) — this avoids the churn outright.
      setChannels(list);
      setSelectedChannelId((current) => current ?? list.find((c) => c.id === lastChannelId)?.id ?? list[0]?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace.slug, signer]);

  useEffect(() => {
    if (!channels || channels.length === 0) return;
    const unsubscribe = client.subscribe(
      [{ kinds: [9], "#h": channels.map((c) => c.id), since: Math.floor(Date.now() / 1000) }],
      {
        onEvent: (event) => {
          const channelId = event.tags.find((t) => t[0] === "h")?.[1];
          if (channelId && channelId !== selectedChannelId) {
            setUnreadChannelIds((prev) => new Set(prev).add(channelId));
          }
        },
      },
    );
    return unsubscribe;
  }, [client, channels, selectedChannelId]);

  const selectChannel = (channelId: string) => {
    setSelectedChannelId(channelId);
    void storeChannelId(channelId);
    setUnreadChannelIds((prev) => {
      if (!prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
  };

  const handleSignOut = async () => {
    client.close();
    await clearIdentity();
    onSignOut();
  };

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
            {MANAGER_ROLES.has(workspace.role) && (
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
      <div className="app-shell-body">
        {mode === "channels" && (
          <>
            {channels && (
              <ChannelList
                channels={channels}
                selectedChannelId={selectedChannelId}
                unreadChannelIds={unreadChannelIds}
                onSelect={selectChannel}
              />
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
          <DirectMessagesPane client={client} myPubkey={pubkey} signer={signer} mediaUrl={workspace.media_url} />
        )}
        {mode === "admin" && MANAGER_ROLES.has(workspace.role) && (
          <AdminPane client={client} signer={signer} slug={workspace.slug} />
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
