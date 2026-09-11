import { useEffect, useState } from "react";
import type { Signer } from "../../lib/custody";
import type { TargetRef } from "../../lib/channelEvents";
import type { RelayClient } from "../../lib/relay";
import { MembersPane } from "./MembersPane";
import { ThreadPane } from "./ThreadPane";
import { Timeline } from "./Timeline";
import { useChannelFeed } from "./useChannelFeed";
import { useProfiles } from "./useProfiles";

type SidePane = { type: "thread"; root: TargetRef & { content: string } } | { type: "members" } | null;

export function ChannelView({
  client,
  channelId,
  pubkey,
  signer,
}: Readonly<{
  client: RelayClient;
  channelId: string;
  pubkey: string;
  signer: Signer;
}>) {
  const feed = useChannelFeed(client, channelId);
  const { profiles, ensure } = useProfiles(client);
  const [sidePane, setSidePane] = useState<SidePane>(null);

  const authorPubkeys = [...new Set([...feed.messages, ...feed.replies].map((e) => e.pubkey))];
  const authorPubkeysKey = authorPubkeys.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- authorPubkeysKey already tracks authorPubkeys' contents
  useEffect(() => ensure(authorPubkeys), [authorPubkeysKey, ensure]);

  return (
    <div className="channel-view">
      <div className="channel-view-header">
        <button
          className="btn btn-outline"
          onClick={() => setSidePane((prev) => (prev?.type === "members" ? null : { type: "members" }))}
        >
          Members
        </button>
      </div>
      <div className="channel-view-body">
        <Timeline
          client={client}
          channelId={channelId}
          pubkey={pubkey}
          signer={signer}
          messages={feed.messages}
          replies={feed.replies}
          reactions={feed.reactions}
          deletions={feed.deletions}
          hasMore={feed.hasMore}
          onLoadOlder={feed.loadOlder}
          profiles={profiles}
          openThreadRootId={sidePane?.type === "thread" ? sidePane.root.id : null}
          onOpenThread={(root) => setSidePane({ type: "thread", root })}
        />
        {sidePane?.type === "thread" && (
          <ThreadPane
            client={client}
            signer={signer}
            channelId={channelId}
            root={sidePane.root}
            allReplies={feed.replies}
            profiles={profiles}
          />
        )}
        {sidePane?.type === "members" && <MembersPane client={client} channelId={channelId} />}
      </div>
    </div>
  );
}
