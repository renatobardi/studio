import { describe, expect, test } from "bun:test";
import {
  DM_ENCRYPTION_NOTICE,
  DM_LOOKING_FOR_OLDER,
  DM_NOTHING_FOUND_YET,
  channelComposerPlaceholder,
  dmComposerPlaceholder,
  dmEmptyNotice,
} from "./conversationCopy";

/** The prototype's conversation copy (#153): the composer names where the Message goes, and the
 * Direct Message timeline opens with the relay notice. */
describe("conversationCopy", () => {
  test("a Channel composer names the Channel with its #", () => {
    expect(channelComposerPlaceholder("eng-platform")).toBe("Message #eng-platform");
  });
  test("a Direct Message composer names the person", () => {
    expect(dmComposerPlaceholder("Ana Petrova")).toBe("Message Ana Petrova");
  });
  test("the encryption notice is the prototype's sentence", () => {
    expect(DM_ENCRYPTION_NOTICE).toBe("Direct messages are end-to-end encrypted on this relay.");
  });
});

describe("dmEmptyNotice", () => {
  const empty = { messages: [] as unknown[], canLoadOlder: true, fetchOlder: true };

  test("says it is looking while an opening still fetches", () => {
    expect(dmEmptyNotice(empty)).toBe(DM_LOOKING_FOR_OLDER);
  });

  test("says the opening stopped looking once it has spent its pages", () => {
    expect(dmEmptyNotice({ ...empty, fetchOlder: false })).toBe(DM_NOTHING_FOUND_YET);
  });

  test("says nothing once there are Messages on screen", () => {
    expect(dmEmptyNotice({ ...empty, messages: ["m"] })).toBeNull();
  });

  test("says nothing when there is nothing left to fetch", () => {
    expect(dmEmptyNotice({ ...empty, canLoadOlder: false, fetchOlder: false })).toBeNull();
  });
});
