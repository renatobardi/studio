/** The Kubo brand mark — a five-petal line sakura (docs/UI/README.md "Assets"), ported from the
 * design system's `Sakura` component. Theme-aware through the `--sakura-petal` / `--sakura-ink`
 * tokens: pink petals with near-black ink on light, a pink outline on dark. Decorative only. */
const PETAL = "M50,50 C38,43 33,27 39,15 C42,8 47,10 50,17 C53,10 58,8 61,15 C67,27 62,43 50,50 Z";
const ARMS = [0, 1, 2, 3, 4];

export function Sakura({ size = 32, sw = 6, className }: Readonly<{ size?: number; sw?: number; className?: string }>) {
  const ink = "var(--sakura-ink)";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true">
      {ARMS.map((i) => (
        <path
          key={`p${i}`}
          d={PETAL}
          transform={`rotate(${i * 72} 50 50)`}
          fill="var(--sakura-petal)"
          stroke={ink}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
      ))}
      {ARMS.map((i) => (
        <line
          key={`l${i}`}
          x1="50"
          y1="50"
          x2="50"
          y2="34"
          transform={`rotate(${i * 72 + 36} 50 50)`}
          stroke={ink}
          strokeWidth={sw * 0.55}
          strokeLinecap="round"
        />
      ))}
      {ARMS.map((i) => (
        <circle key={`c${i}`} cx="50" cy="33" r={sw * 0.5} transform={`rotate(${i * 72 + 36} 50 50)`} fill={ink} />
      ))}
      <circle cx="50" cy="50" r={sw * 0.9} fill={ink} />
    </svg>
  );
}
