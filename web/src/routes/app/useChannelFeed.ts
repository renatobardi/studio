import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ChannelFeed } from "../../lib/channelFeed";
import type { RelayClient } from "../../lib/relay";

/** React's view of a Channel's content stream — the stream itself lives in `ChannelFeed`. */
export function useChannelFeed(client: RelayClient, channelId: string) {
  const feed = useMemo(() => new ChannelFeed(client, channelId), [client, channelId]);
  useEffect(() => feed.start(), [feed]);
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot);
  return { ...snapshot, loadOlder: () => feed.loadOlder() };
}
