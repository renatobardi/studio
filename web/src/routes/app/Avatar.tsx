import { avatarFace, emojiFontSize } from "../../lib/avatar";
import { initials } from "../../lib/sidebar";
import type { Profile } from "./useProfiles";

/** A Member's avatar as the prototype draws it: their kind 0 `picture` — an image, or the emoji
 * Studio's avatar picker publishes there (#163) — otherwise initials on a muted tile. 32px beside a Message, 26px in a Direct Message, 24px in a list. */
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
  const face = avatarFace(profile?.picture);
  if (face.kind === "image") {
    return <img className="avatar" src={face.src} alt="" width={size} height={size} style={style} />;
  }
  if (face.kind === "emoji") {
    return (
      <span className="avatar" style={{ ...style, fontSize: emojiFontSize(size) }} aria-hidden="true">
        {face.emoji}
      </span>
    );
  }
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
