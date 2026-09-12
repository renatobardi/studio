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

/**
 * Why a publish failed, as the person who pressed Send needs to read it.
 *
 * `publishEvent` rejects with whatever the relay put in its `OK … false`
 * frame, so a refusal ("restricted: not a member of this channel") and a dead
 * socket arrive the same way. Blaming the connection for a refusal is the
 * wrong advice: retrying will not help, and the real reason was already on
 * the wire (#47).
 */
export function publishFailureMessage(error: unknown): string {
  return relayRejection(error) ?? "Couldn't send — check your connection and try again.";
}

/** The relay's own refusal behind a failed publish, or null when the publish
 * failed for any other reason (a dead socket, a signer that said no). */
export function relayRejection(error: unknown): string | null {
  const message = error instanceof Error ? error.message.trim() : "";
  const prefix = message.slice(0, Math.max(message.indexOf(":"), 0));
  return Object.hasOwn(LEAD, prefix) ? humanRelayReason(message) : null;
}

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
