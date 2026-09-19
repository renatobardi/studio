import { describe, expect, test } from "bun:test";
import { ALL_EVENTS } from "./fixtures";

/** The preview — and so flow 10 — must exercise what the server emits: `build_channel_members` in
 * api/src/studio_api/nostr/projection.py writes each Channel Member as a bare `["p", pubkey]`,
 * with no role (#197). */
describe("preview fixtures", () => {
  test("a Channel roster (39002) names each Member as the server does, with no role", () => {
    const rosters = ALL_EVENTS.filter((event) => event.kind === 39002);
    expect(rosters.length).toBeGreaterThan(0);
    for (const roster of rosters) {
      for (const tag of roster.tags.filter((t) => t[0] === "p")) expect(tag).toHaveLength(2);
    }
  });
});
