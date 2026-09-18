import { describe, expect, test } from "bun:test";
import type { EventTemplate, VerifiedEvent } from "nostr-tools";
import {
  NEW_PROFILE_FORM,
  profileFormReducer,
  profileFormSeed,
  profileSaveMessage,
  saveProfile,
  type ProfileFormAction,
  type ProfileFormState,
} from "./profileForm";

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

/** Saving the form is one kind 0 with only the fields that were filled in (#150): an empty bio
 * is left out of the event rather than published as an empty string. */
describe("saveProfile", () => {
  const collect = () => {
    const published: { kind: number; content: string }[] = [];
    const signer = { signEvent: async (template: EventTemplate) => template as unknown as VerifiedEvent };
    const client = {
      publish: async (event: VerifiedEvent) => {
        published.push(event);
      },
    };
    return { published, signer, client };
  };

  test("publishes the signed kind 0 with the fields that were filled in", async () => {
    const { published, signer, client } = collect();
    expect(await saveProfile(client, signer, { name: "Ana Petrova", picture: "🦊", about: "Building things" })).toBeNull();
    expect(published).toHaveLength(1);
    expect(published[0].kind).toBe(0);
    expect(JSON.parse(published[0].content)).toEqual({ name: "Ana Petrova", picture: "🦊", about: "Building things" });
  });

  test("leaves an empty avatar or bio out of the event instead of publishing a blank one", async () => {
    const { published, signer, client } = collect();
    await saveProfile(client, signer, { name: "Ana Petrova", picture: "", about: "" });
    expect(JSON.parse(published[0].content)).toEqual({ name: "Ana Petrova" });
  });
});

describe("profileSaveMessage", () => {
  test("says what the relay refused, when it refused", () => {
    expect(profileSaveMessage(new Error("restricted: not a member of this channel"))).toContain("refused");
  });

  test("blames the connection only when there was no refusal to report", () => {
    expect(profileSaveMessage(new Error("socket closed"))).toBe(
      "Couldn't save your profile. Check your connection and try again.",
    );
  });
});

describe("saveProfile when the relay says no", () => {
  test("answers with the relay's own refusal instead of throwing at the screen", async () => {
    const client = {
      publish: async () => {
        throw new Error("restricted: not a member of this channel");
      },
    };
    const signer = { signEvent: async (template: EventTemplate) => template as unknown as VerifiedEvent };
    expect(await saveProfile(client, signer, { name: "Ana", picture: "", about: "" })).toContain("refused");
  });
});

/** The profile screen's form is one value (#150): what is typed, whether it is open, whether it
 * is saving, and what the relay said last time. */
describe("profileFormReducer", () => {
  const reduce = (state: ProfileFormState, ...actions: ProfileFormAction[]) =>
    actions.reduce(profileFormReducer, state);

  test("starts closed and empty", () => {
    expect(NEW_PROFILE_FORM.editing).toBe(false);
    expect(NEW_PROFILE_FORM.fields).toEqual({ name: "", picture: "", about: "" });
  });

  test("seeds the fields from the published profile, once", () => {
    const seeded = reduce(NEW_PROFILE_FORM, { type: "seed", profile: { name: "Ana" }, pubkey: "pub1" });
    expect(seeded.fields).toEqual({ name: "Ana", picture: "", about: "" });
    const typed = reduce(seeded, { type: "field", field: "name", value: "Ana Petrova" });
    expect(reduce(typed, { type: "seed", profile: { name: "Ana" }, pubkey: "pub1" })).toBe(typed);
  });

  test("edits one field at a time", () => {
    const typed = reduce(NEW_PROFILE_FORM, { type: "edit" }, { type: "field", field: "picture", value: "🦊" });
    expect(typed.editing).toBe(true);
    expect(typed.fields).toEqual({ name: "", picture: "🦊", about: "" });
  });

  test("cancelling closes the form and puts back what is published", () => {
    const typed = reduce(NEW_PROFILE_FORM, { type: "edit" }, { type: "field", field: "name", value: "half-typed" });
    const cancelled = reduce(typed, { type: "cancel", profile: { name: "Ana", about: "Bio" } });
    expect(cancelled.editing).toBe(false);
    expect(cancelled.fields).toEqual({ name: "Ana", picture: "", about: "Bio" });
  });

  test("cancelling with nothing published empties the fields rather than leaving them typed", () => {
    const typed = reduce(NEW_PROFILE_FORM, { type: "edit" }, { type: "field", field: "name", value: "half-typed" });
    expect(reduce(typed, { type: "cancel", profile: undefined }).fields).toEqual({
      name: "",
      picture: "",
      about: "",
    });
  });

  test("saving clears the last error while it is in flight", () => {
    const failed = reduce(NEW_PROFILE_FORM, { type: "edit" }, { type: "saved", problem: "The Workspace refused it" });
    const inFlight = reduce(failed, { type: "saving" });
    expect(inFlight).toEqual({ ...failed, saving: true, error: null });
  });

  test("a save that landed closes the form", () => {
    const saved = reduce(NEW_PROFILE_FORM, { type: "edit" }, { type: "saving" }, { type: "saved", problem: null });
    expect(saved).toEqual({ ...NEW_PROFILE_FORM, editing: false, saving: false, error: null });
  });

  test("a save that was refused leaves the form open with the reason on it", () => {
    const refused = reduce(
      NEW_PROFILE_FORM,
      { type: "edit" },
      { type: "field", field: "name", value: "Ana" },
      { type: "saving" },
      { type: "saved", problem: "The Workspace refused this request" },
    );
    expect(refused.editing).toBe(true);
    expect(refused.saving).toBe(false);
    expect(refused.error).toBe("The Workspace refused this request");
    expect(refused.fields.name).toBe("Ana");
  });
});
