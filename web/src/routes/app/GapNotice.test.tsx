import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { GapNotice } from "./GapNotice";

/** What a feed owes after a reconnect it could not bring in one answer (#254): the rule is
 * `ChannelFeed`'s and `DmFeed`'s, tested in lib/; this is what reaches the screen. */
describe("GapNotice", () => {
  test("says nothing while nothing is owed", () => {
    const { container } = render(<GapNotice gap="none" onRetry={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  test("says what was missed is being recovered while it is asked for, with nothing to press", () => {
    const { getByRole, queryByRole } = render(<GapNotice gap="filling" onRetry={() => {}} />);
    expect(getByRole("status").textContent).toContain("Catching up");
    expect(queryByRole("button")).toBeNull();
  });

  test("once asking gave up, offers to try again — and only on request", () => {
    let retried = 0;
    const { getByRole } = render(<GapNotice gap="stalled" onRetry={() => (retried += 1)} />);
    expect(getByRole("status").textContent).toContain("could not be loaded");
    fireEvent.click(getByRole("button", { name: "Try again" }));
    expect(retried).toBe(1);
  });
});
