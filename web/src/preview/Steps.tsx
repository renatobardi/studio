import { useEffect } from "react";

export type Step = { click: string } | { type: [selector: string, text: string] } | { waitFor: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long one step looks for its element: fixed, not scaled to the machine — which is exactly
 * what runs out on a starved one (#227). Named in the failure, so it is never mistaken for
 * Playwright's own timeout. */
const FIND_TRIES = 50;
const FIND_EVERY_MS = 50;

async function find(selector: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < FIND_TRIES; attempt++) {
    const element = selector.startsWith("text=")
      ? [...document.querySelectorAll<HTMLElement>("button, a")].find((el) => el.textContent?.trim() === selector.slice(5))
      : document.querySelector<HTMLElement>(selector);
    if (element) return element;
    await wait(FIND_EVERY_MS);
  }
  throw new Error(`preview: nothing matched ${selector} within ${(FIND_TRIES * FIND_EVERY_MS) / 1000} s`);
}

export function Steps({ steps }: Readonly<{ steps: Step[] }>) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const step of steps) {
        if (cancelled) return;
        if ("waitFor" in step) {
          // A click's handler may still be awaiting (encrypting a backup, linking an Identity):
          // the next screen is what says it finished.
          await find(step.waitFor);
          continue;
        }
        const target = await find("click" in step ? step.click : step.type[0]);
        // StrictMode runs this effect twice; a click that lands after the first run was
        // cancelled would toggle the pane it just opened.
        if (cancelled) return;
        if ("click" in step) target.click();
        else {
          const input = target as HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          setter.call(input, step.type[1]);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await wait(100);
      }
      // A run StrictMode cancelled must not say ready for the one still going: the spec reads
      // ready and failed as one or the other.
      if (cancelled) return;
      document.documentElement.dataset.previewReady = "true";
    })().catch((error: unknown) => {
      // Uncaught, a step that gave up was a rejection nobody heard: `previewReady` never came, and
      // flow 10 waited its whole 30 s on a selector with nothing saying why (#227). The spec
      // waits for either, and fails at once with this.
      if (cancelled) return;
      document.documentElement.dataset.previewFailed = error instanceof Error ? error.message : String(error);
    });
    return () => {
      cancelled = true;
    };
  }, [steps]);
  return null;
}
