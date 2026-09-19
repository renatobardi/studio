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

/** A deadline no test here reaches, for the ones that are not about deadlines. */
const NO_HURRY = 60_000;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `promise`, or a rejection saying it was still pending after `ms` — so a task that never ends
 * fails its test instead of hanging it. */
const within = <T,>(promise: Promise<T>, ms = 500) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("still pending")), ms))]);

describe("createPriorityQueue", () => {
  test("runs a task and hands back what it returned", async () => {
    const queue = createPriorityQueue(2, NO_HURRY);

    expect(await queue.run(0, () => Promise.resolve("bytes")).result).toBe("bytes");
  });

  test("a task that throws rejects its own caller", async () => {
    const queue = createPriorityQueue(2, NO_HURRY);

    await expect(queue.run(0, () => Promise.reject(new Error("forbidden"))).result).rejects.toThrow("forbidden");
  });

  test("never holds more than the limit open at once", async () => {
    const queue = createPriorityQueue(2, NO_HURRY);
    const held = [deferred(), deferred(), deferred(), deferred()];
    let started = 0;

    for (const one of held) {
      queue.run(0, () => { started++; return one.promise; }).result.catch(() => {});
    }
    await settle();
    expect(started).toBe(2);

    held[0].resolve();
    await settle();
    expect(started).toBe(3);
  });

  test("the highest priority of a batch goes first, whatever order it was queued in", async () => {
    const queue = createPriorityQueue(2, NO_HURRY);
    const started: number[] = [];
    const held = deferred();

    // Queued oldest Message first, the way a conversation mounts its photos.
    for (const priority of [0, 1, 2, 3]) {
      queue.run(priority, () => { started.push(priority); return held.promise; }).result.catch(() => {});
    }
    await settle();

    expect(started).toEqual([3, 2]);
  });

  test("clearing drops what is still waiting, and it never starts", async () => {
    // Sign-out: the Identity those photos belong to is gone, so a task that
    // has not started must never run — it would fetch, and look in a cache,
    // for someone no longer here (#39).
    const queue = createPriorityQueue(1, NO_HURRY);
    const started: number[] = [];
    const held = deferred();

    queue.run(1, () => { started.push(1); return held.promise; }).result.catch(() => {});
    const dropped = queue.run(0, () => { started.push(0); return Promise.resolve(); }).result;
    dropped.catch(() => {}); // the drop rejects it synchronously below
    await settle(); // the first one is running by now; the second is still waiting

    queue.clear();
    await settle();

    expect(started).toEqual([1]);
    await expect(dropped).rejects.toThrow(/signed out/i);
  });

  test("clearing lets later work through again", async () => {
    // The next Identity to sign in on this browser queues its own photos.
    const queue = createPriorityQueue(1, NO_HURRY);
    queue.clear();

    expect(await queue.run(0, () => Promise.resolve("bytes")).result).toBe("bytes");
  });

  test("a batch larger than the limit runs to the last one, rejections included", async () => {
    // What waiting for a conversation's photos relies on (#39's smoke): the
    // newest ones on screen do not mean the rest were dropped — every task
    // still gets its slot, and one that fails does not strand the queue.
    const queue = createPriorityQueue(2, NO_HURRY);
    const started: number[] = [];

    const all = [0, 1, 2, 3, 4, 5, 6].map((n) =>
      queue.run(n, () => { started.push(n); return n % 3 === 0 ? Promise.reject(new Error("forbidden")) : Promise.resolve(); }).result,
    );
    await Promise.allSettled(all);

    expect([...started].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test("a task that never ends holds only its own slot", async () => {
    const queue = createPriorityQueue(2, NO_HURRY);
    const started: number[] = [];
    const hung = deferred();
    const failed = deferred();
    const newest = deferred();

    queue.run(0, () => { started.push(0); return hung.promise; }).result.catch(() => {});
    queue.run(1, () => { started.push(1); return failed.promise; }).result.catch(() => {});
    queue.run(2, () => { started.push(2); return newest.promise; }).result.catch(() => {});
    await settle();
    expect(started).toEqual([2, 1]);

    failed.reject(new Error("forbidden"));
    await settle();

    // The one still waiting takes the freed slot; the hung one blocks nobody but itself.
    expect(started).toEqual([2, 1, 0]);
  });

  test("a queue full of tasks that never end moves again once their deadline passes", async () => {
    // #188: blobs that never answer took every slot, and no photo downloaded for the rest of the
    // session. The deadline frees the slot even from a task that ignores its signal.
    const queue = createPriorityQueue(2, 20);
    const never = () => new Promise<void>(() => {});
    const first = queue.run(0, never).result;
    const second = queue.run(0, never).result;
    let started = false;
    const third = queue.run(0, async () => { started = true; });

    await settle();
    expect(started).toBe(false);

    for (const hung of [first, second]) {
      const error = await within(hung).catch((reason: Error) => reason);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/took too long/i);
    }
    await within(third.result);
    expect(started).toBe(true);
  });

  test("a task past its deadline sees its signal abort", async () => {
    // So a fetch that honours the signal stops holding the connection too.
    const queue = createPriorityQueue(1, 20);
    let seen: AbortSignal | undefined;
    const hung = queue.run(0, (signal) => { seen = signal; return new Promise<void>(() => {}); }).result;

    await expect(within(hung)).rejects.toThrow(/took too long/i);
    expect(seen?.aborted).toBe(true);
  });

  test("a cancelled task leaves the waiting line and never takes a slot", async () => {
    // #188: switching conversations left the old one's photos queued ahead of the new one's.
    const queue = createPriorityQueue(1, NO_HURRY);
    const started: number[] = [];
    const held = deferred();

    queue.run(2, () => { started.push(2); return held.promise; }).result.catch(() => {});
    const cancelled = queue.run(1, () => { started.push(1); return Promise.resolve(); });
    cancelled.result.catch(() => {});
    const next = queue.run(0, () => { started.push(0); return Promise.resolve(); }).result;
    await settle();

    cancelled.cancel();
    held.resolve();
    await within(next);

    expect(started).toEqual([2, 0]);
    await expect(cancelled.result).rejects.toThrow();
  });

  test("cancelling a running task aborts it and frees its slot", async () => {
    const queue = createPriorityQueue(1, NO_HURRY);
    let seen: AbortSignal | undefined;
    const running = queue.run(1, (signal) => { seen = signal; return new Promise<void>(() => {}); });
    running.result.catch(() => {});
    let started = false;
    const next = queue.run(0, async () => { started = true; }).result;
    await settle();

    running.cancel();
    await within(next).catch(() => {});

    expect(seen?.aborted).toBe(true);
    expect(started).toBe(true);
  });

  test("clearing aborts what is already running, not only what waits", async () => {
    // Sign-out (#182's follow-up): a download in flight belongs to the Identity that is leaving.
    const queue = createPriorityQueue(1, NO_HURRY);
    let seen: AbortSignal | undefined;
    const running = queue.run(0, (signal) => { seen = signal; return new Promise<void>(() => {}); }).result;
    await settle();

    queue.clear();

    expect(seen?.aborted).toBe(true);
    await expect(within(running)).rejects.toThrow(/signed out/i);
  });
});
