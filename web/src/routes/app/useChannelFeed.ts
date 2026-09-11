import type { VerifiedEvent } from "nostr-tools";
import { useEffect, useState } from "react";
import type { RelayClient } from "../../lib/relay";

const PAGE_SIZE = 50;

/** A Channel's content stream: Messages (9), Thread Replies (1111), Reactions (7) and their
 * deletions (5) — one subscription per Channel, shared by the timeline and the thread pane so
 * they never race each other with separate REQs. */
export function useChannelFeed(client: RelayClient, channelId: string) {
  const [messages, setMessages] = useState<Map<string, VerifiedEvent>>(new Map());
  const [replies, setReplies] = useState<Map<string, VerifiedEvent>>(new Map());
  const [reactions, setReactions] = useState<Map<string, VerifiedEvent>>(new Map());
  const [deletions, setDeletions] = useState<Map<string, VerifiedEvent>>(new Map());
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    const onEvent = (event: VerifiedEvent) => {
      if (event.kind === 9) setMessages((m) => new Map(m).set(event.id, event));
      else if (event.kind === 1111) setReplies((m) => new Map(m).set(event.id, event));
      else if (event.kind === 7) setReactions((m) => new Map(m).set(event.id, event));
      else if (event.kind === 5) setDeletions((m) => new Map(m).set(event.id, event));
    };
    const unsubscribe = client.subscribe(
      [{ kinds: [9, 1111, 7, 5], "#h": [channelId], limit: PAGE_SIZE }],
      { onEvent },
    );
    return unsubscribe;
  }, [client, channelId]);

  const loadOlder = () => {
    const oldest = Math.min(...[...messages.values()].map((m) => m.created_at));
    if (!Number.isFinite(oldest)) return;
    let received = 0;
    const unsubscribe = client.subscribe(
      [{ kinds: [9, 1111, 7, 5], "#h": [channelId], until: oldest, limit: PAGE_SIZE }],
      {
        onEvent: (event) => {
          received += 1;
          if (event.kind === 9) setMessages((m) => new Map(m).set(event.id, event));
          else if (event.kind === 1111) setReplies((m) => new Map(m).set(event.id, event));
          else if (event.kind === 7) setReactions((m) => new Map(m).set(event.id, event));
          else if (event.kind === 5) setDeletions((m) => new Map(m).set(event.id, event));
        },
        onEose: () => {
          if (received === 0) setHasMore(false);
          unsubscribe();
        },
      },
    );
  };

  return {
    messages: [...messages.values()],
    replies: [...replies.values()],
    reactions: [...reactions.values()],
    deletions: [...deletions.values()],
    hasMore,
    loadOlder,
  };
}
