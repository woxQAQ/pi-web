/**
 * Unit tests for extension_ui_request handling in useBridgeClient.
 *
 * Strategy: We test the message handling by importing the composable and
 * exercising the internal handleServerMessage function via a mocked WebSocket.
 * The composable has module-level state, so we reset between tests by
 * disconnecting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global WebSocket before importing the composable
const mockWsInstances: Array<{
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  readyState: number;
}> = [];

class MockWebSocket {
  readyState = WebSocket.OPEN;
  send = vi.fn();
  close = vi.fn();
  addEventListener = vi.fn();

  constructor() {
    mockWsInstances.push(this as (typeof mockWsInstances)[number]);
  }
}

// Mock location for connect()
vi.stubGlobal("location", {
  protocol: "http:",
  host: "localhost:8080",
  search: "",
});

// Provide a minimal document mock so Vue's runtime-dom can initialize.
// Vue's runtime-dom calls doc.createElement("div") at module load time.
vi.stubGlobal("document", {
  title: "",
  createElement: () => ({
    style: {},
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
  }),
  createTextNode: () => ({}),
  createComment: () => ({}),
  querySelector: () => null,
  querySelectorAll: () => [],
  appendChild: vi.fn(),
  removeChild: vi.fn(),
  insertBefore: vi.fn(),
});

let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket;
  // @ts-expect-error mock
  globalThis.WebSocket = MockWebSocket;
  vi.stubGlobal("location", {
    protocol: "http:",
    host: "localhost:8080",
    search: "",
  });
  mockWsInstances.length = 0;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

/**
 * Helper: import a fresh module copy to get isolated state.
 * Vitest module isolation is tricky with module-level refs,
 * so we use vi.resetModules() between tests.
 */
async function importComposable() {
  const mod = await import("../composables/useBridgeClient");
  return mod.useBridgeClient();
}

function getLastMockWs() {
  return mockWsInstances[mockWsInstances.length - 1];
}

/** Simulate an incoming WebSocket message. */
function simulateMessage(ws: MockWebSocket, data: unknown) {
  const handler = ws.addEventListener.mock.calls.find(
    (c: unknown[]) => c[0] === "message",
  )?.[1] as ((ev: { data: string }) => void) | undefined;
  if (!handler) throw new Error("No message listener registered");
  handler({ data: JSON.stringify(data) });
}

/** Simulate WebSocket open event. */
function simulateOpen(ws: MockWebSocket) {
  const handler = ws.addEventListener.mock.calls.find(
    (c: unknown[]) => c[0] === "open",
  )?.[1] as (() => void) | undefined;
  if (handler) handler();
}

