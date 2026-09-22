import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { render } from "@testing-library/react";
import { Steps } from "./Steps";

/** Flow 10 waits on the preview to say it is ready; a step that never finds its element used to
 * say nothing at all, and the spec waited its whole 30 s on a selector with no clue why (#227). */
describe("Steps", () => {
  const dataset = () => document.documentElement.dataset;

  /** Timers the test moves: the preview's own budget is seconds of real time. Each tick lets the
   * awaiting step run before the next timer is due. */
  const elapse = async (ms: number) => {
    for (let spent = 0; spent < ms; spent += 50) {
      jest.advanceTimersByTime(50);
      await Promise.resolve();
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    delete dataset().previewReady;
    delete dataset().previewFailed;
  });

  afterEach(() => {
    jest.useRealTimers();
    delete dataset().previewReady;
    delete dataset().previewFailed;
  });

  test("a step that never finds its element says which one, and how long it looked", async () => {
    render(<Steps steps={[{ waitFor: "[data-never-rendered]" }]} />);

    await elapse(3_000);

    expect(dataset().previewFailed).toBe("preview: nothing matched [data-never-rendered] within 2.5 s");
    expect(dataset().previewReady).toBeUndefined();
  });

  test("a chain that finds everything says ready, and nothing failed", async () => {
    document.body.insertAdjacentHTML("beforeend", '<button id="present">Go</button>');
    try {
      render(<Steps steps={[{ click: "#present" }]} />);

      await elapse(500);

      expect(dataset().previewReady).toBe("true");
      expect(dataset().previewFailed).toBeUndefined();
    } finally {
      document.getElementById("present")?.remove();
    }
  });
});
