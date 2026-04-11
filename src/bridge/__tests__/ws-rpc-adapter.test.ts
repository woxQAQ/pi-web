import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WebSocket } from "ws";
import { BridgeEventBus } from "../bridge-event-bus.js";
import { WsRpcAdapter, type WsRpcAdapterContext } from "../ws-rpc-adapter.js";
import { DEFAULT_BRIDGE_CONFIG, type RpcCommand, type RpcExtensionUIResponse, type WsClient } from "../types.js";

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
			handlers[event]?.forEach((h) => h(...args));
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
		getCommands: vi.fn().mockReturnValue([
			{ name: "test", description: "Test command", source: "extension" },
		]),
		on: vi.fn(),
	},
	ctx: {
		sessionManager: {
			getBranch: vi.fn().mockReturnValue([{ role: "user", content: "Hello" }]),
			messages: [{ role: "user", content: "Hello" }],
			sessionId: "session-123",
			sessionFile: "/path/to/session.json",
			sessionName: "Test Session",
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
		getContextUsage: vi.fn().mockReturnValue({ tokens: 1000, contextWindow: 8000, percent: 12.5 }),
		getSystemPrompt: vi.fn().mockReturnValue("You are a helpful assistant."),
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
		ws = createMockWebSocket();
		context = createMockContext();
		eventBus = new BridgeEventBus(DEFAULT_BRIDGE_CONFIG);
		emitEvent = vi.fn();
		client = { id: "test-client", seq: 1, connectedAt: new Date().toISOString() };
		adapter = new WsRpcAdapter(client, ws, context, DEFAULT_BRIDGE_CONFIG, eventBus, emitEvent);
	});

	describe("command dispatch", () => {
		it("should handle prompt command", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "prompt", message: "Hello" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			// Wait for async handling
			await new Promise((r) => setTimeout(r, 10));

			expect(context.pi.sendUserMessage).toHaveBeenCalledWith("Hello", { deliverAs: "steer" });
			expect(emitEvent).toHaveBeenCalledWith({
				type: "command_received",
				client,
				commandType: "prompt",
				correlationId: "cmd-1",
			});
		});

		it("should handle steer command", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "steer", message: "Steer message" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(context.pi.sendUserMessage).toHaveBeenCalledWith("Steer message", { deliverAs: "steer" });
		});

		it("should handle follow_up command", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "follow_up", message: "Follow up" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(context.pi.sendUserMessage).toHaveBeenCalledWith("Follow up", { deliverAs: "followUp" });
		});

		it("should handle abort command", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "abort" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(context.ctx.abort).toHaveBeenCalled();
		});

		it("should handle get_state command", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "get_state" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

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
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

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
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

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
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

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
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = sendCalls[sendCalls.length - 1][0] as string;
			const response = JSON.parse(lastCall);

			expect(response.payload.success).toBe(false);
			expect(response.payload.error).toContain("Model not found");
		});

		it("should return error for unsupported commands", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "bash", command: "ls" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = sendCalls[sendCalls.length - 1][0] as string;
			const response = JSON.parse(lastCall);

			expect(response.payload.success).toBe(false);
			expect(response.payload.error).toContain("not supported via bridge");
		});

		it("should emit command_error event on command dispatch failure", async () => {
			// Mock sendUserMessage to throw an error
			(context.pi.sendUserMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
				throw new Error("Dispatch failed");
			});

			const command: RpcCommand = { id: "cmd-1", type: "prompt", message: "Hello" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(emitEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "command_error",
					client,
					commandType: "prompt",
					correlationId: "cmd-1",
					error: "Dispatch failed",
				})
			);
		});
	});

	describe("extension UI routing", () => {
		it("should send fire-and-forget UI requests to the client", () => {
			const uiContext = adapter.createExtensionUIContext();

			uiContext.setTitle("Bridge UI");
			uiContext.setEditorText("draft text");

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
				JSON.parse(call[0] as string)
			);

			expect(sendCalls).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "extension_ui_request",
						payload: expect.objectContaining({ method: "setTitle", title: "Bridge UI" }),
					}),
					expect.objectContaining({
						type: "extension_ui_request",
						payload: expect.objectContaining({ method: "set_editor_text", text: "draft text" }),
					}),
				])
			);
		});

		it("should send UI request and wait for response", async () => {
			const uiContext = adapter.createExtensionUIContext();

			// Start select request
			const selectPromise = uiContext.select("Choose one", ["a", "b", "c"]);

			// Should have sent a UI request
			await new Promise((r) => setTimeout(r, 10));
			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);

			expect(lastCall.type).toBe("extension_ui_request");
			expect(lastCall.payload.method).toBe("select");
			expect(lastCall.payload).toHaveProperty("id");

			// Simulate client response
			const requestId = lastCall.payload.id;
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(
					JSON.stringify({
						type: "extension_ui_response",
						payload: { type: "extension_ui_response", id: requestId, value: "a" } as RpcExtensionUIResponse,
					})
				)
			);

			const result = await selectPromise;
			expect(result).toBe("a");
		});

		it("should handle UI request timeout", async () => {
			const shortTimeoutConfig = { ...DEFAULT_BRIDGE_CONFIG, uiRequestTimeout: 50 };
			const shortAdapter = new WsRpcAdapter(
				client,
				ws,
				context,
				shortTimeoutConfig,
				eventBus,
				emitEvent
			);

			const uiContext = shortAdapter.createExtensionUIContext();

			// Start confirm request
			const confirmPromise = uiContext.confirm("Are you sure?", "This will delete everything");

			// Wait for timeout
			const result = await confirmPromise;

			// Should return default value (false for confirm)
			expect(result).toBe(false);
		});

		it("should handle UI response for unknown request gracefully", async () => {
			// Send response for non-existent request
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(
					JSON.stringify({
						type: "extension_ui_response",
						payload: {
							type: "extension_ui_response",
							id: "unknown-id",
							value: "test",
						} as RpcExtensionUIResponse,
					})
				)
			);

			await new Promise((r) => setTimeout(r, 10));

			// Should not throw, just log a warning
			expect(ws.send).not.toHaveBeenCalledWith(expect.stringContaining("error"));
		});

		it("should handle cancelled UI response", async () => {
			const uiContext = adapter.createExtensionUIContext();

			// Start input request
			const inputPromise = uiContext.input("Enter name");

			await new Promise((r) => setTimeout(r, 10));
			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
			const requestId = lastCall.payload.id;

			// Send cancelled response
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(
					JSON.stringify({
						type: "extension_ui_response",
						payload: { type: "extension_ui_response", id: requestId, cancelled: true } as RpcExtensionUIResponse,
					})
				)
			);

			const result = await inputPromise;
			expect(result).toBeUndefined();
		});
	});

	describe("event fan-out", () => {
		it("should broadcast Pi events via eventBus", () => {
			// Get the agent_start handler registered in subscribeToEvents
			const agentStartHandler = (context.pi.on as ReturnType<typeof vi.fn>).mock.calls.find(
				(call) => call[0] === "agent_start"
			)?.[1];

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
			(ws as unknown as { trigger: (event: string, err: Error) => void }).trigger("error", new Error("Connection lost"));

			expect(emitEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "command_error",
					client,
					commandType: "websocket",
				})
			);
		});

		it("should handle JSON parse errors", async () => {
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger("message", Buffer.from("invalid json"));

			await new Promise((r) => setTimeout(r, 10));

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);

			expect(lastCall.type).toBe("response");
			expect(lastCall.payload.success).toBe(false);
			expect(lastCall.payload.error).toContain("Failed to parse");
		});

		it("should handle unknown message types", async () => {
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "unknown_type" }))
			);

			await new Promise((r) => setTimeout(r, 10));

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);

			expect(lastCall.type).toBe("response");
			expect(lastCall.payload.success).toBe(false);
			expect(lastCall.payload.error).toContain("Unknown message type");
		});
	});

	describe("disposal", () => {
		it("should resolve pending UI requests on dispose", async () => {
			const uiContext = adapter.createExtensionUIContext();

			// Start a request
			const selectPromise = uiContext.select("Choose", ["a", "b"]);
			await new Promise((r) => setTimeout(r, 10));

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

			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: { type: "get_state" } }))
			);
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(ws.send).not.toHaveBeenCalled();
		});
	});

	describe("command correlation", () => {
		it("should use provided correlation ID", async () => {
			const command: RpcCommand = { id: "my-correlation-id", type: "get_state" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(emitEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					correlationId: "my-correlation-id",
				})
			);
		});

		it("should generate correlation ID if not provided", async () => {
			const command: RpcCommand = { type: "get_state" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			const call = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.find(
				(call: unknown[]) => (call[0] as { type: string }).type === "command_received"
			);
			expect(call).toBeDefined();

			const event = call?.[0] as { correlationId: string };
			expect(typeof event.correlationId).toBe("string");
			expect(event.correlationId).toHaveLength(36); // UUID length
		});
	});

	describe("session commands", () => {
		it("should handle set_session_name with valid name", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "set_session_name", name: "New Session Name" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(context.pi.setSessionName).toHaveBeenCalledWith("New Session Name");

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
			expect(lastCall.payload.success).toBe(true);
		});

		it("should reject empty session name", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "set_session_name", name: "   " };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
			expect(lastCall.payload.success).toBe(false);
			expect(lastCall.payload.error).toContain("cannot be empty");
		});

		it("should handle new_session command", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "new_session" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(context.ctx.newSession).toHaveBeenCalled();

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
			expect(lastCall.payload.success).toBe(true);
		});

		it("should handle fork command", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "fork", entryId: "entry-123" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(context.ctx.fork).toHaveBeenCalledWith("entry-123");

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
			expect(lastCall.payload.success).toBe(true);
		});

		it("should handle switch_session command", async () => {
			const command: RpcCommand = { id: "cmd-1", type: "switch_session", sessionPath: "/path/to/session.json" };
			(ws as unknown as { trigger: (event: string, data: Buffer) => void }).trigger(
				"message",
				Buffer.from(JSON.stringify({ type: "command", payload: command }))
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(context.ctx.switchSession).toHaveBeenCalledWith("/path/to/session.json");

			const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = JSON.parse(sendCalls[sendCalls.length - 1][0] as string);
			expect(lastCall.payload.success).toBe(true);
		});
	});
});
