import { describe, expect, test } from "bun:test";
import { channelLayout } from "./paneLayout";

/** How a Channel shares its width with a side pane (#72), as the prototype computes it: a
 * pane takes 380px, never less than 300 and never more than what leaves the timeline 300;
 * under 600px the pane takes the whole width — a thread replaces the timeline, the members
 * list floats over it. */
describe("channelLayout", () => {
  test("a wide Channel with no pane is one column", () => {
    expect(channelLayout(1184, { thread: false, members: false })).toEqual({
      narrow: false,
      columns: "minmax(0, 1fr)",
      showTimeline: true,
      membersOverlay: false,
    });
  });

  test("a thread on a wide Channel takes its default width", () => {
    expect(channelLayout(1184, { thread: true, members: false }).columns).toBe("minmax(0, 1fr) 380px");
  });

  test("a pane shrinks until the timeline would go under 300px, and never below 300 itself", () => {
    expect(channelLayout(640, { thread: true, members: false }).columns).toBe("minmax(0, 1fr) 340px");
    expect(channelLayout(610, { thread: false, members: true }).columns).toBe("minmax(0, 1fr) 310px");
    expect(channelLayout(600, { thread: true, members: false }).columns).toBe("minmax(0, 1fr) 300px");
  });

  test("under 600px a thread replaces the timeline and members float over it", () => {
    expect(channelLayout(390, { thread: true, members: false })).toEqual({
      narrow: true,
      columns: "minmax(0, 1fr)",
      showTimeline: false,
      membersOverlay: true,
    });
    expect(channelLayout(390, { thread: false, members: true }).showTimeline).toBe(true);
  });

  test("an unmeasured Channel (0px) is laid out as wide, not narrow", () => {
    expect(channelLayout(0, { thread: true, members: false }).narrow).toBe(false);
  });
});
