/**
 * What an avatar draws from a kind 0 `picture` (#163). Studio's own avatar picker (onboarding and
 * the `profile` screen) publishes a single emoji there; other clients publish an image URL — or
 * anything at all. An image URL is the image, a single emoji is that emoji, and everything else
 * falls back to the initials rather than to a broken `<img>`.
 */
export type AvatarFace = { kind: "image"; src: string } | { kind: "emoji"; emoji: string } | { kind: "initials" };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function avatarFace(picture: string | undefined): AvatarFace {
  if (!picture) return { kind: "initials" };
  if (/^https?:\/\//.test(picture) || picture.startsWith("/")) return { kind: "image", src: picture };
  const isOneGlyph = [...graphemes.segment(picture)].length === 1;
  if (isOneGlyph && /\p{Extended_Pictographic}/u.test(picture)) return { kind: "emoji", emoji: picture };
  return { kind: "initials" };
}

/** An emoji avatar's font size, in the proportion of the onboarding picker's preview: a 64px
 * emoji in a 152px circle. */
export function emojiFontSize(size: number): number {
  return Math.round((size * 64) / 152);
}
