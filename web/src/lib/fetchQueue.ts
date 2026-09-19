export interface Queued<T> {
  result: Promise<T>;
  cancel: () => void;
}

interface Entry {
  priority: number;
  controller: AbortController;
  start: () => void;
  drop: (reason: Error) => void;
}

const SIGNED_OUT = "Signed out before this could be fetched.";

/**
 * Runs tasks a few at a time, highest priority first.
 *
 * A conversation mounts every photo of its whole history at once, and a browser gives an origin
 * only a handful of connections: with no order among them, the oldest Messages take them all and
 * the photo that just arrived waits behind a history that only grows (#142). Priority is what
 * decides which ones get a connection — the newest Message's, here.
 *
 * `clear` drops everything still waiting and aborts what is running: on sign-out the Identity
 * those photos belong to is gone, and a task that has not started must never start. `cancel`
 * does the same for one item — a photo nobody is looking at any more (#188).
 *
 * The drain runs on a microtask so a whole batch is queued before the first task starts: React
 * runs the effects that queue it in one commit, so without that wait the first four to mount
 * would win the slots regardless of their priority. Each task gets `deadlineMs`: past it, its
 * signal aborts and its slot is freed whether or not the task noticed — a blob that never
 * answers must not hold a connection for the rest of the session (#188).
 */
export function createPriorityQueue(limit: number, deadlineMs: number) {
  const waiting: Entry[] = [];
  const running = new Set<Entry>();
  let scheduled = false;

  const drain = () => {
    scheduled = false;
    waiting.sort((a, b) => b.priority - a.priority);
    while (running.size < limit && waiting.length > 0) {
      const next = waiting.shift()!;
      running.add(next);
      next.start();
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(drain);
  };

  const release = (entry: Entry) => {
    if (running.delete(entry)) schedule();
  };

  const stop = (entry: Entry, reason: Error) => {
    const index = waiting.indexOf(entry);
    if (index >= 0) {
      waiting.splice(index, 1);
      entry.drop(reason);
    } else {
      entry.controller.abort(reason);
    }
  };

  return {
    run<T>(priority: number, task: (signal: AbortSignal) => Promise<T>): Queued<T> {
      const controller = new AbortController();
      let entry!: Entry;
      const result = new Promise<T>((resolve, reject) => {
        entry = {
          priority,
          controller,
          start: () => {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(deadlineMs)]);
            signal.addEventListener("abort", () => {
              reject(controller.signal.aborted ? controller.signal.reason : new Error("Couldn't load the image — it took too long."));
              release(entry);
            });
            task(signal).then(resolve, reject).finally(() => release(entry));
          },
          drop: reject,
        };
        waiting.push(entry);
        schedule();
      });
      return { result, cancel: () => stop(entry, new Error("No longer needed.")) };
    },

    clear(): void {
      for (const entry of [...waiting, ...running]) stop(entry, new Error(SIGNED_OUT));
    },
  };
}
