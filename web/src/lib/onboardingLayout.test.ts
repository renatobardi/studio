import { describe, expect, test } from "bun:test";
import { stepMaxWidth } from "./onboardingLayout";

/** The prototype gives each onboarding step its own column width (500–900px); the steps the
 * app adds without a reference take the width of the step they replace. */
describe("stepMaxWidth", () => {
  test("follows the prototype per step", () => {
    expect(stepMaxWidth("invite")).toBe(500);
    expect(stepMaxWidth("profile")).toBe(576);
    expect(stepMaxWidth("avatar")).toBe(500);
    expect(stepMaxWidth("backup")).toBe(640);
    expect(stepMaxWidth("backup-options")).toBe(900);
    expect(stepMaxWidth("download")).toBe(500);
    expect(stepMaxWidth("setup")).toBe(820);
    expect(stepMaxWidth("config")).toBe(500);
  });

  test("restore, which the prototype does not draw, sits in the invite column", () => {
    expect(stepMaxWidth("restore")).toBe(500);
  });
});
