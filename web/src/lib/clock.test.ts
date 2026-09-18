import { afterEach, expect, spyOn, test } from "bun:test";
import { nowSeconds } from "./clock";

afterEach(() => {
  spyOn(Date, "now").mockRestore();
});

test("the clock reads in whole seconds, the unit `created_at` is in", () => {
  spyOn(Date, "now").mockReturnValue(1_758_067_199_999);
  expect(nowSeconds()).toBe(1_758_067_199);
});
