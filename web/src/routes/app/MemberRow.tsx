import { Avatar } from "./Avatar";
import { displayName, type useProfiles } from "./useProfiles";

/** One Member in a list: avatar, display name, and whatever the list wants on the right
 * (a role, nothing). Shared by the Channel's member list and the Direct Message picker. */
export function MemberRow({
  pubkey,
  profiles,
  onClick,
  testId,
  trailing,
}: Readonly<{
  pubkey: string;
  profiles: ReturnType<typeof useProfiles>["profiles"];
  onClick: () => void;
  testId: string;
  trailing?: string;
}>) {
  const name = displayName(profiles, pubkey);
  return (
    <button className="channel-list-item" onClick={onClick} data-testid={testId} data-pubkey={pubkey}>
      <span className="member-row">
        <Avatar profile={profiles.get(pubkey)} name={name} />
        <span className="channel-list-name">{name}</span>
      </span>
      {trailing && <span className="meta">{trailing}</span>}
    </button>
  );
}
