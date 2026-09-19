import { useEffect } from "react";
import { Avatar } from "./Avatar";
import { displayName, type ProfileLookup } from "./useProfiles";

/** Read-only view of another Workspace Member's kind 0 profile. */
export function MemberProfile({
  profileLookup,
  pubkey,
  onClose,
}: Readonly<{ profileLookup: ProfileLookup; pubkey: string; onClose: () => void }>) {
  const { profiles, ensure } = profileLookup;
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
