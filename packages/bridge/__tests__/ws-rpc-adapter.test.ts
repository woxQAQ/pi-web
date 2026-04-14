import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAgentSessionMock } = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", async () => {
  const actual = await vi.importActual<
    typeof import("@mariozechner/pi-coding-agent")
  >("@mariozechner/pi-coding-agent");

  return {
    ...actual,
    createAgentSession: createAgentSessionMock,
  };
});
import type { WebSocket } from "ws";
import { BridgeEventBus } from "../bridge-event-bus.js";
import {
  DEFAULT_BRIDGE_CONFIG,
  type RpcCommand,
  type RpcExtensionUIResponse,
  type WsClient,
} from "../types.js";
import { WsRpcAdapter, type WsRpcAdapterContext } from "../ws-rpc-adapter.js";

// Mock WebSocket
const createMockWebSocket = (): WebSocket => {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return {} as WebSocket;
    }),
    send: vi.fn(),
    readyState: 1, // WebSocket.OPEN
    trigger: (event: string, ...args: unknown[]) => {
      handlers[event]?.forEach(h => h(...args));
    },
  } as unknown as WebSocket;
};

// Mock context
const createMockContext = (): WsRpcAdapterContext => ({
  pi: {
    sendUserMessage: vi.fn(),
    setModel: vi.fn().mockResolvedValue(true),
    setThinkingLevel: vi.fn(),
    getThinkingLevel: vi.fn().mockReturnValue("normal"),
    setSessionName: vi.fn(),
    getSessionName: vi.fn().mockReturnValue("test-session"),
    getCommands: vi
      .fn()
      .mockReturnValue([
        { name: "test", description: "Test command", source: "extension" },
      ]),
    on: vi.fn(),
  },
  ctx: {
    sessionManager: {
      getBranch: vi.fn().mockReturnValue([{ role: "user", content: "Hello" }]),
      getEntries: vi.fn().mockReturnValue([{ role: "user", content: "Hello" }]),
      getSessionId: vi.fn().mockReturnValue("session-123"),
      getSessionFile: vi.fn().mockReturnValue("/path/to/session.json"),
    },
    model: { id: "gpt-4", provider: "openai" },
    modelRegistry: {
      getAvailable: vi.fn().mockResolvedValue([
        { id: "gpt-4", provider: "openai", name: "GPT-4" },
        { id: "claude", provider: "anthropic", name: "Claude" },
      ]),
    },
    isIdle: vi.fn().mockReturnValue(true),
    signal: undefined,
    abort: vi.fn(),
    compact: vi.fn(),
    shutdown: vi.fn(),
    hasPendingMessages: vi.fn().mockReturnValue(false),
    getContextUsage: vi
      .fn()
      .mockReturnValue({ tokens: 1000, contextWindow: 8000, percent: 12.5 }),
    getSystemPrompt: vi.fn().mockReturnValue("You are a helpful assistant."),
    cwd: "/test/project",
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue({ cancelled: false }),
    fork: vi.fn().mockResolvedValue({ cancelled: false }),
    navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
  },
});

