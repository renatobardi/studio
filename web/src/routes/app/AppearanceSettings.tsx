import { useEffect, useState } from "react";
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  loadAppearance,
  storeAppearance,
  type Appearance,
  type Density,
  type FontScale,
  type Theme,
} from "../../lib/appearance";

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

/** Theme, density and font scale, as in the prototype's Settings > Appearance screen. Changes
 * apply immediately and persist across launches (studio.appearance in IndexedDB). */
export function AppearanceSettings() {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    loadAppearance().then((loaded) => {
      setAppearance(loaded);
      applyAppearance(loaded);
    });
  }, []);

  const update = (next: Appearance) => {
    setAppearance(next);
    applyAppearance(next);
    void storeAppearance(next);
  };

  return (
    <div className="card stack" data-testid="appearance-settings">
      <h2>Appearance</h2>
      <div className="field">
        <span className="field-label">Theme</span>
        <div className="button-group" role="radiogroup" aria-label="Theme">
          {THEMES.map(({ value, label }) => (
            <button
              key={value}
              className={`btn btn-outline${appearance.theme === value ? " active" : ""}`}
              aria-pressed={appearance.theme === value}
              onClick={() => update({ ...appearance, theme: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Density</span>
        <div className="button-group" role="radiogroup" aria-label="Density">
          {DENSITIES.map(({ value, label }) => (
            <button
              key={value}
              className={`btn btn-outline${appearance.density === value ? " active" : ""}`}
              aria-pressed={appearance.density === value}
              onClick={() => update({ ...appearance, density: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Font size</span>
        <div className="button-group" role="radiogroup" aria-label="Font size">
          {FONT_SCALES.map(({ value, label }) => (
            <button
              key={value}
              className={`btn btn-outline${appearance.fontScale === value ? " active" : ""}`}
              aria-pressed={appearance.fontScale === value}
              onClick={() => update({ ...appearance, fontScale: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
