import { describe, expect, it } from "vitest";
import {
  createComposerAttachments,
  extractSupportedImageFiles,
  getSupportedImageMimeType,
  toRpcImageContent,
} from "../utils/attachments";

describe("attachments helpers", () => {
  it("creates composer attachments with inline previews", async () => {
    const file = new File([Uint8Array.from([104, 101, 108, 108, 111])], "shot.png", {
      type: "image/png",
    });

    const { attachments, rejectedNames } = await createComposerAttachments([
      file,
    ]);

    expect(rejectedNames).toEqual([]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      type: "image",
      name: "shot.png",
      mimeType: "image/png",
      data: "aGVsbG8=",
      previewUrl: "data:image/png;base64,aGVsbG8=",
    });
    expect(toRpcImageContent(attachments)).toEqual([
      {
        type: "image",
        mimeType: "image/png",
        data: "aGVsbG8=",
      },
    ]);
  });

  it("falls back to the file extension when the mime type is missing", () => {
    const file = new File([""], "photo.webp", { type: "" });
    expect(getSupportedImageMimeType(file)).toBe("image/webp");
  });

  it("filters unsupported files from dropped payloads", () => {
    const files = [
      new File(["ok"], "good.gif", { type: "image/gif" }),
      new File(["bad"], "notes.txt", { type: "text/plain" }),
    ];

    expect(extractSupportedImageFiles(files)).toEqual([files[0]]);
  });
});
