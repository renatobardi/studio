import { describe, expect, test } from "bun:test";
import { profileFormSeed } from "./profileForm";

describe("profileFormSeed", () => {
  test("waits: there is nothing to seed the form with until the profile arrives", () => {
    expect(profileFormSeed(undefined, null, "pub1")).toBeNull();
  });

  test("seeds every field once the profile arrives", () => {
    expect(profileFormSeed({ name: "Ada", picture: "http://x/a.png", about: "hi" }, null, "pub1")).toEqual({
      name: "Ada",
      picture: "http://x/a.png",
      about: "hi",
    });
  });

  test("fills the fields the profile leaves out, so the inputs stay controlled", () => {
    expect(profileFormSeed({ name: "Ada" }, null, "pub1")).toEqual({ name: "Ada", picture: "", about: "" });
  });

  test("never seeds twice for the same Identity — typing survives a late profile update", () => {
    // The relay echoes back the kind 0 the editor itself just published, and
    // any other client's edit arrives the same way. Re-seeding then would wipe
    // whatever is half-typed in the form.
    expect(profileFormSeed({ name: "Ada" }, "pub1", "pub1")).toBeNull();
  });

  test("seeds again when the form is now editing a different Identity", () => {
    expect(profileFormSeed({ name: "Grace" }, "pub1", "pub2")).toEqual({
      name: "Grace",
      picture: "",
      about: "",
    });
  });
});
