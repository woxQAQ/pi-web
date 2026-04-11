/**
 * Integration test for the Pi Web Bridge
 *
 * Starts a real HTTP+WS server with mock extension API,
 * connects a WS client, sends commands, and verifies responses.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";
import { WebSocket } from "ws";
import { startBridge, type BridgeController } from "../lifecycle.js";
import { createBridgeTerminalView } from "../terminal-log-view.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeEvent } from "../types.js";
import type { WsRpcAdapterContext } from "../ws-rpc-adapter.js";

// Test timeout for async operations
const TEST_TIMEOUT = 10000;

describe("Bridge Integration", () => {
	// Create mock Pi extension context
	const createMockContext = (): WsRpcAdapterContext => ({
		pi: {
			sendUserMessage: vi.fn(),
			setModel: vi.fn().mockResolvedValue(true),
			setThinkingLevel: vi.fn(),
			getThinkingLevel: vi.fn().mockReturnValue("normal"),
			setSessionName: vi.fn(),
			getSessionName: vi.fn().mockReturnValue("Test Session"),
			getCommands: vi.fn().mockReturnValue([
				{ name: "/test", description: "Test command", source: "extension" },
			]),
			on: vi.fn(),
		},
		ctx: {
			sessionManager: {
				getBranch: vi.fn().mockReturnValue([
					{ role: "user", content: "Hello" },
					{ role: "assistant", content: "Hi there!" },
				]),
				messages: [
					{ role: "user", content: "Hello" },
					{ role: "assistant", content: "Hi there!" },
				],
				sessionId: "test-session-123",
				sessionFile: "/test/session.json",
				sessionName: "Test Session",
			},
			model: { id: "test-model", provider: "test" },
			modelRegistry: {
				getAvailable: vi.fn().mockResolvedValue([
					{ provider: "test", id: "model-a", name: "Model A" },
					{ provider: "test", id: "model-b", name: "Model B" },
				]),
			},
			isIdle: vi.fn().mockReturnValue(true),
			signal: undefined,
			abort: vi.fn(),
			compact: vi.fn(),
			shutdown: vi.fn(),
			hasPendingMessages: vi.fn().mockReturnValue(false),
			getContextUsage: vi.fn().mockReturnValue({
				tokens: 100,
				contextWindow: 1000,
				percent: 10,
			}),
			getSystemPrompt: vi.fn().mockReturnValue("test system prompt"),
			waitForIdle: vi.fn().mockResolvedValue(undefined),
			newSession: vi.fn().mockResolvedValue({ cancelled: false }),
			fork: vi.fn().mockResolvedValue({ cancelled: false }),
			navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
			switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
		},
	});

	// Store original SIGINT listeners
	const originalSigintListeners: Array<NodeJS.SignalsListener> = [];

	let mockContext: WsRpcAdapterContext;
	let controller: BridgeController | undefined;
	let events: BridgeEvent[];

	beforeEach(() => {
		mockContext = createMockContext();
		events = [];

		// Capture existing SIGINT listeners
		const listeners = process.listeners("SIGINT");
		originalSigintListeners.length = 0;
		originalSigintListeners.push(...listeners);
		listeners.forEach((l) => process.off("SIGINT", l));
	});

	afterEach(async () => {
		// Stop controller if running
		if (controller?.getState().status === "running") {
			await controller.stop();
		}
		controller = undefined;

		// Restore original SIGINT listeners
		process.removeAllListeners("SIGINT");
		originalSigintListeners.forEach((l) => process.on("SIGINT", l));
	});

	describe("Server Lifecycle", () => {
		it(
			"should start server and bind to a port",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const state = controller.getState();
				expect(state.status).toBe("running");
				if (state.status === "running") {
					expect(state.port).toBeGreaterThan(0);
					expect(state.host).toBe(config.host);
				}
			},
			TEST_TIMEOUT
		);

		it(
			"should publish shutdown lifecycle events to subscribers",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				controller.subscribe((event) => events.push(event));
				await controller.stop();

				expect(events.some((e) => e.type === "server_stop")).toBe(true);
				expect(events.some((e) => e.type === "shutdown_complete")).toBe(true);
			},
			TEST_TIMEOUT
		);
	});

	describe("WebSocket Client Connection", () => {
		it(
			"should accept WebSocket connections",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;

				// Connect WebSocket client
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				expect(ws.readyState).toBe(WebSocket.OPEN);

				ws.close();
				await new Promise((resolve) => setTimeout(resolve, 100));
			},
			TEST_TIMEOUT
		);

		it(
			"should emit client_connect and client_disconnect events",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				controller.subscribe((event) => events.push(event));

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				// Wait for client_connect event
				await new Promise((resolve) => setTimeout(resolve, 100));

				ws.close();

				// Wait for client_disconnect event
				await new Promise((resolve) => setTimeout(resolve, 100));

				expect(events.some((e) => e.type === "client_connect")).toBe(true);
				expect(events.some((e) => e.type === "client_disconnect")).toBe(true);
			},
			TEST_TIMEOUT
		);
	});

	describe("RPC Command Dispatch", () => {
		it(
			"should handle get_state command",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				// Send get_state command
				const commandId = "test-cmd-1";
				const command = {
					type: "command",
					payload: {
						id: commandId,
						type: "get_state",
					},
				};

				const responsePromise = new Promise<unknown>((resolve, reject) => {
					ws.on("message", (data) => {
						try {
							const msg = JSON.parse(data.toString());
							if (msg.type === "response" && msg.payload?.id === commandId) {
								resolve(msg.payload);
							}
						} catch {
							// Ignore parse errors
						}
					});
					setTimeout(() => reject(new Error("Response timeout")), 5000);
				});

				ws.send(JSON.stringify(command));

				const response = await responsePromise;

				expect(response).toMatchObject({
					type: "response",
					command: "get_state",
					success: true,
					data: {
						sessionId: "test-session-123",
						sessionName: "Test Session",
						messageCount: 2,
						pendingMessageCount: 0,
						isStreaming: false,
						steeringMode: "all",
						followUpMode: "all",
					},
				});

				ws.close();
			},
			TEST_TIMEOUT
		);

		it(
			"should handle get_commands command",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				const commandId = "test-cmd-2";
				const command = {
					type: "command",
					payload: {
						id: commandId,
						type: "get_commands",
					},
				};

				const responsePromise = new Promise<unknown>((resolve, reject) => {
					ws.on("message", (data) => {
						try {
							const msg = JSON.parse(data.toString());
							if (msg.type === "response" && msg.payload?.id === commandId) {
								resolve(msg.payload);
							}
						} catch {
							// Ignore parse errors
						}
					});
					setTimeout(() => reject(new Error("Response timeout")), 5000);
				});

				ws.send(JSON.stringify(command));

				const response = (await responsePromise) as {
					type: string;
					command: string;
					success: boolean;
					data: { commands: Array<{ name: string }> };
				};

				expect(response.success).toBe(true);
				expect(response.data.commands).toHaveLength(1);
				expect(response.data.commands[0].name).toBe("/test");

				ws.close();
			},
			TEST_TIMEOUT
		);

		it(
			"should handle prompt command",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				const commandId = "test-cmd-3";
				const command = {
					type: "command",
					payload: {
						id: commandId,
						type: "prompt",
						message: "Hello from bridge",
					},
				};

				const responsePromise = new Promise<unknown>((resolve, reject) => {
					ws.on("message", (data) => {
						try {
							const msg = JSON.parse(data.toString());
							if (msg.type === "response" && msg.payload?.id === commandId) {
								resolve(msg.payload);
							}
						} catch {
							// Ignore parse errors
						}
					});
					setTimeout(() => reject(new Error("Response timeout")), 5000);
				});

				ws.send(JSON.stringify(command));

				const response = await responsePromise;

				expect(response).toMatchObject({
					type: "response",
					command: "prompt",
					success: true,
				});

				// Verify sendUserMessage was called
				expect(mockContext.pi.sendUserMessage).toHaveBeenCalledWith("Hello from bridge", {
					deliverAs: "steer",
				});

				ws.close();
			},
			TEST_TIMEOUT
		);

		it(
			"should handle unknown commands with error response",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				controller.subscribe((event) => events.push(event));

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				// Wait for client_connect
				await new Promise((resolve) => setTimeout(resolve, 100));

				const commandId = "test-cmd-4";
				const command = {
					type: "command",
					payload: {
						id: commandId,
						type: "unknown_command_xyz",
					},
				};

				const responsePromise = new Promise<unknown>((resolve, reject) => {
					ws.on("message", (data) => {
						try {
							const msg = JSON.parse(data.toString());
							if (msg.type === "response" && msg.payload?.id === commandId) {
								resolve(msg.payload);
							}
						} catch {
							// Ignore parse errors
						}
					});
					setTimeout(() => reject(new Error("Response timeout")), 5000);
				});

				ws.send(JSON.stringify(command));

				const response = (await responsePromise) as {
					success: boolean;
					error?: string;
				};

				expect(response.success).toBe(false);
				expect(response.error).toContain("unknown");

				ws.close();
			},
			TEST_TIMEOUT
		);
	});

	describe("Terminal Log View Integration", () => {
		it(
			"should create terminal view with bridge events",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const terminalView = createBridgeTerminalView(
					(handler) => controller!.subscribe(handler),
					() => controller!.getState(),
					() => controller!.getClients(),
					config
				);

				const renderOutput = terminalView.render();

				expect(renderOutput).toBeInstanceOf(Array);
				expect(renderOutput.length).toBeGreaterThan(0);
				expect(renderOutput.some((line) => line.includes("Pi Web Bridge"))).toBe(true);
				expect(renderOutput.some((line) => line.includes("Bridge:"))).toBe(true);

				terminalView.dispose();
			},
			TEST_TIMEOUT
		);

		it(
			"should update view when clients connect",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const terminalView = createBridgeTerminalView(
					(handler) => controller!.subscribe(handler),
					() => controller!.getState(),
					() => controller!.getClients(),
					config
				);

				// Initial render - no clients
				const initialRender = terminalView.render();
				expect(initialRender.some((line) => line.includes("Clients: 0"))).toBe(true);

				// Connect a client
				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				// Wait for event propagation
				await new Promise((resolve) => setTimeout(resolve, 100));

				// Re-render - should show client
				const updatedRender = terminalView.render();
				expect(updatedRender.some((line) => line.includes("Clients: 1"))).toBe(true);

				ws.close();
				terminalView.dispose();
			},
			TEST_TIMEOUT
		);
	});

	describe("Full Command Flow", () => {
		it(
			"should handle complete request-response cycle with multiple commands",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				// Helper to send command and wait for response
				const sendCommand = async (cmd: unknown): Promise<unknown> => {
					const cmdId = (cmd as { id?: string }).id || crypto.randomUUID();
					const commandWithId = { ...(cmd as object), id: cmdId };

					return new Promise((resolve, reject) => {
						const timeout = setTimeout(() => {
							reject(new Error(`Timeout waiting for response to ${cmdId}`));
						}, 5000);

						ws.on("message", (data) => {
							try {
								const msg = JSON.parse(data.toString());
								if (msg.type === "response" && msg.payload?.id === cmdId) {
									clearTimeout(timeout);
									resolve(msg.payload);
								}
							} catch {
								// Ignore parse errors
							}
						});

						ws.send(
							JSON.stringify({
								type: "command",
								payload: commandWithId,
							})
						);
					});
				};

				// Execute multiple commands
				const results = await Promise.all([
					sendCommand({ type: "get_state" }),
					sendCommand({ type: "get_commands" }),
					sendCommand({ type: "get_session_stats" }),
				]);

				// Verify all succeeded
				for (const result of results) {
					expect((result as { success: boolean }).success).toBe(true);
				}

				// Verify specific data
				const stateResult = results[0] as {
					success: boolean;
					data: { sessionId: string };
				};
				expect(stateResult.data.sessionId).toBe("test-session-123");

				const commandsResult = results[1] as {
					success: boolean;
					data: { commands: Array<{ name: string }> };
				};
				expect(commandsResult.data.commands).toHaveLength(1);

				ws.close();
			},
			TEST_TIMEOUT
		);
	});

	describe("Error Handling", () => {
		it(
			"should handle malformed JSON messages",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				const responsePromise = new Promise<unknown>((resolve, reject) => {
					ws.on("message", (data) => {
						try {
							const msg = JSON.parse(data.toString());
							if (msg.type === "response") {
								resolve(msg.payload);
							}
						} catch {
							// Ignore parse errors
						}
					});
					setTimeout(() => reject(new Error("Response timeout")), 5000);
				});

				// Send malformed JSON
				ws.send("this is not valid json{");

				const response = (await responsePromise) as {
					success: boolean;
					error?: string;
				};

				expect(response.success).toBe(false);
				expect(response.error).toContain("parse");

				ws.close();
			},
			TEST_TIMEOUT
		);

		it(
			"should handle unknown message types",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;
				const ws = new WebSocket(wsUrl);

				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				const responsePromise = new Promise<unknown>((resolve, reject) => {
					ws.on("message", (data) => {
						try {
							const msg = JSON.parse(data.toString());
							if (msg.type === "response") {
								resolve(msg.payload);
							}
						} catch {
							// Ignore parse errors
						}
					});
					setTimeout(() => reject(new Error("Response timeout")), 5000);
				});

				// Send unknown message type
				ws.send(
					JSON.stringify({
						type: "unknown_type",
						payload: {},
					})
				);

				const response = (await responsePromise) as {
					success: boolean;
					error?: string;
				};

				expect(response.success).toBe(false);
				expect(response.error).toContain("Unknown message type");

				ws.close();
			},
			TEST_TIMEOUT
		);
	});

	describe("SIGINT Handling", () => {
		it(
			"should emit sigint_received and shutdown_complete on SIGINT",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				controller = await startBridge(config, mockContext, vi.fn());

				controller.subscribe((event) => events.push(event));

				// Simulate SIGINT
				process.emit("SIGINT");

				// Wait for async shutdown
				await new Promise((resolve) => setTimeout(resolve, 200));

				expect(events.some((e) => e.type === "sigint_received")).toBe(true);
				expect(events.some((e) => e.type === "shutdown_complete")).toBe(true);

				// Controller should be stopped
				expect(controller.getState().status).toBe("stopped");
			},
			TEST_TIMEOUT
		);
	});

	describe("Lifecycle Events Verification", () => {
		it(
			"should emit all required lifecycle events",
			async () => {
				const config = { ...DEFAULT_BRIDGE_CONFIG, port: 0 };
				const allEvents: BridgeEvent[] = [];

				controller = await startBridge(config, mockContext, vi.fn());
				controller.subscribe((event) => allEvents.push(event));

				const address = controller.getState();
				if (address.status !== "running") {
					throw new Error("Bridge not running");
				}

				const wsUrl = `ws://${address.host}:${address.port}/ws`;

				// Connect a client
				const ws = new WebSocket(wsUrl);
				await new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				});

				// Wait for client_connect event
				await new Promise((resolve) => setTimeout(resolve, 100));

				// Send a command that will succeed
				ws.send(
					JSON.stringify({
						type: "command",
						payload: { type: "get_state" },
					})
				);

				// Wait for command_received event
				await new Promise((resolve) => setTimeout(resolve, 100));

				// Note: command_error is only emitted on dispatch exceptions, not for
				// commands that return error responses (like unsupported commands)
				// To trigger command_error, we would need a command that throws during dispatch

				// Disconnect client
				ws.close();
				await new Promise((resolve) => setTimeout(resolve, 100));

				// Stop the bridge
				await controller.stop();

				// Verify all lifecycle events were emitted
				const eventTypes = allEvents.map((e) => e.type);

				// Required events per slice verification:
				// - server_stop
				// - client_connect
				// - client_disconnect
				// - command_received
				// - shutdown_complete
				// Note: command_error is only emitted on dispatch exceptions

				expect(eventTypes).toContain("server_stop");
				expect(eventTypes).toContain("client_connect");
				expect(eventTypes).toContain("client_disconnect");
				expect(eventTypes).toContain("command_received");
				expect(eventTypes).toContain("shutdown_complete");
			},
			TEST_TIMEOUT
		);
	});
});
