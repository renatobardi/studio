import { describe, expect, test } from "bun:test";
import { humanRelayReason } from "./relayReasons";

describe("humanRelayReason", () => {
  test("names what the relay refused, keeping its own detail", () => {
    // The exact strings api/src/studio_api/nostr/relay.py sends.
    expect(humanRelayReason("restricted: not a member of this workspace")).toBe(
      "The Workspace refused this request: not a member of this workspace.",
    );
    expect(humanRelayReason("restricted: removed from the Workspace")).toBe(
      "The Workspace refused this request: removed from the Workspace.",
    );
    expect(humanRelayReason("auth-required: this relay requires authentication")).toBe(
      "The Workspace needs you to sign in again: this relay requires authentication.",
    );
    expect(humanRelayReason("rate-limited: no more than 20 subscriptions per connection")).toBe(
      "The Workspace is rate-limiting this session: no more than 20 subscriptions per connection.",
    );
    expect(humanRelayReason("invalid: more than 10 filters")).toBe(
      "The Workspace rejected what Studio sent: more than 10 filters.",
    );
    expect(humanRelayReason("error: this subscription fell too far behind")).toBe(
      "The Workspace hit an error: this subscription fell too far behind.",
    );
  });

  test("a reason with no NIP-01 prefix is shown as the relay wrote it", () => {
    expect(humanRelayReason("something nobody mapped")).toBe(
      "The Workspace refused this request: something nobody mapped.",
    );
  });

  test("an empty reason still says something", () => {
    expect(humanRelayReason("")).toBe("The Workspace refused this request, without saying why.");
    expect(humanRelayReason("   ")).toBe("The Workspace refused this request, without saying why.");
  });
});
