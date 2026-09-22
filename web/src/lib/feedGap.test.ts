import { describe, expect, test } from "bun:test";
import { gapLeftBy, mergeGaps } from "./feedGap";

const at = (...createdAts: number[]) => createdAts.map((created_at) => ({ created_at }));

describe("gapLeftBy", () => {
  test("an answer shorter than its limit covered its whole window", () => {
    expect(gapLeftBy(100, at(300, 200), 3)).toBeNull();
  });

  test("an answer cut at its limit leaves everything from `since` to its oldest event owed", () => {
    // Newest first, cut at the limit: what the relay did not send is the bottom of the window.
    // The oldest second is owed again because `until` is inclusive and more may share it.
    expect(gapLeftBy(100, at(300, 250, 200), 3)).toEqual({ since: 100, until: 200 });
  });
});

describe("mergeGaps", () => {
  test("nothing owed plus a gap is that gap", () => {
    expect(mergeGaps(null, { since: 1, until: 2 })).toEqual({ since: 1, until: 2 });
    expect(mergeGaps({ since: 1, until: 2 }, null)).toEqual({ since: 1, until: 2 });
  });

  test("two gaps become the one span that covers both", () => {
    // One gap, not a list: asking again for what lies between costs a page, dropped by id.
    expect(mergeGaps({ since: 100, until: 200 }, { since: 500, until: 900 })).toEqual({ since: 100, until: 900 });
  });
});
