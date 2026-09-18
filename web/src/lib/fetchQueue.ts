interface Waiting {
  priority: number;
  start: () => void;
}

/**
 * Runs tasks a few at a time, highest priority first.
 *
 * A conversation mounts every photo of its whole history at once, and a browser gives an origin
 * only a handful of connections: with no order among them, the oldest Messages take them all and
 * the photo that just arrived waits behind a history that only grows (#142). Priority is what
 * decides which ones get a connection — the newest Message's, here.
 *
 * The drain runs on a microtask so a whole batch is queued before the first task starts: React
 * runs the effects that queue it in one commit, so without that wait the first four to mount
 * would win the slots regardless of their priority. A task that never settles holds its own slot
 * and nothing else.
 */
export function createPriorityQueue(limit: number) {
  const waiting: Waiting[] = [];
  let running = 0;
  let scheduled = false;

  const drain = () => {
    scheduled = false;
    waiting.sort((a, b) => b.priority - a.priority);
    while (running < limit && waiting.length > 0) {
      running++;
      waiting.shift()!.start();
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(drain);
  };

  const release = () => {
    running--;
    schedule();
  };

  return {
    run<T>(priority: number, task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push({
          priority,
          start: () => {
            task().then(resolve, reject).finally(release);
          },
        });
        schedule();
      });
    },
  };
}
