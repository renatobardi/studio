import type { CSSProperties } from "react";
import { ICON_PATHS, type IconName } from "./icons";

/** A monochrome Lucide glyph, drawn the way the Kubo `Icon` wrapper draws it: 24×24 viewBox,
 * `currentColor` strokes of width 2 with round caps and joins, 16px unless told otherwise. */
export function Icon({
  name,
  size = 16,
  className,
  style,
}: Readonly<{ name: IconName; size?: number; className?: string; style?: CSSProperties }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
