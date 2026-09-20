import { afterEach, expect, test } from "bun:test";
import { stubWindow, type KeyPress } from "../../lib/testing/window";
import { listenForEscape } from "./useEscape";

type Listener = (event: KeyPress) => void;

const listeners = new Map<Listener, string>();
let restoreWindow: (() => void) | null = null;

afterEach(() => {
  listeners.clear();
  restoreWindow?.();
  restoreWindow = null;
});

/** Only the two calls this hook makes. */
const attachWindow = () => {
  restoreWindow = stubWindow({
    addEventListener: (type, listener) => void listeners.set(listener, type),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  });
};

const fire = (key: string) => {
  for (const [listener] of listeners) listener({ key });
};

test("listens for keydown while it is attached, and stops when it is detached", () => {
  attachWindow();
  const stop = listenForEscape(() => {});
  expect([...listeners.values()]).toEqual(["keydown"]);
  stop();
  expect(listeners.size).toBe(0);
});

test("only Escape dismisses — other keys go through untouched", () => {
  attachWindow();
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
