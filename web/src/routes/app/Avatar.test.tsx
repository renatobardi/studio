import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "./Avatar";

/** #163: onboarding and the profile screen publish the chosen emoji in kind 0's `picture`, so the
 * avatar has to tell an emoji from an image URL — `<img src="🌸">` is a broken image. */
describe("Avatar", () => {
  test("draws an emoji picture as the emoji itself, not as a broken image", () => {
    const html = renderToStaticMarkup(<Avatar profile={{ picture: "🌸" }} name="Ana Petrova" />);
    expect(html).not.toContain("<img");
    expect(html).toContain("🌸");
  });

  test("draws a picture URL as the image", () => {
    const html = renderToStaticMarkup(<Avatar profile={{ picture: "https://media.example/ana.png" }} name="Ana Petrova" />);
    expect(html).toContain('<img class="avatar" src="https://media.example/ana.png"');
  });

  test("falls back to the initials when there is no picture", () => {
    expect(renderToStaticMarkup(<Avatar profile={undefined} name="Ana Petrova" />)).toContain(">AP<");
  });
});
