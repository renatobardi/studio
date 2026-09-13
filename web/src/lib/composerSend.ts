/** One publish at a time from a composer (#105): a Send pressed again — a second click, a held
 * Enter — while the first is still signing or publishing does nothing, instead of publishing the
 * same Message twice. Keep one per composer; `run` is passed per call so it sees the current draft. */
export function createSingleFlight() {
  let inFlight = false;
  return async function once<T>(run: () => Promise<T>): Promise<T | undefined> {
    if (inFlight) return undefined;
    inFlight = true;
    try {
      return await run();
    } finally {
      inFlight = false;
    }
  };
}

/** What stays in the composer once `sent` went out: only what was typed after pressing Send, without the space that separated it. A
 * draft rewritten meanwhile is no longer what was sent, so it is kept whole. */
export function draftAfterSend(current: string, sent: string): string {
  return current.startsWith(sent) ? current.slice(sent.length).trimStart() : current;
}
