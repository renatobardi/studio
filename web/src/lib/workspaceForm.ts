/**
 * Creating a Workspace from the interface (#46). The slug is the one field
 * with a rule behind it: it namespaces every event row as `<slug>:<key>` and
 * is a URL path segment (ADR-0005), so the server accepts kebab-case only.
 * Checking the same rule here is not a second source of truth — it is so a
 * typo answers while it is still being typed.
 */

/** Mirrors WORKSPACE_SLUG_PATTERN in api/src/studio_api/control/routes.py. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 64;

export interface WorkspaceFormFields {
  name: string;
  slug: string;
}

export type WorkspaceFormResult =
  | { ok: true; body: WorkspaceFormFields }
  | { ok: false; error: string };

/** The slug to suggest while the name is being typed. Suggesting one that the
 * server would refuse would teach the rule by rejection. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    // An apostrophe inside a word joins it, so it goes before the rest becomes
    // a separator: "Ada's Lab" is `adas-lab`, not `ada-s-lab`.
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

export function workspaceForm(fields: WorkspaceFormFields): WorkspaceFormResult {
  const name = fields.name.trim();
  const slug = fields.slug.trim();
  if (!name) return { ok: false, error: "Give the Workspace a name." };
  if (!SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX_LENGTH) {
    return {
      ok: false,
      error: "The address may only use lowercase letters, numbers and single hyphens.",
    };
  }
  return { ok: true, body: { name, slug } };
}