describe("extension_ui_request handling", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not request tree entries during initial connect", async () => {
    await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    const sentCommandTypes = ws.send.mock.calls.map(([message]: [string]) => {
      const payload = JSON.parse(message) as { payload?: { type?: string } };
      return payload.payload?.type;
    });

    expect(sentCommandTypes).toEqual(
      expect.arrayContaining([
        "get_messages",
        "get_state",
        "list_sessions",
        "get_available_models",
        "get_commands",
      ]),
    );

    // Tree data is loaded lazily when the panel is opened.
    const treeRequests = sentCommandTypes.filter(
      type => type === "list_tree_entries",
    );
    expect(treeRequests).toHaveLength(0);
  });

  it("updates tree entries from switch_session responses", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);
    ws.send.mockClear();

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "switch_session",
        success: true,
        data: {
          transcript: {
            messages: [],
            hasOlder: false,
            hasNewer: false,
          },
          treeEntries: [
            {
              id: "node-1",
              label: "user: Hello",
              type: "message",
              depth: 0,
              isActive: true,
            },
          ],
          sessionId: "session-2",
          sessionName: "Session 2",
          sessionPath: "/tmp/session-2.jsonl",
          cancelled: false,
        },
      },
    });

    expect(client.treeEntries.value).toEqual([
      {
        id: "node-1",
        label: "user: Hello",
        type: "message",
        depth: 0,
        isActive: true,
      },
    ]);
    expect(client.liveSessionPath.value).toBe("/tmp/session-2.jsonl");
    expect(client.isHistoricalView.value).toBe(false);
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"get_state"'),
    );
  });

  it("ignores stale live tree responses after switch_session", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "get_state",
        success: true,
        data: {
          sessionId: "live-session",
          sessionFile: "/tmp/live.jsonl",
          sessionName: "Live",
          thinkingLevel: "normal",
          isStreaming: false,
          isCompacting: false,
          steeringMode: "all",
          followUpMode: "all",
          autoCompactionEnabled: false,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      },
    });

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "switch_session",
        success: true,
        data: {
          transcript: {
            messages: [],
            hasOlder: false,
            hasNewer: false,
          },
          treeEntries: [
            {
              id: "session-node",
              label: "user: Switched",
              type: "message",
              depth: 0,
              isActive: true,
            },
          ],
          sessionId: "session-2",
          sessionName: "Session 2",
          sessionPath: "/tmp/session-2.jsonl",
          cancelled: false,
        },
      },
    });

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "list_tree_entries",
        success: true,
        data: {
          entries: [
            { id: "live-node", label: "user: Live", type: "message", depth: 0 },
          ],
          sessionPath: "/tmp/live.jsonl",
        },
      },
    });

    expect(client.treeEntries.value).toEqual([
      {
        id: "session-node",
        label: "user: Switched",
        type: "message",
        depth: 0,
        isActive: true,
      },
    ]);
  });

  it("tracks currentModel from state and model_select events", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "get_state",
        success: true,
        data: {
          sessionId: "session-1",
          sessionFile: "/tmp/session-1.jsonl",
          sessionName: "Session 1",
          model: { provider: "openai", id: "gpt-4.1", name: "GPT-4.1" },
          thinkingLevel: "normal",
          isStreaming: false,
          isCompacting: false,
          steeringMode: "all",
          followUpMode: "all",
          autoCompactionEnabled: false,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      },
    });

    expect(client.currentModel.value).toEqual({
      provider: "openai",
      id: "gpt-4.1",
      name: "GPT-4.1",
    });

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "model_select",
        model: {
          provider: "anthropic",
          id: "claude-sonnet-4",
          name: "Claude Sonnet 4",
        },
        source: "set",
      },
    });

    expect(client.currentModel.value).toEqual({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    });
  });

  it("stores available models and upserts new selections", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "get_available_models",
        success: true,
        data: {
          models: [
            { provider: "openai", id: "gpt-4.1", name: "GPT-4.1" },
            {
              provider: "anthropic",
              id: "claude-sonnet-4",
              name: "Claude Sonnet 4",
            },
          ],
        },
      },
    });

    expect(client.availableModels.value).toEqual([
      { provider: "openai", id: "gpt-4.1", name: "GPT-4.1" },
      { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    ]);

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "set_model",
        success: true,
        data: {
          provider: "google",
          id: "gemini-2.5-pro",
          name: "Gemini 2.5 Pro",
        },
      },
    });

    expect(client.currentModel.value).toEqual({
      provider: "google",
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
    });
    expect(client.availableModels.value).toEqual([
      { provider: "openai", id: "gpt-4.1", name: "GPT-4.1" },
      { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
      { provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ]);
  });

  it("stores expanded session stats from pushed events", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "session_stats",
        stats: {
          tokens: 272000,
          contextWindow: 272000,
          percent: 32.1,
          messageCount: 12,
          cost: 1.354,
          inputTokens: 97000,
          outputTokens: 27000,
          cacheReadTokens: 2800000,
          cacheWriteTokens: 64000,
        },
      },
    });

    expect(client.sessionStats.value).toEqual({
      tokens: 272000,
      contextWindow: 272000,
      percent: 32.1,
      messageCount: 12,
      cost: 1.354,
      inputTokens: 97000,
      outputTokens: 27000,
      cacheReadTokens: 2800000,
      cacheWriteTokens: 64000,
    });
  });

  it("normalizes invalid pushed session stats values to zero", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "session_stats",
        stats: {
          tokens: 272000,
          contextWindow: 272000,
          percent: 32.1,
          messageCount: 12,
          cost: 1.354,
          inputTokens: Number.NaN,
          outputTokens: Number.NaN,
          cacheReadTokens: Number.NaN,
          cacheWriteTokens: Number.NaN,
        },
      },
    });

    expect(client.sessionStats.value).toEqual({
      tokens: 272000,
      contextWindow: 272000,
      percent: 32.1,
      messageCount: 12,
      cost: 1.354,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("tracks thinking level from state responses", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "get_state",
        success: true,
        data: {
          sessionId: "session-1",
          sessionFile: "/tmp/session-1.jsonl",
          sessionName: "Session 1",
          thinkingLevel: "medium",
          isStreaming: false,
          isCompacting: false,
          steeringMode: "all",
          followUpMode: "all",
          autoCompactionEnabled: false,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      },
    });

    expect(client.currentThinkingLevel.value).toBe("medium");
  });

  it("setThinkingLevel sends the command and updates local state", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    const initialGetStateCount = ws.send.mock.calls.filter(
      ([message]: [string]) => message.includes('"type":"get_state"'),
    ).length;

    const pendingSet = client.setThinkingLevel("high");
    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"set_thinking_level"'),
    );

    const setCommandCall = ws.send.mock.calls.find(([message]: [string]) =>
      message.includes('"type":"set_thinking_level"'),
    );
    expect(setCommandCall).toBeDefined();
    const setCommand = JSON.parse(setCommandCall?.[0] as string) as {
      payload: { id: string };
    };

    simulateMessage(ws, {
      type: "response",
      payload: {
        id: setCommand.payload.id,
        type: "response",
        command: "set_thinking_level",
        success: true,
      },
    });

    await pendingSet;
    expect(client.currentThinkingLevel.value).toBe("high");
    // setThinkingLevel only sends set_thinking_level; it does not send get_state.
    expect(
      ws.send.mock.calls.filter(([message]: [string]) =>
        message.includes('"type":"get_state"'),
      ).length,
    ).toBe(initialGetStateCount);
  });

  it("setAutoCompactionEnabled sends the command and updates local state", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "get_state",
        success: true,
        data: {
          sessionId: "session-1",
          sessionFile: "/tmp/session-1.jsonl",
          sessionName: "Session 1",
          thinkingLevel: "medium",
          isStreaming: false,
          isCompacting: false,
          steeringMode: "all",
          followUpMode: "all",
          autoCompactionEnabled: false,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      },
    });

    const pendingSet = client.setAutoCompactionEnabled(true);
    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"set_auto_compaction"'),
    );

    const setCommandCall = ws.send.mock.calls.find(([message]: [string]) =>
      message.includes('"type":"set_auto_compaction"'),
    );
    expect(setCommandCall).toBeDefined();
    const setCommand = JSON.parse(setCommandCall?.[0] as string) as {
      payload: { id: string };
    };

    simulateMessage(ws, {
      type: "response",
      payload: {
        id: setCommand.payload.id,
        type: "response",
        command: "set_auto_compaction",
        success: true,
      },
    });

    await pendingSet;
    expect(client.sessionState.value?.autoCompactionEnabled).toBe(true);
  });

  it("compactSession exposes in-flight compaction state and refreshes state", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);
    ws.send.mockClear();

    const pendingCompact = client.compactSession("Keep pending todos");
    expect(client.isCompacting.value).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"compact"'),
    );

    const compactCommandCall = ws.send.mock.calls.find(([message]: [string]) =>
      message.includes('"type":"compact"'),
    );
    expect(compactCommandCall).toBeDefined();
    const compactCommand = JSON.parse(compactCommandCall?.[0] as string) as {
      payload: { id: string };
    };

    simulateMessage(ws, {
      type: "response",
      payload: {
        id: compactCommand.payload.id,
        type: "response",
        command: "compact",
        success: true,
        data: {
          summary: "Compacted",
        },
      },
    });

    await pendingCompact;
    expect(client.isCompacting.value).toBe(false);
    expect(
      ws.send.mock.calls.some(([message]: [string]) =>
        message.includes('"type":"get_state"'),
      ),
    ).toBe(true);
  });

  it("appends one transcript error when manual compact fails", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);
    ws.send.mockClear();

    const pendingCompact = client.compactSession("Keep pending todos");
    const compactCommandCall = ws.send.mock.calls.find(([message]: [string]) =>
      message.includes('"type":"compact"'),
    );
    expect(compactCommandCall).toBeDefined();
    const compactCommand = JSON.parse(compactCommandCall?.[0] as string) as {
      payload: { id: string };
    };

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "compaction_start",
        reason: "manual",
      },
    });

    expect(client.isCompacting.value).toBe(true);

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "compaction_end",
        reason: "manual",
        result: null,
        aborted: false,
        willRetry: false,
        errorMessage: "Compaction requires an active session",
      },
    });

    simulateMessage(ws, {
      type: "response",
      payload: {
        id: compactCommand.payload.id,
        type: "response",
        command: "compact",
        success: false,
        error: "Compaction requires an active session",
      },
    });

    await expect(pendingCompact).resolves.toMatchObject({
      command: "compact",
      success: false,
      error: "Compaction requires an active session",
    });

    const errorEntries = client.transcript.value.filter(
      entry => entry.stopReason === "error",
    );
    expect(errorEntries).toHaveLength(1);
    expect(errorEntries[0]).toMatchObject({
      role: "assistant",
      stopReason: "error",
      errorMessage: "Compaction failed: Compaction requires an active session",
    });
  });

  it("appends a transcript error when the compact request rejects", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);
    ws.send.mockClear();

    const pendingCompact = client.compactSession("Keep pending todos");

    const closeHandler = ws.addEventListener.mock.calls.find(
      (c: unknown[]) => c[0] === "close",
    )?.[1] as (() => void) | undefined;
    expect(closeHandler).toBeDefined();
    closeHandler!();

    await expect(pendingCompact).rejects.toThrow("WebSocket closed");

    const lastEntry = client.transcript.value.at(-1);
    expect(lastEntry).toMatchObject({
      role: "assistant",
      stopReason: "error",
      errorMessage: "Compaction failed: WebSocket closed",
    });
  });

  it("tracks pushed auto-compaction events and appends failures", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "get_state",
        success: true,
        data: {
          sessionId: "session-1",
          sessionFile: "/tmp/session-1.jsonl",
          sessionName: "Session 1",
          thinkingLevel: "medium",
          isStreaming: false,
          isCompacting: false,
          steeringMode: "all",
          followUpMode: "all",
          autoCompactionEnabled: true,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      },
    });

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "compaction_start",
        reason: "threshold",
      },
    });

    expect(client.isCompacting.value).toBe(true);
    expect(client.sessionState.value?.isCompacting).toBe(true);

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "compaction_end",
        reason: "threshold",
        result: null,
        aborted: false,
        willRetry: false,
        errorMessage: "API quota exceeded",
      },
    });

    expect(client.isCompacting.value).toBe(false);
    expect(client.sessionState.value?.isCompacting).toBe(false);
    expect(client.transcript.value.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "error",
      errorMessage: "Compaction failed: API quota exceeded",
    });
  });

  it("sendPrompt forwards image attachments in the prompt payload", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    client.sendPrompt("Inspect this", [
      {
        type: "image",
        mimeType: "image/png",
        data: "ZmFrZS1pbWFnZQ==",
      },
    ]);

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "command",
        payload: {
          type: "prompt",
          message: "Inspect this",
          images: [
            {
              type: "image",
              mimeType: "image/png",
              data: "ZmFrZS1pbWFnZQ==",
            },
          ],
          streamingBehavior: "steer",
        },
      }),
    );
  });

  it("handles select method by setting pendingExtensionRequest", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    const request = {
      type: "extension_ui_request",
      id: "req-1",
      method: "select" as const,
      title: "Pick an option",
      options: ["A", "B", "C"],
    };

    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: request,
    });

    expect(client.pendingExtensionRequest.value).toEqual(request);
  });

  it("handles confirm method by setting pendingExtensionRequest", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    const request = {
      type: "extension_ui_request",
      id: "req-2",
      method: "confirm" as const,
      title: "Are you sure?",
      message: "This cannot be undone.",
    };

    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: request,
    });

    expect(client.pendingExtensionRequest.value).toEqual(request);
  });

  it("handles input method by setting pendingExtensionRequest", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    const request = {
      type: "extension_ui_request",
      id: "req-3",
      method: "input" as const,
      title: "Enter a value",
      placeholder: "Type here...",
    };

    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: request,
    });

    expect(client.pendingExtensionRequest.value).toEqual(request);
  });

  it("handles editor method by setting pendingExtensionRequest", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    const request = {
      type: "extension_ui_request",
      id: "req-4",
      method: "editor" as const,
      title: "Edit content",
      prefill: "Hello world",
    };

    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: request,
    });

    expect(client.pendingExtensionRequest.value).toEqual(request);
  });

  it("handles notify method by pushing to notifications array", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "notif-1",
        method: "notify",
        message: "Something happened",
        notifyType: "info",
      },
    });

    expect(client.notifications.value).toHaveLength(1);
    expect(client.notifications.value[0]).toEqual({
      message: "Something happened",
      notifyType: "info",
      id: "notif-1",
    });
  });

  it("handles setTitle method by updating document.title", async () => {
    await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    const originalTitle = document.title;
    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "title-1",
        method: "setTitle",
        title: "New Page Title",
      },
    });

    expect(document.title).toBe("New Page Title");
    document.title = originalTitle;
  });

  it("handles set_editor_text by setting prefillText ref", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "prefill-1",
        method: "set_editor_text",
        text: "Hello from extension",
      },
    });

    expect(client.prefillText.value).toBe("Hello from extension");
  });

  it("handles setStatus by updating statusEntries map", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "status-1",
        method: "setStatus",
        statusKey: "git",
        statusText: "main ✓",
      },
    });

    expect(client.statusEntries.value).toEqual({ git: "main ✓" });
  });

  it("handles setStatus with undefined statusText as empty string", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "status-2",
        method: "setStatus",
        statusKey: "git",
        statusText: undefined,
      },
    });

    expect(client.statusEntries.value).toEqual({ git: "" });
  });

  it("handles setWidget by updating widgetEntries map", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "widget-1",
        method: "setWidget",
        widgetKey: "todos",
        widgetLines: ["Buy milk", "Write code"],
        widgetPlacement: "aboveEditor",
      },
    });

    expect(client.widgetEntries.value).toEqual({
      todos: { lines: ["Buy milk", "Write code"], placement: "aboveEditor" },
    });
  });

  it("handles setWidget with undefined widgetLines by removing entry", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    // First add a widget
    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "widget-2",
        method: "setWidget",
        widgetKey: "todos",
        widgetLines: ["Buy milk"],
      },
    });
    expect(client.widgetEntries.value).toHaveProperty("todos");

    // Then remove it
    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "widget-3",
        method: "setWidget",
        widgetKey: "todos",
        widgetLines: undefined,
      },
    });
    expect(client.widgetEntries.value).not.toHaveProperty("todos");
  });

  it("respondToUIRequest sends extension_ui_response and clears pending", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    // Set a pending request
    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "req-resp",
        method: "select",
        title: "Choose",
        options: ["X", "Y"],
      },
    });
    expect(client.pendingExtensionRequest.value).toBeTruthy();

    // Respond
    client.respondToUIRequest({
      type: "extension_ui_response",
      id: "req-resp",
      value: "X",
    });

    // Should have cleared pending and sent response
    expect(client.pendingExtensionRequest.value).toBeNull();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "extension_ui_response",
        payload: { type: "extension_ui_response", id: "req-resp", value: "X" },
      }),
    );
  });

  it("dismissNotification removes the notification by id", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    // Add two notifications
    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "n1",
        method: "notify",
        message: "First",
      },
    });
    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "n2",
        method: "notify",
        message: "Second",
      },
    });
    expect(client.notifications.value).toHaveLength(2);

    // Dismiss first
    client.dismissNotification("n1");
    expect(client.notifications.value).toHaveLength(1);
    expect(client.notifications.value[0].id).toBe("n2");
  });

  it("replaces transcript from bridge snapshots", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "transcript_snapshot",
        messages: [
          {
            transcriptKey: "user-1",
            id: "user-1",
            role: "user",
            content: "Hello",
          },
        ],
        hasOlder: false,
        hasNewer: false,
      },
    });

    expect(client.transcript.value).toEqual([
      {
        transcriptKey: "user-1",
        id: "user-1",
        role: "user",
        content: "Hello",
      },
    ]);
  });

  it("upserts transcript messages by transcriptKey without polling", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);
    ws.send.mockClear();

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "transcript_upsert",
        message: {
          transcriptKey: "live:1",
          role: "assistant",
          content: "Hi",
        },
      },
    });
    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "transcript_upsert",
        message: {
          transcriptKey: "live:1",
          id: "assistant-1",
          role: "assistant",
          content: "Hi there",
        },
      },
    });

    expect(client.transcript.value).toEqual([
      {
        transcriptKey: "live:1",
        id: "assistant-1",
        role: "assistant",
        content: "Hi there",
      },
    ]);
    expect(
      ws.send.mock.calls.some(([message]: [string]) =>
        message.includes('"type":"get_messages"'),
      ),
    ).toBe(false);
  });

  it("keeps newer transcript events when new_session returns an empty snapshot", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "transcript_snapshot",
        sessionPath: "/tmp/old.jsonl",
        messages: [
          {
            transcriptKey: "old-1",
            id: "old-1",
            role: "assistant",
            content: "Old",
          },
        ],
        hasOlder: false,
        hasNewer: false,
      },
    });
    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "transcript_snapshot",
        sessionPath: "/tmp/new.jsonl",
        messages: [],
        hasOlder: false,
        hasNewer: false,
      },
    });
    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "transcript_upsert",
        sessionPath: "/tmp/new.jsonl",
        message: {
          transcriptKey: "live:1",
          id: "user-1",
          role: "user",
          content: "Hello",
        },
      },
    });

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "new_session",
        success: true,
        data: {
          transcript: {
            messages: [],
            hasOlder: false,
            hasNewer: false,
          },
          treeEntries: [],
          sessionId: "session-2",
          sessionName: "Session 2",
          sessionPath: "/tmp/new.jsonl",
          cancelled: false,
        },
      },
    });

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "transcript_upsert",
        sessionPath: "/tmp/new.jsonl",
        message: {
          transcriptKey: "live:1",
          id: "user-1",
          role: "user",
          content: "Hello",
        },
      },
    });

    expect(client.transcript.value).toEqual([
      {
        transcriptKey: "live:1",
        id: "user-1",
        role: "user",
        content: "Hello",
      },
    ]);
  });

  it("accepts pushed empty session stats after new_session", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "session_stats",
        sessionPath: "/tmp/old.jsonl",
        stats: {
          tokens: 2_000,
          contextWindow: 8_000,
          percent: 25,
          messageCount: 4,
          cost: 0.2,
          inputTokens: 1_800,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    });

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "new_session",
        success: true,
        data: {
          transcript: {
            messages: [],
            hasOlder: false,
            hasNewer: false,
          },
          treeEntries: [],
          sessionId: "session-2",
          sessionName: "Session 2",
          sessionPath: "/tmp/new.jsonl",
          cancelled: false,
        },
      },
    });

    expect(client.sessionStats.value).toEqual({
      tokens: 2_000,
      contextWindow: 8_000,
      percent: 25,
      messageCount: 4,
      cost: 0.2,
      inputTokens: 1_800,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "session_stats",
        sessionPath: "/tmp/new.jsonl",
        stats: {
          tokens: null,
          contextWindow: 0,
          percent: null,
          messageCount: 0,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    });

    expect(client.sessionStats.value).toEqual({
      tokens: null,
      contextWindow: 0,
      percent: null,
      messageCount: 0,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("updates session stats from pushed events while streaming", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        command: "get_state",
        success: true,
        data: {
          sessionId: "session-1",
          sessionFile: "/tmp/live.jsonl",
          sessionName: "Session 1",
          thinkingLevel: "normal",
          isStreaming: false,
          isCompacting: false,
          steeringMode: "all",
          followUpMode: "all",
          autoCompactionEnabled: false,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      },
    });

    ws.send.mockClear();

    simulateMessage(ws, {
      type: "event",
      payload: { type: "agent_start" },
    });

    expect(client.isStreaming.value).toBe(true);
    expect(ws.send).not.toHaveBeenCalled();

    simulateMessage(ws, {
      type: "event",
      payload: {
        type: "session_stats",
        sessionPath: "/tmp/live.jsonl",
        stats: {
          tokens: 1_000,
          contextWindow: 8_000,
          percent: 12.5,
          messageCount: 1,
          cost: 0.01,
          inputTokens: 900,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    });

    expect(client.sessionStats.value).toEqual({
      tokens: 1_000,
      contextWindow: 8_000,
      percent: 12.5,
      messageCount: 1,
      cost: 0.01,
      inputTokens: 900,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    simulateMessage(ws, {
      type: "event",
      payload: { type: "agent_end" },
    });

    expect(client.isStreaming.value).toBe(false);
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"get_state"'),
    );
  });

  it("abortGeneration sends abort only while streaming", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    await expect(client.abortGeneration()).resolves.toBeNull();
    expect(ws.send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"abort"'),
    );

    simulateMessage(ws, {
      type: "event",
      payload: { type: "agent_start" },
    });

    const abortPromise = client.abortGeneration();
    const abortRequest = ws.send.mock.calls
      .map(
        ([message]: [string]) =>
          JSON.parse(message) as { payload?: { type?: string; id?: string } },
      )
      .find(message => message.payload?.type === "abort");

    expect(abortRequest?.payload?.id).toBeTruthy();

    simulateMessage(ws, {
      type: "response",
      payload: {
        type: "response",
        id: abortRequest?.payload?.id,
        command: "abort",
        success: true,
      },
    });

    await expect(abortPromise).resolves.toMatchObject({
      command: "abort",
      success: true,
    });
  });

  it("clears pendingExtensionRequest and notifications on WS close", async () => {
    const client = await importComposable();
    const ws = getLastMockWs();
    simulateOpen(ws);

    // Set up some state
    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "req-close",
        method: "select",
        title: "Choose",
        options: ["A"],
      },
    });
    simulateMessage(ws, {
      type: "extension_ui_request",
      payload: {
        type: "extension_ui_request",
        id: "n-close",
        method: "notify",
        message: "Hello",
      },
    });
    expect(client.pendingExtensionRequest.value).toBeTruthy();
    expect(client.notifications.value).toHaveLength(1);

    // Simulate close
    const closeHandler = ws.addEventListener.mock.calls.find(
      (c: unknown[]) => c[0] === "close",
    )?.[1] as (() => void) | undefined;
    expect(closeHandler).toBeDefined();
    closeHandler!();

    expect(client.pendingExtensionRequest.value).toBeNull();
    expect(client.notifications.value).toHaveLength(0);
  });
});
