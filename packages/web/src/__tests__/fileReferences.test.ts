import { describe, expect, it } from "vitest";
import { parseInlineFileReference } from "../utils/fileReferences";

describe("parseInlineFileReference", () => {
  it("parses workspace-relative references", () => {
    expect(parseInlineFileReference("packages/web/src/App.vue:42")).toEqual({
      path: "packages/web/src/App.vue",
      lineNumber: 42,
      columnNumber: undefined,
    });
  });

  it("parses optional columns and preserves absolute paths", () => {
    expect(parseInlineFileReference("/tmp/example.ts:12:8")).toEqual({
      path: "/tmp/example.ts",
      lineNumber: 12,
      columnNumber: 8,
    });
    expect(parseInlineFileReference("C:\\repo\\main.rs:9:2")).toEqual({
      path: "C:\\repo\\main.rs",
      lineNumber: 9,
      columnNumber: 2,
    });
  });

  it("supports config-style file names", () => {
    expect(parseInlineFileReference("Dockerfile:3")).toEqual({
      path: "Dockerfile",
      lineNumber: 3,
      columnNumber: undefined,
    });
    expect(parseInlineFileReference("README:7")).toEqual({
      path: "README",
      lineNumber: 7,
      columnNumber: undefined,
    });
  });

  it("rejects non-file tokens and invalid line numbers", () => {
    expect(parseInlineFileReference("token:7")).toBeNull();
    expect(parseInlineFileReference("not a path")).toBeNull();
    expect(parseInlineFileReference("src/App.vue:0")).toBeNull();
  });
});
