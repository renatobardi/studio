/** The column each onboarding step is laid out in, per the prototype (`max-width` of the
 * step's wrapper in docs/UI/design/Studio.dc.html). Steps the app has and the prototype does
 * not — restore — take the width of the step they stand next to. */
import type { OnboardingStep } from "./onboardingSteps";

export type LaidOutStep = OnboardingStep | "restore";

const WIDTHS: Record<LaidOutStep, number> = {
  invite: 500,
  restore: 500,
  profile: 576,
  avatar: 500,
  backup: 640,
  "backup-options": 900,
  download: 500,
  setup: 820,
  config: 500,
};

export function stepMaxWidth(step: LaidOutStep): number {
  return WIDTHS[step];
}
