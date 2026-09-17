import { Icon } from "../../components/icons/Icon";
import { Avatar } from "./Avatar";
import { displayName, type useProfiles } from "./useProfiles";

/** One Member in a list: avatar, display name, and whatever the list wants on the right
 * (a role, nothing) or under the name (the Channel members pane's role, #145). Shared by the
 * Channel's member list and the Direct Message picker. An agent gets the prototype's bot tile. */
export function MemberRow({
  pubkey,
  profiles,
  onClick,
  testId,
  trailing,
  subtitle,
  agent = false,
}: Readonly<{
  pubkey: string;
  profiles: ReturnType<typeof useProfiles>["profiles"];
  onClick: () => void;
  testId: string;
  trailing?: string;
  subtitle?: string;
  agent?: boolean;
}>) {
  const name = displayName(profiles, pubkey);
  return (
    <button className="channel-list-item" onClick={onClick} data-testid={testId} data-pubkey={pubkey}>
      <span className="member-row">
        {agent ? (
          <span className="avatar avatar-agent" aria-hidden="true">
            <Icon name="bot" size={13} />
          </span>
        ) : (
          <Avatar profile={profiles.get(pubkey)} name={name} size={24} />
        )}
        {subtitle ? (
          <span className="member-row-text">
            <span className="channel-list-name">{name}</span>
            <span className="member-row-subtitle">{subtitle}</span>
          </span>
        ) : (
          <span className="channel-list-name">{name}</span>
        )}
      </span>
      {trailing && <span className="meta">{trailing}</span>}
    </button>
  );
}
