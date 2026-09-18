import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog } from "./Dialog";

const props = (onClose: () => void = () => {}) => ({
  name: "sign-out",
  title: "Sign out?",
  description: "Your key stays in this browser.",
  footer: <button>Cancel</button>,
  onClose,
  children: <p>Sign out of Studio on this device.</p>,
});

const dialog = () => <Dialog {...props()} />;

/** The backdrop carries both handlers; calling the component gives us them without a DOM, the
 * way the rest of the suite reads markup without a browser. */
const backdrop = (onClose: () => void) =>
  Dialog(props(onClose)) as ReactElement<{
    onClick: (event: { target: unknown; currentTarget: unknown }) => void;
    onKeyDown: (event: { key: string }) => void;
  }>;

describe("Dialog markup", () => {
  test("the dialog is labelled by the title its name builds, and found by the same name", () => {
    const html = renderToStaticMarkup(dialog());
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="sign-out-title"');
    expect(html).toContain('data-testid="sign-out-dialog"');
    expect(html).toContain('<h2 id="sign-out-title" class="dialog-title">Sign out?</h2>');
  });

  test("header, body and footer each carry what the caller passed", () => {
    const html = renderToStaticMarkup(dialog());
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('<p class="dialog-description">Your key stays in this browser.</p>');
    expect(html).toContain("<p>Sign out of Studio on this device.</p>");
    expect(html).toContain('<div class="dialog-footer"><button>Cancel</button></div>');
  });
});

describe("Dialog dismissal", () => {
  test("a click on the backdrop itself closes, a click that came from inside does not", () => {
    let closed = 0;
    const { onClick } = backdrop(() => closed++).props;

    const inside = {};
    onClick({ target: inside, currentTarget: {} });
    expect(closed).toBe(0);

    const itself = {};
    onClick({ target: itself, currentTarget: itself });
    expect(closed).toBe(1);
  });

  test("Escape closes from the keyboard; another key does not", () => {
    let closed = 0;
    const { onKeyDown } = backdrop(() => closed++).props;

    onKeyDown({ key: "Enter" });
    expect(closed).toBe(0);

    onKeyDown({ key: "Escape" });
    expect(closed).toBe(1);
  });
});
