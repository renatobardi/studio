import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RelayClient } from "../../lib/relay";
import { useChannelRoster } from "./useChannelRoster";

function Probe({ client }: Readonly<{ client: RelayClient }>) {
  const memberPubkeys = useChannelRoster(client, "c1");
  return <span>{memberPubkeys === null ? "unknown" : memberPubkeys.length}</span>;
}

/** The roster arrives over the relay (#143), so the first render has none: the header pill shows
 * no count rather than a 0, which would read as a Channel nobody is in. */
describe("useChannelRoster", () => {
  test("is unknown until the relay has sent the projection", () => {
    let subscriptions = 0;
    const client = {
      subscribe: () => {
        subscriptions += 1;
        return () => {};
      },
    } as unknown as RelayClient;
    expect(renderToStaticMarkup(<Probe client={client} />)).toBe("<span>unknown</span>");
    expect(subscriptions).toBe(0);
  });
});
