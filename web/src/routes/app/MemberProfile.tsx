import { useEffect } from "react";
import type { RelayClient } from "../../lib/relay";
import { Avatar } from "./Avatar";
import { displayName, useProfiles } from "./useProfiles";

/** Read-only view of another Workspace Member's kind 0 profile. */
export function MemberProfile({
  client,
  pubkey,
  onClose,
}: Readonly<{ client: RelayClient; pubkey: string; onClose: () => void }>) {
  const { profiles, ensure } = useProfiles(client);
  useEffect(() => ensure([pubkey]), [pubkey, ensure]);
  const profile = profiles.get(pubkey);
  const name = displayName(profiles, pubkey);

  return (
    <div className="card stack" data-testid="member-profile">
      <div className="conversation-list-item-row">
        <h2>{name}</h2>
        <button className="btn btn-outline" onClick={onClose}>
          Close
        </button>
      </div>
      <Avatar profile={profile} name={name} />
      {profile?.about && <p>{profile.about}</p>}
      <p className="meta">{pubkey}</p>
    </div>
  );
}
