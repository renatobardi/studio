import { afterEach, expect, test } from "bun:test";
import { listenForEscape } from "./useEscape";

type Listener = (event: { key: string }) => void;

const listeners = new Map<Listener, string>();

afterEach(() => {
  listeners.clear();
  // @ts-expect-error test-only cleanup of the global stubbed below
  delete globalThis.window;
});

const stubWindow = () => {
  // @ts-expect-error minimal window stub: only the two calls this hook makes
  globalThis.window = {
    addEventListener: (type: string, listener: Listener) => listeners.set(listener, type),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
};

const fire = (key: string) => {
  for (const [listener] of listeners) listener({ key });
};

test("listens for keydown while it is attached, and stops when it is detached", () => {
  stubWindow();
  const stop = listenForEscape(() => {});
  expect([...listeners.values()]).toEqual(["keydown"]);
  stop();
  expect(listeners.size).toBe(0);
});

test("only Escape dismisses — other keys go through untouched", () => {
  stubWindow();
  let dismissed = 0;
  const stop = listenForEscape(() => dismissed++);

  fire("Enter");
  fire("Esc");
  expect(dismissed).toBe(0);

  fire("Escape");
  expect(dismissed).toBe(1);

  stop();
  fire("Escape");
  expect(dismissed).toBe(1);
});
