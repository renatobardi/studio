import type { Profile } from "../routes/app/useProfiles";
import type { Signer } from "./custody";
import { profileEventTemplate } from "./identity";
import type { RelayClient } from "./relay";
import { relayRejection } from "./relayReasons";

export interface ProfileFormFields {
  name: string;
  picture: string;
  about: string;
}

/** The fields to seed the profile editor's form with, or null to leave the form alone.
 *
 * Seeding happens exactly once per Identity: the profile arrives asynchronously from the
 * relay, and it keeps arriving afterwards — the editor's own save echoes back as a kind 0,
 * and so does another client's edit. Re-seeding on each of those would overwrite whatever
 * the person is in the middle of typing. */
export function profileFormSeed(
  profile: Profile | undefined,
  seededFor: string | null,
  pubkey: string,
): ProfileFormFields | null {
  if (!profile || seededFor === pubkey) return null;
  return publishedFields(profile);
}

/** What is published, as the form holds it — the fields a profile leaves out become the empty
 * strings a controlled input needs. */
function publishedFields(profile: Profile | undefined): ProfileFormFields {
  return { name: profile?.name ?? "", picture: profile?.picture ?? "", about: profile?.about ?? "" };
}

/** Saves the form as the Identity's kind 0. Fields left empty are left out of the event: a
 * published empty string would read as "this person deleted their bio". */
async function publishProfile(
  client: Pick<RelayClient, "publish">,
  signer: Pick<Signer, "signEvent">,
  fields: ProfileFormFields,
): Promise<void> {
  const template = profileEventTemplate({
    name: fields.name,
    picture: fields.picture || undefined,
    about: fields.about || undefined,
  });
  await client.publish(await signer.signEvent(template));
}

/** Why the save did not land, as the person who pressed Save needs to read it: the relay's own
 * refusal when there was one, and the connection only when there was not (#47). */
export function profileSaveMessage(error: unknown): string {
  return relayRejection(error) ?? "Couldn't save your profile. Check your connection and try again.";
}

/** Saves the form and answers with what to show: null when it landed, otherwise why it did not,
 * so the screen is left with nothing to decide but which of the two it got. */
export async function saveProfile(
  client: Pick<RelayClient, "publish">,
  signer: Pick<Signer, "signEvent">,
  fields: ProfileFormFields,
): Promise<string | null> {
  try {
    await publishProfile(client, signer, fields);
    return null;
  } catch (error) {
    return profileSaveMessage(error);
  }
}

/** Everything the profile screen's form is: what is typed, whether it is open, whether it is
 * saving and what went wrong last time — one value, so the screen has no state to keep in step. */
export interface ProfileFormState {
  editing: boolean;
  fields: ProfileFormFields;
  saving: boolean;
  error: string | null;
  /** The Identity the fields were seeded from, so a late kind 0 never overwrites typing. */
  seededFor: string | null;
}

export const NEW_PROFILE_FORM: ProfileFormState = {
  editing: false,
  fields: { name: "", picture: "", about: "" },
  saving: false,
  error: null,
  seededFor: null,
};

export type ProfileFormAction =
  | { type: "seed"; profile: Profile | undefined; pubkey: string }
  | { type: "edit" }
  | { type: "field"; field: keyof ProfileFormFields; value: string }
  | { type: "cancel"; profile: Profile | undefined }
  | { type: "saving" }
  | { type: "saved"; problem: string | null };

export function profileFormReducer(state: ProfileFormState, action: ProfileFormAction): ProfileFormState {
  switch (action.type) {
    case "seed": {
      const seed = profileFormSeed(action.profile, state.seededFor, action.pubkey);
      return seed ? { ...state, fields: seed, seededFor: action.pubkey } : state;
    }
    case "edit":
      return { ...state, editing: true };
    case "field":
      return { ...state, fields: { ...state.fields, [action.field]: action.value } };
    // Leaving the form puts back what is published, so a half-typed name does not survive
    // into the next time it is opened.
    case "cancel":
      return { ...state, editing: false, error: null, fields: publishedFields(action.profile) };
    case "saving":
      return { ...state, saving: true, error: null };
    // A save that was refused leaves the form open with the reason on it — closing it would
    // throw away what could not be published.
    case "saved":
      return { ...state, saving: false, error: action.problem, editing: action.problem !== null };
  }
}
