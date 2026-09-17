import { describe, expect, test } from "bun:test";
import { DM_ENCRYPTION_NOTICE, channelComposerPlaceholder, dmComposerPlaceholder } from "./conversationCopy";

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
