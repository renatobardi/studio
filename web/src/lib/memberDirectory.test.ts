import { describe, expect, test } from "bun:test";
import { addableMembers, channelMemberGroups, selectableMembers } from "./memberDirectory";

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

describe("channelMemberGroups", () => {
  const workspace = [
    { pubkey: "o", role: "owner" },
    { pubkey: "w", role: "admin" },
    { pubkey: "m", role: "member" },
    { pubkey: "g", role: "agent" },
  ];

  test("labels each Channel Member with the role that lets them manage it, in roster order", () => {
    expect(channelMemberGroups(["m", "o", "w"], workspace, []).people).toEqual([
      { pubkey: "m", role: "Member" },
      { pubkey: "o", role: "Owner" },
      { pubkey: "w", role: "Admin" },
    ]);
  });

  test("a Channel admin (kind 39001) is an Admin even without a Workspace role", () => {
    expect(channelMemberGroups(["m"], workspace, ["m"]).people).toEqual([{ pubkey: "m", role: "Admin" }]);
  });

  test("the Workspace owner stays Owner when also a Channel admin", () => {
    expect(channelMemberGroups(["o"], workspace, ["o"]).people).toEqual([{ pubkey: "o", role: "Owner" }]);
  });

  test("agents get their own group; none means an empty one", () => {
    expect(channelMemberGroups(["g", "m"], workspace, [])).toEqual({
      people: [{ pubkey: "m", role: "Member" }],
      agents: [{ pubkey: "g", role: "Agent" }],
    });
    expect(channelMemberGroups(["m"], workspace, []).agents).toEqual([]);
  });

  test("someone the Workspace list has not reached yet reads as a Member", () => {
    expect(channelMemberGroups(["x"], workspace, []).people).toEqual([{ pubkey: "x", role: "Member" }]);
  });
});

describe("addableMembers", () => {
  const members = [
    { pubkey: "a", role: "member" },
    { pubkey: "b", role: "admin" },
    { pubkey: "c", role: "agent" },
  ];

  test("offers Workspace Members not yet in the Channel whose name matches, by name", () => {
    expect(addableMembers(members, ["b"], "o", nameOf)).toEqual([
      { pubkey: "c", role: "agent" },
      { pubkey: "a", role: "member" },
    ]);
  });

  test("matches case-insensitively and ignores surrounding spaces", () => {
    expect(addableMembers(members, [], "  ZO ", nameOf)).toEqual([{ pubkey: "a", role: "member" }]);
  });

  test("offers nobody until something is typed", () => {
    expect(addableMembers(members, [], " ", nameOf)).toEqual([]);
  });

  test("a nameless Member cannot be found by name", () => {
    expect(addableMembers([{ pubkey: "d", role: "member" }], [], "d", nameOf)).toEqual([]);
  });
});
