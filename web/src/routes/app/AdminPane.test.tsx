import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminPane } from "./AdminPane";
import * as api from "../../lib/api";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";

const secretKey = generateSecretKey();
const signer: Signer = {
  getPublicKey: async () => getPublicKey(secretKey),
  signEvent: async (template: EventTemplate) => finalizeEvent(template, secretKey),
  nip44Encrypt: async () => {
    throw new Error("not used by the admin console");
  },
  nip44Decrypt: async () => {
    throw new Error("not used by the admin console");
  },
};

/** The admin console never reads the relay; only its type is needed to mount the pane. */
const client = {} as RelayClient;

describe("the admin console's Copy link", () => {
  // `spyOn` patches the module namespace for the whole process, so a spy left standing answers
  // the next file's tests — in an order that differs in CI.
  afterEach(() => mock.restore());

  test("a clipboard that refuses says so, and does not claim the link was copied", async () => {
    // An insecure context and a denied permission both reject here, and until now only reading
    // the code said the button handled it — the browser API is not reachable from lib/ (#94).
    spyOn(api, "listInvites").mockResolvedValue([
      { code: "abc123", role: "member", expires_at: null, max_uses: null, use_count: 0, revoked: false, state: "active" },
    ]);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: {
        writeText: () => Promise.reject(new Error("NotAllowedError")),
      },
      configurable: true,
    });

    render(
      <AdminPane
        client={client}
        signer={signer}
        slug="family"
        workspaceRole="owner"
        profileLookup={{ profiles: new Map(), ensure: () => {} }}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));

    expect(await screen.findByText(/Couldn't copy the link/i)).toBeDefined();
    expect(screen.queryByText("Link copied")).toBeNull();
  });
});