describe("WsRpcAdapter", () => {
  let ws: WebSocket;
  let context: WsRpcAdapterContext;
  let eventBus: BridgeEventBus;
  let emitEvent: ReturnType<typeof vi.fn>;
  let adapter: WsRpcAdapter;
  let client: WsClient;

  beforeEach(() => {
    createAgentSessionMock.mockReset();
    ws = createMockWebSocket();
    context = createMockContext();
    eventBus = new BridgeEventBus(DEFAULT_BRIDGE_CONFIG);
    emitEvent = vi.fn();
    client = {
      id: "test-client",
      seq: 1,
      connectedAt: new Date().toISOString(),
    };
    adapter = new WsRpcAdapter(
      client,
      ws,
      context,
      DEFAULT_BRIDGE_CONFIG,
      eventBus,
      emitEvent,
    );
  });

  describe("command dispatch", () => {
    it("should handle prompt command by auto-creating a session", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-prompt-"));
      const sessionFile = path.join(tmpDir, "session.jsonl");
      // Write a minimal session header so SessionManager.open works
      fs.writeFileSync(
        sessionFile,
        JSON.stringify({
          type: "session",
          version: 3,
          id: "live-session",
          timestamp: new Date().toISOString(),
          cwd: tmpDir,
        }),
      );
      (
        context.ctx.sessionManager.getSessionFile as ReturnType<typeof vi.fn>
      ).mockReturnValue(sessionFile);

      const promptSpy = vi.fn().mockResolvedValue(undefined);
      createAgentSessionMock.mockResolvedValue({
        session: {
          sessionFile: undefined, // will be set by autoCreateSession
          sessionId: "auto-session",
          isStreaming: false,
          bindExtensions: vi.fn().mockResolvedValue(undefined),
          subscribe: vi.fn().mockReturnValue(() => {}),
          prompt: promptSpy,
          sessionManager: {
            getSessionFile: vi.fn().mockReturnValue(undefined),
            getSessionId: vi.fn().mockReturnValue("auto-session"),
            getEntries: vi.fn().mockReturnValue([]),
            getBranch: vi.fn().mockReturnValue([]),
            getCwd: vi.fn().mockReturnValue(tmpDir),
          },
        },
      });

      const command: RpcCommand = {
        id: "cmd-1",
        type: "prompt",
        message: "Hello",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      // Wait for async handling
      await new Promise(r => setTimeout(r, 30));

      // Should NOT call pi.sendUserMessage (that would trigger TUI switch)
      expect(context.pi.sendUserMessage).not.toHaveBeenCalled();
      expect(emitEvent).toHaveBeenCalledWith({
        type: "command_received",
        client,
        commandType: "prompt",
        correlationId: "cmd-1",
      });

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("wraps prompt attachments into Pi image content (with selected session)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-attach-"));
      const sessionManager = SessionManager.create(tmpDir, tmpDir);
      sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "Initial" }],
        timestamp: Date.now(),
      });
      const sessionFile = sessionManager.getSessionFile();
      if (!sessionFile) throw new Error("session file was not created");

      const rawEntries = sessionManager.getEntries();
      const header = {
        type: "session",
        version: 3,
        id: sessionManager.getSessionId(),
        timestamp: new Date().toISOString(),
        cwd: tmpDir,
      };
      fs.writeFileSync(
        sessionFile,
        [
          JSON.stringify(header),
          ...rawEntries.map(e => JSON.stringify(e)),
        ].join("\n"),
      );

      const promptSpy = vi.fn().mockResolvedValue(undefined);
      createAgentSessionMock.mockResolvedValue({
        session: {
          sessionFile,
          sessionId: sessionManager.getSessionId(),
          isStreaming: false,
          bindExtensions: vi.fn().mockResolvedValue(undefined),
          subscribe: vi.fn().mockReturnValue(() => {}),
          prompt: promptSpy,
          sessionManager,
        },
      });

      // Switch to a session first
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "command",
            payload: {
              id: "switch-1",
              type: "switch_session",
              sessionPath: sessionFile,
            },
          }),
        ),
      );
      await new Promise(r => setTimeout(r, 10));

      // Now send prompt with image
      const command: RpcCommand = {
        id: "cmd-2",
        type: "prompt",
        message: "Inspect this image",
        images: [
          {
            type: "image",
            mimeType: "image/png",
            data: "ZmFrZS1pbWFnZQ==",
          },
        ],
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 20));

      expect(context.pi.sendUserMessage).not.toHaveBeenCalled();
      expect(promptSpy).toHaveBeenCalledWith("Inspect this image", {
        source: "rpc",
        images: [
          {
            type: "image",
            mimeType: "image/png",
            data: "ZmFrZS1pbWFnZQ==",
          },
        ],
      });

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("continues the selected session instead of using pi.sendUserMessage", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-session-"));
      const sessionManager = SessionManager.create(tmpDir, tmpDir);
      sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "Selected session" }],
        timestamp: Date.now(),
      });
      const sessionFile = sessionManager.getSessionFile();
      if (!sessionFile) {
        throw new Error("session file was not created");
      }

      // SessionManager.create doesn't immediately flush to disk. Force persist
      // by re-opening from the in-memory entries.
      const rawEntries = sessionManager.getEntries();
      const header = {
        type: "session",
        version: 3,
        id: sessionManager.getSessionId(),
        timestamp: new Date().toISOString(),
        cwd: tmpDir,
      };
      const lines = [JSON.stringify(header)];
      for (const entry of rawEntries) {
        lines.push(JSON.stringify(entry));
      }
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const promptSpy = vi.fn().mockResolvedValue(undefined);
      const subscribeSpy = vi.fn().mockReturnValue(() => {});
      createAgentSessionMock.mockResolvedValue({
        session: {
          sessionFile,
          sessionId: sessionManager.getSessionId(),
          isStreaming: false,
          bindExtensions: vi.fn().mockResolvedValue(undefined),
          subscribe: subscribeSpy,
          prompt: promptSpy,
          sessionManager,
        },
      });

      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "command",
            payload: {
              id: "switch-1",
              type: "switch_session",
              sessionPath: sessionFile,
            },
          }),
        ),
      );

      await new Promise(r => setTimeout(r, 10));

      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "command",
            payload: {
              id: "prompt-1",
              type: "prompt",
              message: "Continue here",
            },
          }),
        ),
      );

      await new Promise(r => setTimeout(r, 20));

      expect(context.pi.sendUserMessage).not.toHaveBeenCalled();
      expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
      expect(promptSpy).toHaveBeenCalledWith("Continue here", {
        source: "rpc",
      });
    });

    it("passes prompt attachments through when continuing the selected session", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-session-"));
      const sessionManager = SessionManager.create(tmpDir, tmpDir);
      sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "Selected session" }],
        timestamp: Date.now(),
      });
      const sessionFile = sessionManager.getSessionFile();
      if (!sessionFile) {
        throw new Error("session file was not created");
      }

      const rawEntries = sessionManager.getEntries();
      const header = {
        type: "session",
        version: 3,
        id: sessionManager.getSessionId(),
        timestamp: new Date().toISOString(),
        cwd: tmpDir,
      };
      const lines = [JSON.stringify(header)];
      for (const entry of rawEntries) {
        lines.push(JSON.stringify(entry));
      }
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const promptSpy = vi.fn().mockResolvedValue(undefined);
      const subscribeSpy = vi.fn().mockReturnValue(() => {});
      createAgentSessionMock.mockResolvedValue({
        session: {
          sessionFile,
          sessionId: sessionManager.getSessionId(),
          isStreaming: false,
          bindExtensions: vi.fn().mockResolvedValue(undefined),
          subscribe: subscribeSpy,
          prompt: promptSpy,
          sessionManager,
        },
      });

      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "command",
            payload: {
              id: "switch-attachments",
              type: "switch_session",
              sessionPath: sessionFile,
            },
          }),
        ),
      );

      await new Promise(r => setTimeout(r, 10));

      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "command",
            payload: {
              id: "prompt-attachments",
              type: "prompt",
              message: "Continue with context",
              images: [
                {
                  type: "image",
                  mimeType: "image/webp",
                  data: "d2VicA==",
                },
              ],
            },
          }),
        ),
      );

      await new Promise(r => setTimeout(r, 20));

      expect(promptSpy).toHaveBeenCalledWith("Continue with context", {
        source: "rpc",
        images: [
          {
            type: "image",
            mimeType: "image/webp",
            data: "d2VicA==",
          },
        ],
      });
    });

    it("should handle steer command", async () => {
      const command: RpcCommand = {
        id: "cmd-1",
        type: "steer",
        message: "Steer message",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      expect(context.pi.sendUserMessage).toHaveBeenCalledWith("Steer message", {
        deliverAs: "steer",
      });
    });

    it("should handle follow_up command", async () => {
      const command: RpcCommand = {
        id: "cmd-1",
        type: "follow_up",
        message: "Follow up",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      expect(context.pi.sendUserMessage).toHaveBeenCalledWith("Follow up", {
        deliverAs: "followUp",
      });
    });

    it("should handle abort command", async () => {
      const command: RpcCommand = { id: "cmd-1", type: "abort" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      expect(context.ctx.abort).toHaveBeenCalled();
    });

    it("should handle get_state command", async () => {
      const command: RpcCommand = { id: "cmd-1", type: "get_state" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(sendCalls.length).toBeGreaterThan(0);

      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.type).toBe("response");
      expect(response.payload.command).toBe("get_state");
      expect(response.payload.success).toBe(true);
      expect(response.payload.data).toHaveProperty("sessionId", "session-123");
      expect(response.payload.data).toHaveProperty("messageCount", 1);
    });

    it("should handle get_messages command", async () => {
      const command: RpcCommand = { id: "cmd-1", type: "get_messages" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(sendCalls.length).toBeGreaterThan(0);

      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.type).toBe("response");
      expect(response.payload.command).toBe("get_messages");
      expect(response.payload.success).toBe(true);
      expect(response.payload.data.messages).toHaveLength(1);
    });

    it("should handle get_commands command", async () => {
      const command: RpcCommand = { id: "cmd-1", type: "get_commands" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.type).toBe("response");
      expect(response.payload.command).toBe("get_commands");
      expect(response.payload.success).toBe(true);
      expect(response.payload.data.commands).toHaveLength(1);
      expect(response.payload.data.commands[0]).toHaveProperty("name", "test");
    });

    it("should handle set_model command with valid model", async () => {
      const command: RpcCommand = {
        id: "cmd-1",
        type: "set_model",
        provider: "openai",
        modelId: "gpt-4",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      expect(context.ctx.modelRegistry.getAvailable).toHaveBeenCalled();
      expect(context.pi.setModel).toHaveBeenCalled();

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(true);
    });

    it("should handle set_model command with invalid model", async () => {
      const command: RpcCommand = {
        id: "cmd-1",
        type: "set_model",
        provider: "unknown",
        modelId: "unknown",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error).toContain("Model not found");
    });

    it("should return error for unsupported commands", async () => {
      const command: RpcCommand = { id: "cmd-1", type: "bash", command: "ls" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error).toContain("not supported via bridge");
    });

    it("should emit command_error event on command dispatch failure", async () => {
      // The prompt handler auto-creates a session. If that fails, the
      // error surfaces as a command_error event.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-err-"));
      const sessionFile = path.join(tmpDir, "session.jsonl");
      fs.writeFileSync(
        sessionFile,
        JSON.stringify({
          type: "session",
          version: 3,
          id: "err-session",
          timestamp: new Date().toISOString(),
          cwd: tmpDir,
        }),
      );
      (
        context.ctx.sessionManager.getSessionFile as ReturnType<typeof vi.fn>
      ).mockReturnValue(sessionFile);

      createAgentSessionMock.mockRejectedValue(new Error("Dispatch failed"));

      const command: RpcCommand = {
        id: "cmd-1",
        type: "prompt",
        message: "Hello",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "command_error",
          client,
          commandType: "prompt",
          correlationId: "cmd-1",
          error: "Dispatch failed",
        }),
      );

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("extension UI routing", () => {
    it("should send fire-and-forget UI requests to the client", () => {
      const uiContext = adapter.createExtensionUIContext();

      uiContext.setTitle("Bridge UI");
      uiContext.setEditorText("draft text");

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls.map(
        call => JSON.parse(call[0] as string),
      );

      expect(sendCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "extension_ui_request",
            payload: expect.objectContaining({
              method: "setTitle",
              title: "Bridge UI",
            }),
          }),
          expect.objectContaining({
            type: "extension_ui_request",
            payload: expect.objectContaining({
              method: "set_editor_text",
              text: "draft text",
            }),
          }),
        ]),
      );
    });

    it("should send UI request and wait for response", async () => {
      const uiContext = adapter.createExtensionUIContext();

      // Start select request
      const selectPromise = uiContext.select("Choose one", ["a", "b", "c"]);

      // Should have sent a UI request
      await new Promise(r => setTimeout(r, 10));
      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);

      expect(lastCall.type).toBe("extension_ui_request");
      expect(lastCall.payload.method).toBe("select");
      expect(lastCall.payload).toHaveProperty("id");

      // Simulate client response
      const requestId = lastCall.payload.id;
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "extension_ui_response",
            payload: {
              type: "extension_ui_response",
              id: requestId,
              value: "a",
            } as RpcExtensionUIResponse,
          }),
        ),
      );

      const result = await selectPromise;
      expect(result).toBe("a");
    });

    it("should handle UI request timeout", async () => {
      const shortTimeoutConfig = {
        ...DEFAULT_BRIDGE_CONFIG,
        uiRequestTimeout: 50,
      };
      const shortAdapter = new WsRpcAdapter(
        client,
        ws,
        context,
        shortTimeoutConfig,
        eventBus,
        emitEvent,
      );

      const uiContext = shortAdapter.createExtensionUIContext();

      // Start confirm request
      const confirmPromise = uiContext.confirm(
        "Are you sure?",
        "This will delete everything",
      );

      // Wait for timeout
      const result = await confirmPromise;

      // Should return default value (false for confirm)
      expect(result).toBe(false);
    });

    it("should handle UI response for unknown request gracefully", async () => {
      // Send response for non-existent request
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "extension_ui_response",
            payload: {
              type: "extension_ui_response",
              id: "unknown-id",
              value: "test",
            } as RpcExtensionUIResponse,
          }),
        ),
      );

      await new Promise(r => setTimeout(r, 10));

      // Should not throw, just log a warning
      expect(ws.send).not.toHaveBeenCalledWith(
        expect.stringContaining("error"),
      );
    });

    it("should handle cancelled UI response", async () => {
      const uiContext = adapter.createExtensionUIContext();

      // Start input request
      const inputPromise = uiContext.input("Enter name");

      await new Promise(r => setTimeout(r, 10));
      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
      const requestId = lastCall.payload.id;

      // Send cancelled response
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "extension_ui_response",
            payload: {
              type: "extension_ui_response",
              id: requestId,
              cancelled: true,
            } as RpcExtensionUIResponse,
          }),
        ),
      );

      const result = await inputPromise;
      expect(result).toBeUndefined();
    });
  });

  describe("event fan-out", () => {
    it("should broadcast Pi events via eventBus", () => {
      // Get the agent_start handler registered in subscribeToEvents
      const agentStartHandler = (
        context.pi.on as ReturnType<typeof vi.fn>
      ).mock.calls.find(call => call[0] === "agent_start")?.[1];

      expect(agentStartHandler).toBeDefined();

      // Create a mock broadcast
      const broadcastSpy = vi.spyOn(eventBus, "broadcast");

      // Call the handler with a test event
      agentStartHandler?.({ type: "agent_start" });

      expect(broadcastSpy).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle WebSocket errors", () => {
      (
        ws as unknown as { trigger: (event: string, err: Error) => void }
      ).trigger("error", new Error("Connection lost"));

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "command_error",
          client,
          commandType: "websocket",
        }),
      );
    });

    it("should handle JSON parse errors", async () => {
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger("message", Buffer.from("invalid json"));

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);

      expect(lastCall.type).toBe("response");
      expect(lastCall.payload.success).toBe(false);
      expect(lastCall.payload.error).toContain("Failed to parse");
    });

    it("should handle unknown message types", async () => {
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "unknown_type" })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);

      expect(lastCall.type).toBe("response");
      expect(lastCall.payload.success).toBe(false);
      expect(lastCall.payload.error).toContain("Unknown message type");
    });
  });

  describe("discovery commands", () => {
    it("should handle list_sessions command", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-sessions-"));
      const currentSessionFile = path.join(tmpDir, "current-session.jsonl");
      const olderSessionFile = path.join(tmpDir, "older-session.jsonl");
      fs.writeFileSync(
        currentSessionFile,
        [
          JSON.stringify({
            type: "session",
            id: "current-id",
            timestamp: "2025-01-02T00:00:00Z",
            cwd: "/tmp",
          }),
          JSON.stringify({
            type: "message",
            id: "current-msg-1",
            parentId: null,
            timestamp: new Date().toISOString(),
            message: {
              role: "user",
              content: "Current first prompt",
              timestamp: Date.now(),
            },
          }),
        ].join("\n") + "\n",
      );
      fs.writeFileSync(
        olderSessionFile,
        [
          JSON.stringify({
            type: "session",
            id: "older-id",
            timestamp: "2025-01-01T00:00:00Z",
            cwd: "/tmp",
          }),
          JSON.stringify({
            type: "message",
            id: "older-msg-1",
            parentId: null,
            timestamp: new Date().toISOString(),
            message: {
              role: "user",
              content: "Older first prompt",
              timestamp: Date.now(),
            },
          }),
        ].join("\n") + "\n",
      );
      (
        context.ctx.sessionManager.getSessionFile as ReturnType<typeof vi.fn>
      ).mockReturnValue(currentSessionFile);

      const command: RpcCommand = { id: "cmd-1", type: "list_sessions" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.type).toBe("response");
      expect(response.payload.command).toBe("list_sessions");
      expect(response.payload.success).toBe(true);
      expect(response.payload.data.sessions).toEqual([
        {
          id: "older-id",
          name: "Older first prompt",
          path: olderSessionFile,
          timestamp: "2025-01-01T00:00:00Z",
        },
        {
          id: "current-id",
          name: "Current first prompt",
          path: currentSessionFile,
          timestamp: "2025-01-02T00:00:00Z",
        },
      ]);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should handle list_sessions when no session file is available", async () => {
      (
        context.ctx.sessionManager.getSessionFile as ReturnType<typeof vi.fn>
      ).mockReturnValue(undefined);

      const command: RpcCommand = { id: "cmd-1", type: "list_sessions" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data.sessions).toEqual([]);
    });

    it("should handle list_workspace_entries command", async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pi-web-workspace-test-"),
      );
      fs.mkdirSync(path.join(tmpDir, "src", "components"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "ignored.log\n");
      fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET=1\n");
      fs.writeFileSync(path.join(tmpDir, "README.md"), "# test\n");
      fs.writeFileSync(path.join(tmpDir, "ignored.log"), "skip\n");
      fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export {};\n");
      fs.writeFileSync(
        path.join(tmpDir, "src", "components", "ComposerBar.vue"),
        "<template />\n",
      );
      context.ctx.cwd = tmpDir;

      const command: RpcCommand = {
        id: "cmd-workspace",
        type: "list_workspace_entries",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.command).toBe("list_workspace_entries");
      expect(response.payload.success).toBe(true);
      expect(response.payload.data.entries).toEqual(
        expect.arrayContaining([
          { path: ".env", kind: "file" },
          { path: ".gitignore", kind: "file" },
          { path: "README.md", kind: "file" },
          { path: "src", kind: "directory" },
          { path: "src/components", kind: "directory" },
          { path: "src/index.ts", kind: "file" },
          { path: "src/components/ComposerBar.vue", kind: "file" },
        ]),
      );
      expect(response.payload.data.entries).not.toContainEqual({
        path: "ignored.log",
        kind: "file",
      });

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should handle list_tree_entries command", async () => {
      (
        context.ctx.sessionManager.getBranch as ReturnType<typeof vi.fn>
      ).mockReturnValue([
        {
          id: "entry-1",
          role: "user",
          type: "message",
          timestamp: "2025-01-01T00:00:00Z",
        },
        {
          id: "entry-2",
          role: "assistant",
          type: "message",
          timestamp: "2025-01-01T00:01:00Z",
        },
      ]);

      const command: RpcCommand = { id: "cmd-1", type: "list_tree_entries" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.type).toBe("response");
      expect(response.payload.command).toBe("list_tree_entries");
      expect(response.payload.success).toBe(true);
      expect(response.payload.data.entries).toHaveLength(2);
      expect(response.payload.data.entries[0]).toEqual({
        id: "entry-1",
        label: "user",
        type: "message",
        timestamp: "2025-01-01T00:00:00Z",
        parentId: null,
        depth: 0,
        trackColumns: [],
        isActive: false,
        isOnActivePath: true,
      });
    });

    it("should load list_tree_entries from the session file when available", async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pi-web-tree-test-"),
      );
      const sessionManager = SessionManager.create(tmpDir, tmpDir);
      sessionManager.appendModelChange("openai", "gpt-4.1");
      sessionManager.appendThinkingLevelChange("high");
      sessionManager.appendMessage({
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      } as any);
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        timestamp: Date.now(),
      } as any);
      const sessionFile = sessionManager.getSessionFile();
      if (!sessionFile) {
        throw new Error("session file was not created");
      }
      (
        context.ctx.sessionManager.getSessionFile as ReturnType<typeof vi.fn>
      ).mockReturnValue(sessionFile);

      const command: RpcCommand = { id: "cmd-1", type: "list_tree_entries" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data.entries).toHaveLength(2);
      expect(response.payload.data.entries[0]).toMatchObject({
        label: "user: Hello",
        depth: 0,
      });
      expect(response.payload.data.entries[1]).toMatchObject({
        label: "assistant: Hi",
        depth: 0,
        isActive: true,
      });

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should indent only after an actual branch point", async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pi-web-branch-depth-test-"),
      );
      const sessionManager = SessionManager.create(tmpDir, tmpDir);
      sessionManager.appendMessage({
        role: "user",
        content: "Start",
        timestamp: Date.now(),
      } as any);
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Choose a path" }],
        timestamp: Date.now(),
      } as any);
      const branchPoint = sessionManager.getLeafId();
      sessionManager.appendMessage({
        role: "user",
        content: "Path A",
        timestamp: Date.now(),
      } as any);
      if (!branchPoint) {
        throw new Error("branch point missing");
      }
      sessionManager.branch(branchPoint);
      sessionManager.appendMessage({
        role: "user",
        content: "Path B",
        timestamp: Date.now(),
      } as any);
      const sessionFile = sessionManager.getSessionFile();
      if (!sessionFile) {
        throw new Error("session file was not created");
      }
      (
        context.ctx.sessionManager.getSessionFile as ReturnType<typeof vi.fn>
      ).mockReturnValue(sessionFile);

      const command: RpcCommand = { id: "cmd-1", type: "list_tree_entries" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(true);
      expect(
        response.payload.data.entries.map(
          (entry: { label: string; depth: number }) => ({
            label: entry.label,
            depth: entry.depth,
          }),
        ),
      ).toEqual([
        { label: "user: Start", depth: 0 },
        { label: "assistant: Choose a path", depth: 0 },
        { label: "user: Path B", depth: 1 },
        { label: "user: Path A", depth: 1 },
      ]);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should handle list_tree_entries with empty branch", async () => {
      (
        context.ctx.sessionManager.getBranch as ReturnType<typeof vi.fn>
      ).mockReturnValue([]);

      const command: RpcCommand = { id: "cmd-1", type: "list_tree_entries" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data.entries).toHaveLength(0);
    });

    it("should filter entries without id in list_tree_entries", async () => {
      (
        context.ctx.sessionManager.getBranch as ReturnType<typeof vi.fn>
      ).mockReturnValue([
        { id: "entry-1", role: "user" },
        { role: "orphan", type: "message" }, // no id
      ]);

      const command: RpcCommand = { id: "cmd-1", type: "list_tree_entries" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data.entries).toHaveLength(1);
      expect(response.payload.data.entries[0].id).toBe("entry-1");
    });

    it("should return empty sessions when scanning fails", async () => {
      // Force an error in session scanning by making getSessionFile throw
      (
        context.ctx.sessionManager.getSessionFile as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        throw new Error("session file unavailable");
      });

      const command: RpcCommand = { id: "cmd-1", type: "list_sessions" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data.sessions).toEqual([]);
    });

    it("should return empty entries when getBranch throws", async () => {
      (
        context.ctx.sessionManager.getBranch as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        throw new Error("Branch error");
      });

      const command: RpcCommand = { id: "cmd-1", type: "list_tree_entries" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1][0] as string;
      const response = JSON.parse(lastCall);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data.entries).toEqual([]);
    });
  });

  describe("disposal", () => {
    it("should resolve pending UI requests on dispose", async () => {
      const uiContext = adapter.createExtensionUIContext();

      // Start a request
      const selectPromise = uiContext.select("Choose", ["a", "b"]);
      await new Promise(r => setTimeout(r, 10));

      // Dispose before response
      adapter.dispose();

      // Should resolve with default value
      const result = await selectPromise;
      expect(result).toBeUndefined();
    });

    it("should emit client_disconnect on dispose", () => {
      adapter.dispose();

      expect(emitEvent).toHaveBeenCalledWith({
        type: "client_disconnect",
        client,
        reason: "adapter_disposed",
      });
    });

    it("should not send responses after dispose", async () => {
      adapter.dispose();
      (ws.send as ReturnType<typeof vi.fn>).mockClear();

      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(
          JSON.stringify({ type: "command", payload: { type: "get_state" } }),
        ),
      );
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("command correlation", () => {
    it("should use provided correlation ID", async () => {
      const command: RpcCommand = {
        id: "my-correlation-id",
        type: "get_state",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: "my-correlation-id",
        }),
      );
    });

    it("should generate correlation ID if not provided", async () => {
      const command: RpcCommand = { type: "get_state" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const call = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === "command_received",
      );
      expect(call).toBeDefined();

      const event = call?.[0] as { correlationId: string };
      expect(typeof event.correlationId).toBe("string");
      expect(event.correlationId).toHaveLength(36); // UUID length
    });
  });

  describe("session commands", () => {
    it("should handle set_session_name with valid name", async () => {
      const command: RpcCommand = {
        id: "cmd-1",
        type: "set_session_name",
        name: "New Session Name",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      expect(context.pi.setSessionName).toHaveBeenCalledWith(
        "New Session Name",
      );

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
      expect(lastCall.payload.success).toBe(true);
    });

    it("should reject empty session name", async () => {
      const command: RpcCommand = {
        id: "cmd-1",
        type: "set_session_name",
        name: "   ",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
      expect(lastCall.payload.success).toBe(false);
      expect(lastCall.payload.error).toContain("cannot be empty");
    });

    it("should handle new_session command", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-test-"));
      const sm = SessionManager.create(tmpDir, tmpDir);
      const existingFile = sm.getSessionFile()!;
      (
        context.ctx.sessionManager.getSessionFile as ReturnType<typeof vi.fn>
      ).mockReturnValue(existingFile);

      const command: RpcCommand = { id: "cmd-1", type: "new_session" };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      // ctx.newSession should NOT be called (bridge creates session locally)
      expect(context.ctx.newSession).not.toHaveBeenCalled();
      // createAgentSession should NOT be called eagerly
      expect(createAgentSessionMock).not.toHaveBeenCalled();

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
      expect(lastCall.payload.success).toBe(true);
      expect(lastCall.payload.data.cancelled).toBe(false);
      expect(lastCall.payload.data.sessionId).toBeTruthy();
      expect(lastCall.payload.data.messages).toEqual([]);

      // Clean up temp dir
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should handle fork command", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-test-"));
      const sm = SessionManager.create(tmpDir, tmpDir);
      sm.appendModelChange("openai", "gpt-4.1");
      sm.appendThinkingLevelChange("high");
      sm.appendMessage({
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      } as any);
      sm.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        timestamp: Date.now(),
      } as any);
      const leafId = sm.getLeafId() as string;
      const existingFile = sm.getSessionFile() as string;
      (
        context.ctx.sessionManager.getSessionFile as ReturnType<typeof vi.fn>
      ).mockReturnValue(existingFile);

      const command: RpcCommand = {
        id: "cmd-1",
        type: "fork",
        entryId: leafId,
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      // ctx.fork should NOT be called (bridge creates fork locally)
      expect(context.ctx.fork).not.toHaveBeenCalled();

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
      expect(lastCall.payload.success).toBe(true);
      expect(lastCall.payload.data.cancelled).toBe(false);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should handle switch_session command", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-test-"));
      const sessionManager = SessionManager.create(tmpDir, tmpDir);
      sessionManager.appendModelChange("openai", "gpt-4.1");
      sessionManager.appendThinkingLevelChange("high");
      sessionManager.appendMessage({
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      } as any);
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        timestamp: Date.now(),
      } as any);
      const sessionFile = sessionManager.getSessionFile();
      if (!sessionFile) {
        throw new Error("session file was not created");
      }

      const command: RpcCommand = {
        id: "cmd-1",
        type: "switch_session",
        sessionPath: sessionFile,
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
      expect(lastCall.payload.success).toBe(true);
      expect(lastCall.payload.data.messages).toHaveLength(2);
      expect(lastCall.payload.data.messages[0]).toMatchObject({
        role: "user",
        content: "Hello",
      });
      expect(lastCall.payload.data.sessionId).toBe(
        sessionManager.getSessionId(),
      );
      expect(lastCall.payload.data.sessionName).toBe("Hello");
      expect(lastCall.payload.data.treeEntries).toHaveLength(2);
      expect(lastCall.payload.data.treeEntries[0]).toMatchObject({
        label: "user: Hello",
        type: "message",
        depth: 0,
      });
      expect(lastCall.payload.data.treeEntries[1]).toMatchObject({
        label: "assistant: Hi",
        type: "message",
        depth: 0,
        isActive: true,
      });

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should return error for switch_session with non-existent file", async () => {
      const command: RpcCommand = {
        id: "cmd-1",
        type: "switch_session",
        sessionPath: "/non/existent/path.json",
      };
      (
        ws as unknown as { trigger: (event: string, data: Buffer) => void }
      ).trigger(
        "message",
        Buffer.from(JSON.stringify({ type: "command", payload: command })),
      );

      await new Promise(r => setTimeout(r, 10));

      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
      expect(lastCall.payload.success).toBe(false);
      expect(lastCall.payload.error).toContain("not found");
    });
  });
});
