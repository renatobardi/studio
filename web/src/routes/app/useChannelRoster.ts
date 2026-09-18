import { useEffect, useState } from "react";
import { subscribeRoster } from "../../lib/channelAccess";
import type { RelayClient } from "../../lib/relay";

/** React's view of a Channel's Members (kind 39002) — `null` until the relay has sent the
 * projection, so nothing counts an empty roster before it arrives (#143). */
export function useChannelRoster(client: RelayClient, channelId: string): string[] | null {
  const [memberPubkeys, setMemberPubkeys] = useState<string[] | null>(null);
  useEffect(() => subscribeRoster(client, channelId, setMemberPubkeys), [client, channelId]);
  return memberPubkeys;
}
