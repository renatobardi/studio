import { nip19 } from "nostr-tools";
import { useState, type FormEvent } from "react";
import type { Conversation } from "../../lib/conversations";
import { displayName, type useProfiles } from "./useProfiles";

/** Decodes an `npub1…` or a raw 64-hex pubkey the same way; throws on anything else. */
function decodePubkey(input: string): string {
  if (input.startsWith("npub1")) {
    const decoded = nip19.decode(input);
    if (decoded.type !== "npub") throw new Error("not an npub");
    return decoded.data;
  }
  if (!/^[0-9a-f]{64}$/.test(input)) throw new Error("not a pubkey");
  return input;
}

export function ConversationList({
  conversations,
  selectedKey,
  onSelect,
  onStart,
  profiles,
}: Readonly<{
  conversations: Conversation[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onStart: (peerPubkey: string) => void;
  profiles: ReturnType<typeof useProfiles>["profiles"];
}>) {
  const [newPeer, setNewPeer] = useState("");
  const [newPeerError, setNewPeerError] = useState<string | null>(null);

  const startConversation = (e: FormEvent) => {
    e.preventDefault();
    setNewPeerError(null);
    const trimmed = newPeer.trim();
    if (!trimmed) return;
    try {
      onStart(decodePubkey(trimmed));
      setNewPeer("");
    } catch {
      setNewPeerError("Enter a valid pubkey or npub.");
    }
  };

  return (
    <nav className="conversation-list" aria-label="Direct Messages">
      <form className="conversation-list-new" onSubmit={startConversation}>
        <input
          className="composer-input"
          value={newPeer}
          placeholder="npub or pubkey…"
          onChange={(e) => setNewPeer(e.target.value)}
          data-testid="dm-new-peer-input"
        />
        <button className="btn btn-outline" type="submit" data-testid="dm-new-peer-start">
          New
        </button>
      </form>
      {newPeerError && <div className="error-banner">{newPeerError}</div>}
      {conversations.map((conversation) => (
        <button
          key={conversation.key}
          className={`channel-list-item${conversation.key === selectedKey ? " active" : ""}`}
          onClick={() => onSelect(conversation.key)}
          data-testid="conversation-list-item"
        >
          <span className="channel-list-name">
            {conversation.peerPubkeys.map((pubkey) => displayName(profiles, pubkey)).join(", ")}
          </span>
          <span className="meta">{conversation.latest.content.slice(0, 40)}</span>
        </button>
      ))}
    </nav>
  );
}
