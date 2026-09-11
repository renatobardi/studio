import type { ChannelOut } from "../../lib/api";

export function ChannelList({
  channels,
  selectedChannelId,
  unreadChannelIds,
  onSelect,
}: Readonly<{
  channels: ChannelOut[];
  selectedChannelId: string | null;
  unreadChannelIds: Set<string>;
  onSelect: (channelId: string) => void;
}>) {
  return (
    <nav className="channel-list" aria-label="Channels">
      {channels.map((channel) => (
        <button
          key={channel.id}
          className={`channel-list-item${channel.id === selectedChannelId ? " active" : ""}`}
          onClick={() => onSelect(channel.id)}
          data-testid="channel-list-item"
        >
          <span className="channel-list-name">#{channel.name}</span>
          {unreadChannelIds.has(channel.id) && <span className="unread-dot" aria-label="unread" />}
        </button>
      ))}
    </nav>
  );
}
