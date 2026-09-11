import { describe, expect, test } from "bun:test";
import {
  isSkippable,
  nextStep,
  previousStep,
  stepsFor,
  type OnboardingStep,
} from "./onboardingSteps";

describe("stepsFor", () => {
  test("local custody walks the whole Key Backup arc", () => {
    expect(stepsFor("local")).toEqual([
      "invite",
      "profile",
      "avatar",
      "backup",
      "backup-options",
      "download",
      "setup",
      "config",
    ]);
  });

  test("a NIP-07 extension has no Key Backup steps at all", () => {
    // The extension holds the key and never exports it, so the app has
    // nothing to back up — and must not generate a second Identity (#45).
    expect(stepsFor("extension")).toEqual(["invite", "profile", "avatar", "setup", "config"]);
  });
});

describe("isSkippable", () => {
  test("the avatar is cosmetic", () => {
    expect(isSkippable("avatar", "local")).toBe(true);
  });

  test("nothing that establishes or verifies custody can be skipped", () => {
    // "download" is the passphrase-verification step; the file download is
    // the optional side action within it, not the step itself (#45).
    for (const step of ["invite", "profile", "backup", "backup-options", "download", "setup"] as const) {
      expect(isSkippable(step, "local")).toBe(false);
    }
  });

  test("a step absent from this custody's flow is not skippable", () => {
    expect(isSkippable("download", "extension")).toBe(false);
  });
});

describe("nextStep / previousStep", () => {
  test("local custody moves through the backup arc", () => {
    expect(nextStep("avatar", "local")).toBe("backup");
    expect(previousStep("backup", "local")).toBe("avatar");
  });

  test("an extension steps straight from the avatar to setup", () => {
    expect(nextStep("avatar", "extension")).toBe("setup");
    expect(previousStep("setup", "extension")).toBe("avatar");
  });

  test("the ends of the flow have no neighbour", () => {
    expect(nextStep("config", "local")).toBeNull();
    expect(previousStep("invite", "local")).toBeNull();
  });

  test("a step outside this custody's flow has no neighbour", () => {
    expect(nextStep("download" as OnboardingStep, "extension")).toBeNull();
  });
});
