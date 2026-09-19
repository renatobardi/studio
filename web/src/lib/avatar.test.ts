import { describe, expect, test } from "bun:test";
import { avatarFace, emojiFontSize } from "./avatar";

/** #163: kind 0's `picture` holds either an image URL or, from Studio's own avatar picker, a
 * single emoji — and other Nostr clients may put anything there. */
describe("avatarFace", () => {
  test("an http(s) URL is an image", () => {
    expect(avatarFace("https://media.example/ana.png")).toEqual({ kind: "image", src: "https://media.example/ana.png" });
    expect(avatarFace("http://media.example/ana.png")).toEqual({ kind: "image", src: "http://media.example/ana.png" });
  });

  test("a path on this origin is an image", () => {
    expect(avatarFace("/media/ana.png")).toEqual({ kind: "image", src: "/media/ana.png" });
  });

  test("a single emoji is drawn as that emoji", () => {
    expect(avatarFace("🌸")).toEqual({ kind: "emoji", emoji: "🌸" });
  });

  test("an emoji built from several code points still counts as one", () => {
    // Flags, skin tones and ZWJ sequences are one glyph on screen.
    expect(avatarFace("👩🏽‍💻")).toEqual({ kind: "emoji", emoji: "👩🏽‍💻" });
  });

  test("anything else another client left there falls back to the initials", () => {
    expect(avatarFace("ana.png")).toEqual({ kind: "initials" });
    expect(avatarFace("🌸🌸")).toEqual({ kind: "initials" });
    expect(avatarFace("a")).toEqual({ kind: "initials" });
  });

  test("no picture is the initials", () => {
    expect(avatarFace(undefined)).toEqual({ kind: "initials" });
    expect(avatarFace("")).toEqual({ kind: "initials" });
  });
});

describe("emojiFontSize", () => {
  test("keeps the onboarding picker's proportion — a 64px emoji in a 152px circle", () => {
    expect(emojiFontSize(152)).toBe(64);
    expect(emojiFontSize(32)).toBe(13);
    expect(emojiFontSize(24)).toBe(10);
  });
});
