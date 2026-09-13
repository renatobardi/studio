import type { Appearance, Density, FontScale, Theme } from "../../lib/appearance";

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfy", label: "Comfy" },
  { value: "spacious", label: "Spacious" },
];
const FONT_SCALES: { value: FontScale; label: string }[] = [
  { value: "smaller", label: "Smaller" },
  { value: "default", label: "Default" },
  { value: "larger", label: "Larger" },
];

/** Theme, density and font scale, as in the prototype's Settings > Appearance screen. The
 * value is owned by the shell (the sidebar's theme toggle changes the same thing); changes
 * apply immediately and persist across launches (studio.appearance in IndexedDB). */
export function AppearanceSettings({
  appearance,
  onChange,
}: Readonly<{ appearance: Appearance; onChange: (next: Appearance) => void }>) {
  const update = onChange;

  const group = <T extends string>(
    label: string,
    options: { value: T; label: string }[],
    value: T,
    select: (next: T) => void,
  ) => (
    <div className="segmented-row">
      <span className="segmented-label">{label}</span>
      <span className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            className={`segmented-option${option.value === value ? " active" : ""}`}
            aria-checked={option.value === value}
            onClick={() => select(option.value)}
          >
            {option.label}
          </button>
        ))}
      </span>
    </div>
  );

  return (
    <div className="settings-segmented" data-testid="appearance-settings">
      {group("Theme", THEMES, appearance.theme, (theme) => update({ ...appearance, theme }))}
      {group("Density", DENSITIES, appearance.density, (density) => update({ ...appearance, density }))}
      {group("Font size", FONT_SCALES, appearance.fontScale, (fontScale) => update({ ...appearance, fontScale }))}
    </div>
  );
}
