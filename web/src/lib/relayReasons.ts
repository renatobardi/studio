/**
 * Turns a relay's machine-readable reason into something a reader can act on.
 *
 * NIP-01 prefixes every `CLOSED`/`OK` reason with a class (`auth-required:`,
 * `restricted:`, …) and the relay's own detail after it. Both halves are worth
 * showing: the class says whose problem it is, the detail says which one. What
 * must never happen is the refusal going unsaid — "Connected" over an empty
 * timeline reads as "nothing was ever posted here" (#47).
 */
const LEAD: Record<string, string> = {
  "auth-required": "The Workspace needs you to sign in again",
  restricted: "The Workspace refused this request",
  "rate-limited": "The Workspace is rate-limiting this session",
  invalid: "The Workspace rejected what Studio sent",
  error: "The Workspace hit an error",
};

const FALLBACK_LEAD = "The Workspace refused this request";

export function humanRelayReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed === "") return `${FALLBACK_LEAD}, without saying why.`;
  const separator = trimmed.indexOf(":");
  const prefix = separator === -1 ? "" : trimmed.slice(0, separator);
  const lead = LEAD[prefix];
  if (lead === undefined) return `${FALLBACK_LEAD}: ${trimmed}.`;
  const detail = trimmed.slice(separator + 1).trim();
  return detail === "" ? `${lead}.` : `${lead}: ${detail}.`;
}
