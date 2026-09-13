import { useEffect, useState } from "react";
import { Icon } from "../../components/icons/Icon";
import type { ChannelOut } from "../../lib/api";
import type { Signer } from "../../lib/custody";
import type { TargetRef } from "../../lib/channelEvents";
import type { RelayClient } from "../../lib/relay";
import { MembersPane } from "./MembersPane";
import { ThreadPane } from "./ThreadPane";
import { Timeline } from "./Timeline";
import { useChannelFeed } from "./useChannelFeed";
import { useProfiles } from "./useProfiles";

type SidePane = { type: "thread"; root: TargetRef & { content: string; created_at?: number } } | { type: "members" } | null;

export function ChannelView({
  client,
  channel,
  pubkey,
  signer,
  mediaUrl,
}: Readonly<{
  client: RelayClient;
  channel: ChannelOut;
  pubkey: string;
  signer: Signer;
  mediaUrl: string;
}>) {
  const channelId = channel.id;
  const feed = useChannelFeed(client, channelId);
  const { profiles, ensure } = useProfiles(client);
  const [sidePane, setSidePane] = useState<SidePane>(null);

  const authorPubkeys = [...new Set([...feed.messages, ...feed.replies].map((e) => e.pubkey))];
  const authorPubkeysKey = authorPubkeys.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- authorPubkeysKey already tracks authorPubkeys' contents
  useEffect(() => ensure(authorPubkeys), [authorPubkeysKey, ensure]);

  return (
    <section className="channel-view" aria-label={`Channel ${channel.name}`}>
      <header className="pane-header">
        <span className="pane-title">
          <Icon name={channel.private ? "lock" : "hash"} className="pane-title-icon" />
          <h1 className="pane-title-text">{channel.name}</h1>
        </span>
        <span className="pane-header-actions">
          <button
            className={`btn btn-outline${sidePane?.type === "members" ? " active" : ""}`}
            aria-pressed={sidePane?.type === "members"}
            title="Channel members"
            onClick={() => setSidePane((prev) => (prev?.type === "members" ? null : { type: "members" }))}
          >
            <Icon name="user" />
            Members
          </button>
        </span>
      </header>
      <div className="channel-view-body">
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
          openThreadRootId={sidePane?.type === "thread" ? sidePane.root.id : null}
          onOpenThread={(root) => {
            const message = feed.messages.find((m) => m.id === root.id);
            setSidePane({ type: "thread", root: { ...root, created_at: message?.created_at } });
          }}
        />
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
          <MembersPane client={client} channelId={channelId} onClose={() => setSidePane(null)} />
        )}
      </div>
    </section>
  );
}
