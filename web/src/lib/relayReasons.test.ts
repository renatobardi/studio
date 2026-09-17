import { describe, expect, test } from "bun:test";
import { humanRelayReason, isAlreadyStored, publishFailureMessage, relayBanner, relayRejection } from "./relayReasons";

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

describe("publishFailureMessage", () => {
  test("a relay rejection says what the relay said", () => {
    // publishEvent rejects with the relay's own OK-false message.
    expect(publishFailureMessage(new Error("restricted: not a member of this channel"))).toBe(
      "The Workspace refused this request: not a member of this channel.",
    );
    expect(publishFailureMessage(new Error("auth-required: publishing requires authentication"))).toBe(
      "The Workspace needs you to sign in again: publishing requires authentication.",
    );
  });

  test("a publish that failed for any other reason has no relay rejection behind it", () => {
    expect(relayRejection(new Error("timed out waiting for the connection to open"))).toBeNull();
    expect(relayRejection(new Error("restricted: not a member of this channel"))).toBe(
      "The Workspace refused this request: not a member of this channel.",
    );
  });

  test("anything else is a connection problem, as before", () => {
    expect(publishFailureMessage(new Error("timed out waiting for the connection to open"))).toBe(
      "Couldn't send — check your connection and try again.",
    );
    expect(publishFailureMessage("not even an error")).toBe(
      "Couldn't send — check your connection and try again.",
    );
  });
});

describe("isAlreadyStored", () => {
  test("a relay that already has the event answered with the NIP-01 duplicate class", () => {
    expect(isAlreadyStored(new Error("duplicate: already have this event"))).toBe(true);
    expect(isAlreadyStored(new Error("restricted: not a member of this workspace"))).toBe(false);
    expect(isAlreadyStored(new Error("connection lost before the relay confirmed the event"))).toBe(false);
  });
});

/** The one line above the main area that says why nothing is arriving (#148): the footer no
 * longer spells out the connection, so a socket that is not open has to be said here. */
describe("relayBanner", () => {
  test("an open connection the relay refused nothing on shows no banner", () => {
    expect(relayBanner("open", null)).toBeNull();
  });

  test("a connection that is not open says so, and stays until it is", () => {
    expect(relayBanner("connecting", null)).toEqual({ message: "Connecting to the Workspace…", dismissible: false });
    expect(relayBanner("reconnecting", null)).toEqual({
      message: "Lost the connection to the Workspace. Reconnecting…",
      dismissible: false,
    });
    expect(relayBanner("closed", null)).toEqual({ message: "Disconnected from the Workspace.", dismissible: false });
  });

  test("what the relay refused wins over the connection state, and only a refused AUTH cannot be put away", () => {
    expect(relayBanner("open", { kind: "notice", reason: "error: this subscription fell too far behind" })).toEqual({
      message: "The Workspace hit an error: this subscription fell too far behind.",
      dismissible: true,
    });
    expect(relayBanner("reconnecting", { kind: "auth", reason: "restricted: removed from the Workspace" })).toEqual({
      message: "The Workspace refused this request: removed from the Workspace.",
      dismissible: false,
    });
  });
});
