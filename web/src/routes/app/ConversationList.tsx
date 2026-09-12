import { useState } from "react";
import type { WorkspaceMemberOut } from "../../lib/api";
import type { Conversation } from "../../lib/conversations";
import { selectableMembers } from "../../lib/memberDirectory";
import { MemberPicker } from "./MemberPicker";
import { displayName, profileName, type useProfiles } from "./useProfiles";

export function ConversationList({
  conversations,
  members,
  myPubkey,
  selectedKey,
  onSelect,
  onStart,
  profiles,
  membersError,
}: Readonly<{
  conversations: Conversation[];
  members: WorkspaceMemberOut[];
  myPubkey: string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onStart: (peerPubkey: string) => void;
  profiles: ReturnType<typeof useProfiles>["profiles"];
  membersError: string | null;
}>) {
  const [picking, setPicking] = useState(false);

  return (
    <nav className="conversation-list" aria-label="Direct Messages">
      <button
        className="btn btn-outline"
        onClick={() => setPicking((open) => !open)}
        data-testid="dm-new-conversation"
      >
        {picking ? "Cancel" : "New Direct Message"}
      </button>
      {picking && membersError && <div className="error-banner">{membersError}</div>}
      {picking && (
        <MemberPicker
          members={selectableMembers(members, myPubkey, (pubkey) => profileName(profiles, pubkey))}
          profiles={profiles}
          onPick={(pubkey) => {
            setPicking(false);
            onStart(pubkey);
          }}
        />
      )}
      {conversations.map((conversation) => (
        <button
          key={conversation.key}
          className={`channel-list-item conversation-list-item-button${conversation.key === selectedKey ? " active" : ""}`}
          onClick={() => onSelect(conversation.key)}
          data-testid="conversation-list-item"
        >
          <span className="conversation-list-item-row">
            <span className="channel-list-name">
              {conversation.peerPubkeys.map((pubkey) => displayName(profiles, pubkey)).join(", ")}
            </span>
            <span className="meta">{new Date(conversation.latest.created_at * 1000).toLocaleTimeString()}</span>
          </span>
          <span className="meta">{conversation.latest.content.slice(0, 40)}</span>
        </button>
      ))}
    </nav>
  );
}
