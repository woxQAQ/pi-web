import { describe, expect, it } from "vitest";
import {
  contentBlocks,
  messageContent,
  normalizeTranscript,
  type TranscriptEntryLike,
} from "../utils/transcript";

describe("normalizeTranscript", () => {
  it("merges a standalone tool result into the preceding assistant tool call", () => {
    const messages: TranscriptEntryLike[] = [
      {
        id: "a1",
        role: "assistant",
        content: [
          { type: "text", text: "Checking the workspace." },
          { type: "toolCall", name: "bash", arguments: '{"command":"pwd"}' },
        ],
      },
      {
        id: "t1",
        role: "tool",
        content: "stdout: /repo",
        isError: false,
      },
    ];

    const normalized = normalizeTranscript(messages);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].role).toBe("assistant");

    const blocks = contentBlocks(normalized[0]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      kind: "tool",
      toolName: "bash",
      toolArgs: { command: "pwd" },
      argumentsText: '{"command":"pwd"}',
      resultText: "stdout: /repo",
      toolStatus: "success",
    });
  });

  it("preserves tool result details when merging tool messages", () => {
    const diff = "--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new";
    const messages: TranscriptEntryLike[] = [
      {
        id: "a1",
        role: "assistant",
        content: [
          { type: "toolCall", name: "edit", arguments: '{"path":"a.ts"}' },
        ],
      },
      {
        id: "t1",
        role: "tool",
        content: "Successfully replaced 1 block(s) in a.ts.",
        details: { diff },
        isError: false,
      },
    ];

    const normalized = normalizeTranscript(messages);
    const blocks = contentBlocks(normalized[0]);
    expect(blocks[0]).toMatchObject({
      kind: "tool",
      toolName: "edit",
      resultText: "Successfully replaced 1 block(s) in a.ts.",
      resultDetails: { diff },
    });
  });

  it("pairs tool results with tool calls in execution order", () => {
    const messages: TranscriptEntryLike[] = [
      {
        id: "a1",
        role: "assistant",
        content: [
          { type: "toolCall", name: "read", arguments: '{"path":"a.txt"}' },
          { type: "toolCall", name: "read", arguments: '{"path":"b.txt"}' },
        ],
      },
      { id: "t1", role: "tool", content: "A", isError: false },
      { id: "t2", role: "tool", content: "B", isError: false },
    ];

    const normalized = normalizeTranscript(messages);
    const blocks = contentBlocks(normalized[0]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: "tool",
      toolName: "read",
      toolArgs: { path: "a.txt" },
      resultText: "A",
    });
    expect(blocks[1]).toMatchObject({
      kind: "tool",
      toolName: "read",
      toolArgs: { path: "b.txt" },
      resultText: "B",
    });
  });

  it("leaves unmatched tool results as standalone messages", () => {
    const messages: TranscriptEntryLike[] = [
      { id: "u1", role: "user", content: "hello" },
      { id: "t1", role: "tool", content: "orphan result" },
    ];

    const normalized = normalizeTranscript(messages);
    expect(normalized).toHaveLength(2);
    expect(normalized[1]).toMatchObject({
      id: "t1",
      role: "tool",
      content: "orphan result",
    });
  });

  it("does not mutate the original transcript array", () => {
    const assistant = {
      id: "a1",
      role: "assistant",
      content: [
        { type: "toolCall", name: "bash", arguments: '{"command":"ls"}' },
      ],
    } satisfies TranscriptEntryLike;
    const tool = {
      id: "t1",
      role: "tool",
      content: "file.txt",
    } satisfies TranscriptEntryLike;

    const normalized = normalizeTranscript([assistant, tool]);
    expect(normalized[0]).not.toBe(assistant);
    expect(normalized[0].content).not.toBe(assistant.content);
    expect(assistant.content).toEqual([
      { type: "toolCall", name: "bash", arguments: '{"command":"ls"}' },
    ]);
  });

  it("marks tool blocks as pending until a result arrives", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          name: "write",
          arguments: '{"path":"note.txt","content":"hello"}',
        },
      ],
    } satisfies TranscriptEntryLike;

    expect(contentBlocks(message)).toEqual([
      {
        kind: "tool",
        toolName: "write",
        toolArgs: { path: "note.txt", content: "hello" },
        argumentsText: '{"path":"note.txt","content":"hello"}',
        toolStatus: "pending",
      },
    ]);
  });

  it("uses tool result isError when merging failed edit replacements", () => {
    const normalized = normalizeTranscript([
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            name: "edit",
            arguments:
              '{"path":"src/app.ts","edits":[{"oldText":"a","newText":"b"}]}',
          },
        ],
      },
      {
        role: "tool",
        content: "Could not find the exact text to replace in src/app.ts.",
        isError: true,
      },
    ]);

    expect(contentBlocks(normalized[0])).toEqual([
      expect.objectContaining({
        kind: "tool",
        toolName: "edit",
        toolStatus: "error",
        resultText: "Could not find the exact text to replace in src/app.ts.",
      }),
    ]);
  });

  it("preserves image tool results when merging them into tool calls", () => {
    const normalized = normalizeTranscript([
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            name: "read",
            arguments: '{"path":"assets/logo.png"}',
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "image",
            mimeType: "image/png",
            data: "aGVsbG8=",
          },
        ],
        isError: false,
      },
    ]);

    expect(contentBlocks(normalized[0])).toEqual([
      {
        kind: "tool",
        toolName: "read",
        toolArgs: { path: "assets/logo.png" },
        argumentsText: '{"path":"assets/logo.png"}',
        resultText: "",
        resultBlocks: [
          {
            kind: "image",
            src: "data:image/png;base64,aGVsbG8=",
            alt: "Image attachment",
            mimeType: "image/png",
          },
        ],
        toolStatus: "success",
      },
    ]);
  });

  it("exposes standalone tool result images in transcript blocks", () => {
    const message = {
      role: "tool",
      content: [
        {
          type: "image",
          mimeType: "image/webp",
          data: "d29ybGQ=",
        },
      ],
    } satisfies TranscriptEntryLike;

    expect(contentBlocks(message)).toEqual([
      {
        kind: "image",
        src: "data:image/webp;base64,d29ybGQ=",
        alt: "Image attachment",
        mimeType: "image/webp",
      },
    ]);
  });

  it("drops empty thinking blocks from assistant content", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "Working on it." },
        { type: "thinking", thinking: "   " },
        { type: "thinking", thinking: "Need to inspect the log first." },
      ],
    } satisfies TranscriptEntryLike;

    expect(messageContent(message)).toBe("Working on it.");
    expect(contentBlocks(message)).toEqual([
      { kind: "text", text: "Working on it." },
      { kind: "thinking", text: "Need to inspect the log first." },
    ]);
  });

  it("exposes inline image blocks with browser-safe data urls", () => {
    const message = {
      role: "user",
      content: [
        { type: "text", text: "Please inspect this screenshot." },
        {
          type: "image",
          mimeType: "image/png",
          data: "aGVsbG8=",
        },
      ],
    } satisfies TranscriptEntryLike;

    expect(contentBlocks(message)).toEqual([
      { kind: "text", text: "Please inspect this screenshot." },
      {
        kind: "image",
        src: "data:image/png;base64,aGVsbG8=",
        alt: "Image attachment",
        mimeType: "image/png",
      },
    ]);
  });
});
