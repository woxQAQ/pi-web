import { describe, expect, it } from "vitest";
import { buildToolCardModel } from "../utils/toolBlock";
import type { ToolContentBlock } from "../utils/transcript";

describe("buildToolCardModel", () => {
  it("renders read blocks around the target path and line range", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "read",
      toolArgs: { path: "src/main.ts", offset: 10, limit: 5 },
      argumentsText: '{"path":"src/main.ts","offset":10,"limit":5}',
      resultText: "const value = 1;\nconsole.log(value);",
      toolStatus: "success",
    };

    const model = buildToolCardModel(block);
    expect(model.label).toBe("Read file");
    expect(model.title).toBe("src/main.ts:10-14");
    expect(model.preview).toContain("const value = 1;");
    expect(model.details.map(detail => detail.label)).toEqual(["Contents"]);
  });

  it("uses file content previews for successful writes", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "write",
      toolArgs: { path: "README.md", content: "# Title\n\nBody copy" },
      argumentsText: '{"path":"README.md","content":"# Title\\n\\nBody copy"}',
      resultText: "Successfully wrote 18 bytes to README.md",
      toolStatus: "success",
    };

    const model = buildToolCardModel(block);
    expect(model.title).toBe("README.md");
    expect(model.meta).toBe("3 lines");
    expect(model.preview).toBe("# Title\n\nBody copy");
    expect(model.details[0]).toEqual({
      label: "Content",
      text: "# Title\n\nBody copy",
    });
  });

  it("shows bash exit code and only previews the last lines", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "bash",
      toolArgs: { command: "pnpm test", timeout: 30 },
      argumentsText: '{"command":"pnpm test","timeout":30}',
      resultText: [
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
        "Command exited with code 2",
      ].join("\n"),
      toolStatus: "error",
    };

    const model = buildToolCardModel(block);
    expect(model.label).toBe("Run command");
    expect(model.title).toBe("pnpm test");
    expect(model.meta).toBe("exit 2 · timeout 30s");
    expect(model.preview).toBe(
      [
        "... 2 earlier lines",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
        "Command exited with code 2",
      ].join("\n"),
    );
  });

  it("renders real edit diffs directly in the preview", () => {
    const diff = [
      "--- src/app.ts",
      "+++ src/app.ts",
      "@@ -1,2 +1,3 @@",
      " const a = 1;",
      "+const b = 2;",
      "-return a;",
      "+return a + b;",
    ].join("\n");
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "edit",
      toolArgs: {
        path: "src/app.ts",
        edits: [
          { oldText: "const a = 1;", newText: "const a = 1;\nconst b = 2;" },
          { oldText: "return a;", newText: "return a + b;" },
        ],
      },
      argumentsText:
        '{"path":"src/app.ts","edits":[{"oldText":"const a = 1;","newText":"const a = 1;\\nconst b = 2;"},{"oldText":"return a;","newText":"return a + b;"}]}',
      resultText: "Successfully replaced 2 block(s) in src/app.ts.",
      resultDetails: { diff },
      toolStatus: "success",
    };

    const model = buildToolCardModel(block);
    expect(model.title).toBe("src/app.ts");
    expect(model.meta).toBeUndefined();
    expect(model.diffStats).toEqual({ added: 2, removed: 1 });
    expect(model.preview).toBe(diff);
    expect(model.details).toEqual([]);
  });

  it("hides added and removed stats when an edit does not succeed", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "edit",
      toolArgs: {
        path: "src/app.ts",
        edits: [
          { oldText: "const a = 1;", newText: "const a = 2;" },
          { oldText: "return a;", newText: "return b;" },
        ],
      },
      argumentsText:
        '{"path":"src/app.ts","edits":[{"oldText":"const a = 1;","newText":"const a = 2;"},{"oldText":"return a;","newText":"return b;"}]}',
      resultText: "Could not find the exact text to replace in src/app.ts.",
      toolStatus: "error",
    };

    const model = buildToolCardModel(block);
    expect(model.meta).toBeUndefined();
    expect(model.diffStats).toBeUndefined();
    expect(model.preview).toBe(
      "Could not find the exact text to replace in src/app.ts.",
    );
  });

  it("shows pending tool state as inline status text", () => {
    const block: ToolContentBlock = {
      kind: "tool",
      toolName: "bash",
      toolArgs: { command: "pnpm test", timeout: 30 },
      argumentsText: '{"command":"pnpm test","timeout":30}',
      toolStatus: "pending",
    };

    const model = buildToolCardModel(block);
    expect(model.label).toBe("Run command");
    expect(model.title).toBe("pnpm test");
    expect(model.meta).toBe("timeout 30s");
    expect(model.preview).toBe("Running command...");
    expect(model.details).toEqual([]);
  });
});
