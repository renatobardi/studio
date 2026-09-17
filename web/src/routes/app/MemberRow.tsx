import { Icon } from "../../components/icons/Icon";
import { Avatar } from "./Avatar";
import { displayName, type useProfiles } from "./useProfiles";

/** Where a Member's caption is drawn, as the prototype draws each list: the Direct Message
 * picker puts it on the right of the row, the Channel members pane under the name (#145). */
export type MemberCaption = { text: string; at: "trailing" | "subtitle" };

/** One Member in a list: avatar, display name, and one optional caption the caller places.
 * Shared by the Channel's member list and the Direct Message picker. An agent gets the
 * prototype's bot tile. */
export function MemberRow({
  pubkey,
  profiles,
  onClick,
  testId,
  caption,
  agent = false,
}: Readonly<{
  pubkey: string;
  profiles: ReturnType<typeof useProfiles>["profiles"];
  onClick: () => void;
  testId: string;
  caption?: MemberCaption;
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
        {caption?.at === "subtitle" ? (
          <span className="member-row-text">
            <span className="channel-list-name">{name}</span>
            <span className="member-row-subtitle">{caption.text}</span>
          </span>
        ) : (
          <span className="channel-list-name">{name}</span>
        )}
      </span>
      {caption?.at === "trailing" && <span className="meta">{caption.text}</span>}
    </button>
  );
}
