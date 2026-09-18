import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Signer } from "../../lib/custody";
import type { DmAttachment } from "../../lib/dmMedia";
import { DmAttachmentImage } from "./DmAttachmentImage";

const attachment: DmAttachment = {
  url: "http://media.example/media/" + "a".repeat(64),
  sha256: "a".repeat(64),
  size: 1024,
  originalMime: "image/png",
  key: "b".repeat(64),
};

/** Nothing here reaches the network: a first paint happens before any download does. */
const signer = {} as Signer;

describe("DmAttachmentImage", () => {
  test("holds the photo's place until its bytes are decrypted", () => {
    const html = renderToStaticMarkup(<DmAttachmentImage attachment={attachment} signer={signer} priority={0} />);

    expect(html).toContain('data-testid="dm-attachment-loading"');
    expect(html).not.toContain('data-testid="dm-attachment-image"');
  });
});
