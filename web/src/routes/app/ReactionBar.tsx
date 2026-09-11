import type { ReactionGroup } from "../../lib/channelEvents";

const QUICK_EMOJIS = ["👍", "🔥", "❤️", "😂"];

export function ReactionBar({
  groups,
  ownPubkey,
  onAdd,
  onRemoveOwn,
}: Readonly<{
  groups: ReactionGroup[];
  ownPubkey: string;
  onAdd: (emoji: string) => void;
  onRemoveOwn: (emoji: string) => void;
}>) {
  return (
    <div className="reaction-bar">
      {groups.map((group) => {
        const reactedByMe = group.reactorPubkeys.includes(ownPubkey);
        return (
          <button
            key={group.emoji}
            className={`reaction-chip${reactedByMe ? " reacted" : ""}`}
            title={group.reactorPubkeys.join(", ")}
            onClick={() => (reactedByMe ? onRemoveOwn(group.emoji) : onAdd(group.emoji))}
            data-testid="reaction-chip"
            data-emoji={group.emoji}
          >
            {group.emoji} {group.count}
          </button>
        );
      })}
      <div className="reaction-picker">
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            className="reaction-picker-item"
            onClick={() => onAdd(emoji)}
            data-testid="reaction-add"
            data-emoji={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
