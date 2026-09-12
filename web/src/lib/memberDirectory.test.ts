import { describe, expect, test } from "bun:test";
import { selectableMembers } from "./memberDirectory";

/** null is "this Member has published no kind 0 name yet". */
const nameOf = (pubkey: string) => ({ a: "Zoe", b: "Ana", c: "Mo" })[pubkey] ?? null;

describe("selectableMembers", () => {
  test("offers every other Workspace Member, by name", () => {
    const members = [
      { pubkey: "a", role: "member" },
      { pubkey: "b", role: "admin" },
      { pubkey: "c", role: "owner" },
    ];

    expect(selectableMembers(members, "c", nameOf)).toEqual([
      { pubkey: "b", role: "admin" },
      { pubkey: "a", role: "member" },
    ]);
  });

  test("never offers a conversation with yourself", () => {
    const members = [{ pubkey: "a", role: "member" }];
    expect(selectableMembers(members, "a", nameOf)).toEqual([]);
  });

  test("sorts by name case-insensitively, nameless Members last", () => {
    const members = [
      { pubkey: "d", role: "member" },
      { pubkey: "a", role: "member" },
      { pubkey: "b", role: "member" },
    ];
    expect(selectableMembers(members, "me", nameOf)).toEqual([
      { pubkey: "b", role: "member" },
      { pubkey: "a", role: "member" },
      { pubkey: "d", role: "member" },
    ]);
  });
});
