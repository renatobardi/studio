import type { ReactionGroup } from "../../lib/channelEvents";

const QUICK_EMOJIS = ["👍", "🔥", "❤️", "😂"];

/** The Reactions a Message has, as the prototype's pills: emoji and count, outlined when the
 * caller is among the reactors. Renders nothing when there are none. */
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
  if (groups.length === 0) return null;
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
            <span>{group.emoji}</span>
            <span className="reaction-count">{group.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The quick picker in a Message's hover actions. */
export function QuickReactions({ onAdd }: Readonly<{ onAdd: (emoji: string) => void }>) {
  return (
    <span className="reaction-picker" aria-label="Add a reaction">
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          className="reaction-picker-item"
          onClick={() => onAdd(emoji)}
          data-testid="reaction-add"
          data-emoji={emoji}
          title={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </span>
  );
}
