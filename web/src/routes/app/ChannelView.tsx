import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/icons/Icon";
import type { ChannelOut, WorkspaceMemberOut } from "../../lib/api";
import { manageableChannels, rosterPubkeys } from "../../lib/channelAccess";
import type { Signer } from "../../lib/custody";
import { channelLayout } from "../../lib/paneLayout";
import type { TargetRef } from "../../lib/channelEvents";
import type { RelayClient } from "../../lib/relay";
import type { OpenedChannel } from "../../lib/unread";
import { MembersPane } from "./MembersPane";
import { MembersPill } from "./MembersPill";
import { ThreadPane } from "./ThreadPane";
import { Timeline } from "./Timeline";
import { useChannelFeed } from "./useChannelFeed";
import { useChannelRoster } from "./useChannelRoster";
import { useProfiles } from "./useProfiles";

type SidePane = { type: "thread"; root: TargetRef & { content: string; created_at?: number } } | { type: "members" } | null;

export function ChannelView({
  client,
  channel,
  pubkey,
  signer,
  mediaUrl,
  opened,
  slug,
  workspaceRole,
  workspaceMembers,
}: Readonly<{
  client: RelayClient;
  channel: ChannelOut;
  pubkey: string;
  signer: Signer;
  mediaUrl: string;
  opened: OpenedChannel | null;
  slug: string;
  workspaceRole: string;
  workspaceMembers: WorkspaceMemberOut[];
}>) {
  const channelId = channel.id;
  const feed = useChannelFeed(client, channelId);
  const { profiles, ensure } = useProfiles(client);
  const [sidePane, setSidePane] = useState<SidePane>(null);
  /** The Channel's roster (kind 39002) — the header pill counts it and MembersPane lists it (#143). */
  const memberPubkeys = useChannelRoster(client, channelId);
  /** The Channel's admins (kind 39001), which MembersPane labels Admin (#145). */
  const [channelAdmins, setChannelAdmins] = useState<string[]>([]);
  /** The Channel's own width, from the grid it lays out in — measured, not the viewport's,
   * because the sidebar and the shell zoom both eat into it (#72). */
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = gridRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = node.getBoundingClientRect().width;
      if (next > 0) setWidth((current) => (current === next ? current : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => client.subscribe([{ kinds: [39001], "#d": [channelId] }], { onEvent: (event) => setChannelAdmins(rosterPubkeys(event)) }),
    [client, channelId],
  );

  const layout = channelLayout(width, { thread: sidePane?.type === "thread", members: sidePane?.type === "members" });

  const authorPubkeys = [...new Set([...feed.messages, ...feed.replies].map((e) => e.pubkey))];
  const authorPubkeysKey = authorPubkeys.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- authorPubkeysKey already tracks authorPubkeys' contents
  useEffect(() => ensure(authorPubkeys), [authorPubkeysKey, ensure]);

  return (
    <section className="channel-view" aria-label={`Channel ${channel.name}`}>
      <div
        className={`channel-view-body${layout.narrow ? " narrow" : ""}`}
        ref={gridRef}
        style={{ gridTemplateColumns: layout.columns }}
      >
        {layout.showTimeline && (
          <div className="channel-main">
            <header className="pane-header">
              <span className="pane-title">
                <Icon name={channel.private ? "lock" : "hash"} className="pane-title-icon" />
                <h1 className="pane-title-text">{channel.name}</h1>
              </span>
              <span className="pane-header-actions">
                <MembersPill
                  pubkeys={memberPubkeys}
                  open={sidePane?.type === "members"}
                  onToggle={() => setSidePane((prev) => (prev?.type === "members" ? null : { type: "members" }))}
                />
              </span>
            </header>
            <Timeline
              client={client}
              channelId={channelId}
              pubkey={pubkey}
              signer={signer}
              mediaUrl={mediaUrl}
              messages={feed.messages}
              replies={feed.replies}
              reactions={feed.reactions}
              deletions={feed.deletions}
              hasMore={feed.hasMore}
              onLoadOlder={feed.loadOlder}
              profiles={profiles}
              opened={opened}
              openThreadRootId={sidePane?.type === "thread" ? sidePane.root.id : null}
              onOpenThread={(root) => {
                const message = feed.messages.find((m) => m.id === root.id);
                setSidePane({ type: "thread", root: { ...root, created_at: message?.created_at } });
              }}
            />
          </div>
        )}
        {sidePane?.type === "thread" && (
          <ThreadPane
            client={client}
            signer={signer}
            channelId={channelId}
            channelName={channel.name}
            root={sidePane.root}
            allReplies={feed.replies}
            profiles={profiles}
            onClose={() => setSidePane(null)}
          />
        )}
        {sidePane?.type === "members" && (
          <MembersPane
            client={client}
            signer={signer}
            slug={slug}
            channelId={channelId}
            memberPubkeys={memberPubkeys ?? []}
            channelAdmins={channelAdmins}
            workspaceMembers={workspaceMembers}
            canManage={manageableChannels(workspaceRole, [channel]).length > 0}
            overlay={layout.membersOverlay}
            onClose={() => setSidePane(null)}
          />
        )}
      </div>
    </section>
  );
}
