import { describe, expect, test } from "bun:test";
import { createPriorityQueue } from "./fetchQueue";

/** Lets a test hold a task open and decide when — and whether — it ends. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {}); // a test that rejects one still owns the handling
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createPriorityQueue", () => {
  test("runs a task and hands back what it returned", async () => {
    const queue = createPriorityQueue(2);

    expect(await queue.run(0, () => Promise.resolve("bytes"))).toBe("bytes");
  });

  test("a task that throws rejects its own caller", async () => {
    const queue = createPriorityQueue(2);

    await expect(queue.run(0, () => Promise.reject(new Error("forbidden")))).rejects.toThrow("forbidden");
  });

  test("never holds more than the limit open at once", async () => {
    const queue = createPriorityQueue(2);
    const held = [deferred(), deferred(), deferred(), deferred()];
    let started = 0;

    for (const one of held) {
      queue.run(0, () => { started++; return one.promise; }).catch(() => {});
    }
    await settle();
    expect(started).toBe(2);

    held[0].resolve();
    await settle();
    expect(started).toBe(3);
  });

  test("the highest priority of a batch goes first, whatever order it was queued in", async () => {
    const queue = createPriorityQueue(2);
    const started: number[] = [];
    const held = deferred();

    // Queued oldest Message first, the way a conversation mounts its photos.
    for (const priority of [0, 1, 2, 3]) {
      queue.run(priority, () => { started.push(priority); return held.promise; }).catch(() => {});
    }
    await settle();

    expect(started).toEqual([3, 2]);
  });

  test("clearing drops what is still waiting, and it never starts", async () => {
    // Sign-out: the Identity those photos belong to is gone, so a task that
    // has not started must never run — it would fetch, and look in a cache,
    // for someone no longer here (#39).
    const queue = createPriorityQueue(1);
    const started: number[] = [];
    const held = deferred();

    queue.run(1, () => { started.push(1); return held.promise; }).catch(() => {});
    const dropped = queue.run(0, () => { started.push(0); return Promise.resolve(); });
    dropped.catch(() => {}); // the drop rejects it synchronously below
    await settle(); // the first one is running by now; the second is still waiting

    queue.clear();
    await settle();

    expect(started).toEqual([1]);
    await expect(dropped).rejects.toThrow(/signed out/i);
  });

  test("clearing lets later work through again", async () => {
    // The next Identity to sign in on this browser queues its own photos.
    const queue = createPriorityQueue(1);
    queue.clear();

    expect(await queue.run(0, () => Promise.resolve("bytes"))).toBe("bytes");
  });

  test("a batch larger than the limit runs to the last one, rejections included", async () => {
    // What waiting for a conversation's photos relies on (#39's smoke): the
    // newest ones on screen do not mean the rest were dropped — every task
    // still gets its slot, and one that fails does not strand the queue.
    const queue = createPriorityQueue(2);
    const started: number[] = [];

    const all = [0, 1, 2, 3, 4, 5, 6].map((n) =>
      queue.run(n, () => { started.push(n); return n % 3 === 0 ? Promise.reject(new Error("forbidden")) : Promise.resolve(); }),
    );
    await Promise.allSettled(all);

    expect([...started].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test("a task that never ends holds only its own slot", async () => {
    const queue = createPriorityQueue(2);
    const started: number[] = [];
    const hung = deferred();
    const failed = deferred();
    const newest = deferred();

    queue.run(0, () => { started.push(0); return hung.promise; }).catch(() => {});
    queue.run(1, () => { started.push(1); return failed.promise; }).catch(() => {});
    queue.run(2, () => { started.push(2); return newest.promise; }).catch(() => {});
    await settle();
    expect(started).toEqual([2, 1]);

    failed.reject(new Error("forbidden"));
    await settle();

    // The one still waiting takes the freed slot; the hung one blocks nobody but itself.
    expect(started).toEqual([2, 1, 0]);
  });
});
