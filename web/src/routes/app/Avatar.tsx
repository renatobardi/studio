import type { Profile } from "./useProfiles";

/** A Member's avatar: their kind 0 `picture` when set, otherwise the first letter of their
 * display name (matching the initials chip already used in onboarding — see `.avatar` in
 * app.css). */
export function Avatar({ profile, name }: { profile: Profile | undefined; name: string }) {
  if (profile?.picture) {
    return <img className="avatar" src={profile.picture} alt="" width={19} height={19} />;
  }
  return <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>;
}
