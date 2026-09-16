import { initials } from "../../lib/sidebar";
import type { Profile } from "./useProfiles";

/** A Member's avatar as the prototype draws it: their kind 0 `picture` when set, otherwise
 * initials on a muted tile. 32px beside a Message, 26px in a Direct Message, 24px in a list. */
function fontSizeFor(size: number): number {
  if (size <= 24) return 9;
  if (size <= 26) return 10;
  return 11;
}

export function Avatar({
  profile,
  name,
  size = 32,
}: Readonly<{ profile: Profile | undefined; name: string; size?: number }>) {
  const style = { width: size, height: size, fontSize: fontSizeFor(size) };
  if (profile?.picture) {
    return <img className="avatar" src={profile.picture} alt="" width={size} height={size} style={style} />;
  }
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
