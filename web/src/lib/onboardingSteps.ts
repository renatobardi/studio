/**
 * Which onboarding steps this person walks, and which of them they may skip
 * (ticket #45's approved decisions).
 *
 * Custody decides the shape of the flow. Under local custody the app holds
 * the key, so it must make a Key Backup and watch the passphrase decrypt it
 * before going any further. A NIP-07 extension holds the key and never
 * exports it: there is nothing for the app to back up, and generating an
 * Identity of its own would leave the person with two.
 */

export type Custody = "extension" | "local";

export type OnboardingStep =
  | "invite"
  | "profile"
  | "avatar"
  | "backup"
  | "backup-options"
  | "download"
  | "setup"
  | "config";

const LOCAL_STEPS: readonly OnboardingStep[] = [
  "invite",
  "profile",
  "avatar",
  "backup",
  "backup-options",
  "download",
  "setup",
  "config",
];

/** Absent under an extension, not merely skippable: there is no key to back up. */
const CUSTODY_STEPS: readonly OnboardingStep[] = ["backup", "backup-options", "download"];

/**
 * Cosmetic only. The "download" step is where the passphrase is verified and
 * the Key Backup uploaded — downloading the file is the optional part of it,
 * offered as a side action, so the step itself can never be skipped.
 */
const SKIPPABLE: readonly OnboardingStep[] = ["avatar"];

export function stepsFor(custody: Custody): OnboardingStep[] {
  if (custody === "local") return [...LOCAL_STEPS];
  return LOCAL_STEPS.filter((step) => !CUSTODY_STEPS.includes(step));
}

export function isSkippable(step: OnboardingStep, custody: Custody): boolean {
  return stepsFor(custody).includes(step) && SKIPPABLE.includes(step);
}

export function nextStep(step: OnboardingStep, custody: Custody): OnboardingStep | null {
  return neighbour(step, custody, 1);
}

export function previousStep(step: OnboardingStep, custody: Custody): OnboardingStep | null {
  return neighbour(step, custody, -1);
}

function neighbour(step: OnboardingStep, custody: Custody, offset: number): OnboardingStep | null {
  const steps = stepsFor(custody);
  const index = steps.indexOf(step);
  if (index === -1) return null;
  return steps[index + offset] ?? null;
}
