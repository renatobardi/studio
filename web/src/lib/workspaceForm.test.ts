import { describe, expect, test } from "bun:test";
import { slugFromName, workspaceForm } from "./workspaceForm";

describe("slugFromName", () => {
  test("suggests the kebab-case slug the server will accept", () => {
    expect(slugFromName("Family Room")).toBe("family-room");
  });

  test("drops what the slug alphabet has no room for", () => {
    // The slug namespaces every event row as `<slug>:<key>` (ADR-0005), so a
    // colon is exactly what must never survive into one.
    expect(slugFromName("Ada's Lab: 2026!")).toBe("adas-lab-2026");
  });

  test("collapses runs and trims the edges, so no suggestion is born invalid", () => {
    expect(slugFromName("  The   Big --- Room  ")).toBe("the-big-room");
  });

  test("a name with nothing usable in it suggests nothing", () => {
    expect(slugFromName("🌸 ☃")).toBe("");
  });
});

describe("workspaceForm", () => {
  test("a filled-in form is what gets sent", () => {
    expect(workspaceForm({ name: "Family", slug: "family" })).toEqual({
      ok: true,
      body: { name: "Family", slug: "family" },
    });
  });

  test("trims, so a trailing space is not a rejected request", () => {
    expect(workspaceForm({ name: " Family ", slug: " family " })).toEqual({
      ok: true,
      body: { name: "Family", slug: "family" },
    });
  });

  test("a nameless Workspace is refused here rather than by the server", () => {
    expect(workspaceForm({ name: "  ", slug: "family" })).toEqual({
      ok: false,
      error: "Give the Workspace a name.",
    });
  });

  test.each([["with:colon"], ["With-Capitals"], ["trailing-"], ["has space"], [""], ["a".repeat(65)]])(
    "refuses the slug %p the server refuses too, and says what the rule is",
    (slug) => {
      const result = workspaceForm({ name: "Nope", slug });
      expect(result.ok).toBe(false);
      expect(result).toHaveProperty(
        "error",
        "The address may only use lowercase letters, numbers and single hyphens.",
      );
    },
  );
});
