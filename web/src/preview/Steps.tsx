import { useEffect } from "react";

export type Step = { click: string } | { type: [selector: string, text: string] };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function find(selector: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const element = selector.startsWith("text=")
      ? [...document.querySelectorAll<HTMLElement>("button, a")].find((el) => el.textContent?.trim() === selector.slice(5))
      : document.querySelector<HTMLElement>(selector);
    if (element) return element;
    await wait(50);
  }
  throw new Error(`preview: nothing matched ${selector}`);
}

export function Steps({ steps }: Readonly<{ steps: Step[] }>) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const step of steps) {
        if (cancelled) return;
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
      document.documentElement.dataset.previewReady = "true";
    })();
    return () => {
      cancelled = true;
    };
  }, [steps]);
  return null;
}
