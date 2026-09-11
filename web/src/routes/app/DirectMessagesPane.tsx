import { useEffect, useState } from "react";
import type { Signer } from "../../lib/custody";
import { groupConversations } from "../../lib/conversations";
import { conversationKey } from "../../lib/nip17";
import type { RelayClient } from "../../lib/relay";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import { useDirectMessages } from "./useDirectMessages";
import { useProfiles } from "./useProfiles";

/** Direct Messages mode (ticket #7): the conversation list plus the selected conversation —
 * the DM equivalent of `ChannelList` + `ChannelView`, sharing the same relay connection. */
export function DirectMessagesPane({
  client,
  myPubkey,
  signer,
  mediaUrl,
}: Readonly<{
  client: RelayClient;
  myPubkey: string;
  signer: Signer;
  mediaUrl: string;
}>) {
  const rumors = useDirectMessages(client, signer, myPubkey);
  const { profiles, ensure } = useProfiles(client);
  const [selectedPeerPubkeys, setSelectedPeerPubkeys] = useState<string[] | null>(null);

  const conversations = groupConversations(rumors, myPubkey);

  const authorPubkeysKey = [...new Set(rumors.map((r) => r.pubkey))].join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- authorPubkeysKey already tracks the pubkeys' contents
  useEffect(() => ensure(authorPubkeysKey.split(",").filter(Boolean)), [authorPubkeysKey, ensure]);

  const selectedKey = selectedPeerPubkeys ? conversationKey([...selectedPeerPubkeys, myPubkey]) : null;
  const selectedConversation = conversations.find((c) => c.key === selectedKey);

  return (
    <>
      <ConversationList
        conversations={conversations}
        selectedKey={selectedKey}
        onSelect={(key) => {
          const conversation = conversations.find((c) => c.key === key);
          if (conversation) setSelectedPeerPubkeys(conversation.peerPubkeys);
        }}
        onStart={(peerPubkey) => setSelectedPeerPubkeys([peerPubkey])}
        profiles={profiles}
      />
      {selectedPeerPubkeys && (
        <ConversationView
          key={selectedKey}
          client={client}
          myPubkey={myPubkey}
          peerPubkeys={selectedPeerPubkeys}
          signer={signer}
          mediaUrl={mediaUrl}
          messages={selectedConversation?.messages ?? []}
          profiles={profiles}
        />
      )}
      {!selectedPeerPubkeys && conversations.length === 0 && (
        <p className="meta">No Direct Messages yet — enter a pubkey to start one.</p>
      )}
    </>
  );
}
