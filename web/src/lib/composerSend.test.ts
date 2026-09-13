import { describe, expect, test } from "bun:test";
import { createSingleFlight, draftAfterSend } from "./composerSend";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("a composer's Send (#105)", () => {
  test("a second Send while the first is still publishing publishes nothing", async () => {
    const publishing = deferred();
    let publishes = 0;
    const once = createSingleFlight();
    const send = () =>
      once(async () => {
        publishes++;
        await publishing.promise;
      });

    const first = send();
    const second = send();
    publishing.resolve();
    await Promise.all([first, second]);

    expect(publishes).toBe(1);
  });

  test("once a Send settles — sent or failed — the next one goes out", async () => {
    let publishes = 0;
    const once = createSingleFlight();
    const send = () =>
      once(async () => {
        publishes++;
        if (publishes === 1) throw new Error("restricted: not a member of this channel");
      });

    await expect(send()).rejects.toThrow("restricted");
    await send();

    expect(publishes).toBe(2);
  });

  test("text typed while the Message was publishing stays in the composer", () => {
    expect(draftAfterSend("hello and one more thing", "hello")).toBe(" and one more thing");
  });

  test("with nothing typed meanwhile the composer is left empty", () => {
    expect(draftAfterSend("hello", "hello")).toBe("");
  });

  test("a draft rewritten while publishing is kept whole — it is no longer what was sent", () => {
    expect(draftAfterSend("goodbye", "hello")).toBe("goodbye");
  });
});
