import { describe, expect, it } from "vitest";
import {
  buildTranscriptDisplayItems,
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
      resultSourceMessageId: "t1",
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
      resultSourceMessageId: "t1",
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
      resultSourceMessageId: "t1",
    });
    expect(blocks[1]).toMatchObject({
      kind: "tool",
      toolName: "read",
      toolArgs: { path: "b.txt" },
      resultText: "B",
      resultSourceMessageId: "t2",
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

  it("merges initial model and thinking entries into one session event row", () => {
    const items = buildTranscriptDisplayItems([
      {
        id: "m1",
        role: "system",
        content: [
          {
            type: "model_change",
            provider: "openai",
            modelId: "gpt-5.4",
          },
        ],
      },
      {
        id: "m2",
        role: "system",
        content: [
          {
            type: "thinking_level_change",
            thinkingLevel: "xhigh",
          },
        ],
      },
      {
        id: "u1",
        role: "user",
        content: "Inspect terminal-log-view.ts",
      },
    ]);

    expect(items).toEqual([
      {
        kind: "session_event",
        key: "session-event:m1-m2",
        label: "Session configured",
        model: { provider: "openai", id: "gpt-5.4" },
        thinkingLevel: "xhigh",
        sourceMessageIds: ["m1", "m2"],
      },
      {
        kind: "message",
        message: {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        messageIndex: 2,
      },
    ]);
  });

  it("merges mid-session config changes into a compact event row", () => {
    const items = buildTranscriptDisplayItems([
      {
        id: "u1",
        role: "user",
        content: "Inspect terminal-log-view.ts",
      },
      {
        id: "m1",
        role: "system",
        content: [
          {
            type: "model_change",
            provider: "openai",
            modelId: "gpt-5.5",
          },
        ],
      },
      {
        id: "m2",
        role: "system",
        content: [
          {
            type: "thinking_level_change",
            thinkingLevel: "high",
          },
        ],
      },
      {
        id: "a1",
        role: "assistant",
        content: "Continuing with a higher reasoning level.",
      },
    ]);

    expect(items).toEqual([
      {
        kind: "message",
        message: {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        messageIndex: 0,
      },
      {
        kind: "session_event",
        key: "session-event:m1-m2",
        label: "Settings changed",
        model: { provider: "openai", id: "gpt-5.5" },
        thinkingLevel: "high",
        sourceMessageIds: ["m1", "m2"],
      },
      {
        kind: "message",
        message: {
          id: "a1",
          role: "assistant",
          content: "Continuing with a higher reasoning level.",
        },
        messageIndex: 3,
      },
    ]);
  });

  it("appends a pending config event when the transcript has not caught up yet", () => {
    const items = buildTranscriptDisplayItems(
      [
        {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
      ],
      {
        pendingSessionEvent: {
          key: "pending:1",
          thinkingLevel: "high",
        },
      },
    );

    expect(items).toEqual([
      {
        kind: "message",
        message: {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        messageIndex: 0,
      },
      {
        kind: "session_event",
        key: "pending:1",
        label: "Thinking changed",
        thinkingLevel: "high",
        sourceMessageIds: [],
      },
    ]);
  });

  it("anchors a pending session-start config event before later messages", () => {
    const items = buildTranscriptDisplayItems(
      [
        {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        {
          id: "a1",
          role: "assistant",
          content: "I will inspect it.",
        },
      ],
      {
        pendingSessionEvent: {
          key: "pending:1",
          thinkingLevel: "high",
          insertAfterMessageKey: null,
        },
      },
    );

    expect(items).toEqual([
      {
        kind: "session_event",
        key: "pending:1",
        label: "Session configured",
        thinkingLevel: "high",
        sourceMessageIds: [],
      },
      {
        kind: "message",
        message: {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        messageIndex: 0,
      },
      {
        kind: "message",
        message: {
          id: "a1",
          role: "assistant",
          content: "I will inspect it.",
        },
        messageIndex: 1,
      },
    ]);
  });

  it("anchors a pending mid-session config event after the captured message", () => {
    const items = buildTranscriptDisplayItems(
      [
        {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        {
          id: "a1",
          role: "assistant",
          content: "I will inspect it.",
        },
      ],
      {
        pendingSessionEvent: {
          key: "pending:1",
          thinkingLevel: "high",
          insertAfterMessageKey: "u1",
        },
      },
    );

    expect(items).toEqual([
      {
        kind: "message",
        message: {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        messageIndex: 0,
      },
      {
        kind: "session_event",
        key: "pending:1",
        label: "Thinking changed",
        thinkingLevel: "high",
        sourceMessageIds: [],
      },
      {
        kind: "message",
        message: {
          id: "a1",
          role: "assistant",
          content: "I will inspect it.",
        },
        messageIndex: 1,
      },
    ]);
  });

  it("does not duplicate a pending config event once the transcript reflects it", () => {
    const items = buildTranscriptDisplayItems(
      [
        {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        {
          id: "m1",
          role: "system",
          content: [
            {
              type: "thinking_level_change",
              thinkingLevel: "high",
            },
          ],
        },
      ],
      {
        pendingSessionEvent: {
          key: "pending:1",
          thinkingLevel: "high",
          insertAfterMessageKey: "u1",
        },
      },
    );

    expect(items).toEqual([
      {
        kind: "message",
        message: {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        messageIndex: 0,
      },
      {
        kind: "session_event",
        key: "session-event:m1",
        label: "Thinking changed",
        thinkingLevel: "high",
        sourceMessageIds: ["m1"],
      },
    ]);
  });

  it("hides session title metadata from transcript rendering", () => {
    const sessionInfoMessage = {
      id: "s1",
      role: "system",
      content: [{ type: "session_info", name: "Inspect terminal-log-view.ts" }],
    } satisfies TranscriptEntryLike;

    expect(messageContent(sessionInfoMessage)).toBe("");
    expect(contentBlocks(sessionInfoMessage)).toEqual([]);
    expect(
      buildTranscriptDisplayItems([
        {
          id: "m1",
          role: "system",
          content: [
            {
              type: "model_change",
              provider: "openai",
              modelId: "gpt-5.5",
            },
          ],
        },
        sessionInfoMessage,
        {
          id: "m2",
          role: "system",
          content: [
            {
              type: "thinking_level_change",
              thinkingLevel: "high",
            },
          ],
        },
        {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
      ]),
    ).toEqual([
      {
        kind: "session_event",
        key: "session-event:m1-m2",
        label: "Session configured",
        model: { provider: "openai", id: "gpt-5.5" },
        thinkingLevel: "high",
        sourceMessageIds: ["m1", "m2"],
      },
      {
        kind: "message",
        message: {
          id: "u1",
          role: "user",
          content: "Inspect terminal-log-view.ts",
        },
        messageIndex: 3,
      },
    ]);
  });

  it("parses compact and other system entries into structured transcript blocks", () => {
    const compactionMessage = {
      role: "system",
      content: [
        {
          type: "compaction",
          summary: "- Preserved the current task\n- Kept pending follow-ups",
          tokensBefore: 15420,
        },
      ],
    } satisfies TranscriptEntryLike;

    const modelChangeMessage = {
      role: "system",
      content: [
        {
          type: "model_change",
          provider: "openai",
          modelId: "gpt-5",
        },
      ],
    } satisfies TranscriptEntryLike;

    expect(messageContent(compactionMessage)).toBe(
      "Context compacted\n- Preserved the current task\n- Kept pending follow-ups",
    );
    expect(contentBlocks(compactionMessage)).toEqual([
      {
        kind: "system",
        systemType: "compaction",
        label: "Compaction",
        title: "Context compacted",
        body: "- Preserved the current task\n- Kept pending follow-ups",
        meta: "15.4k tokens",
      },
    ]);
    expect(contentBlocks(modelChangeMessage)).toEqual([
      {
        kind: "system",
        systemType: "model_change",
        label: "Model",
        title: "gpt-5",
        meta: "openai",
      },
    ]);
  });
});
