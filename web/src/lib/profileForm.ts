import type { Profile } from "../routes/app/useProfiles";

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
  return {
    name: profile.name ?? "",
    picture: profile.picture ?? "",
    about: profile.about ?? "",
  };
}
