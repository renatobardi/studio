import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { KeyPress } from "../../lib/testing/window";
import { listenForEscape } from "./useEscape";

type Listener = (event: KeyPress) => void;

const listeners = new Map<Listener, string>();

afterEach(() => {
  listeners.clear();
  mock.restore();
});

/** Only the two calls this hook makes, on the window the harness provides (#94) — what is
 * asserted is that the hook attaches and detaches, not what the browser does with it. */
const attachWindow = () => {
  spyOn(window, "addEventListener").mockImplementation(((type: string, listener: Listener) => {
    listeners.set(listener, type);
  }) as typeof window.addEventListener);
  spyOn(window, "removeEventListener").mockImplementation(((_type: string, listener: Listener) => {
    listeners.delete(listener);
  }) as typeof window.removeEventListener);
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
