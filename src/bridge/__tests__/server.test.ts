import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import { WebSocket } from "ws";
import { BridgeEventBus } from "../bridge-event-bus.js";
import { BridgeServer } from "../server.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeEvent } from "../types.js";
import type { WsRpcAdapterContext } from "../ws-rpc-adapter.js";

const waitForAsyncWork = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

const requestText = (
	url: string,
	options?: http.RequestOptions
): Promise<{ status: number; body: string }> =>
	new Promise((resolve, reject) => {
		const request = http.request(url, options ?? {}, (response) => {
			let body = "";
			response.on("data", (chunk) => {
				body += chunk;
			});
			response.on("end", () => {
				resolve({ status: response.statusCode ?? 0, body });
			});
		});
		request.on("error", reject);
		request.setTimeout(5000, () => {
			request.destroy();
			reject(new Error("request timeout"));
		});
		request.end();
	});

describe("BridgeServer", () => {
	const createMockContext = (): WsRpcAdapterContext => ({
		pi: {
			sendUserMessage: vi.fn(),
			setModel: vi.fn().mockResolvedValue(true),
			setThinkingLevel: vi.fn(),
			getThinkingLevel: vi.fn().mockReturnValue("normal"),
			setSessionName: vi.fn(),
			getSessionName: vi.fn().mockReturnValue(undefined),
			getCommands: vi.fn().mockReturnValue([]),
			on: vi.fn(),
		},
		ctx: {
			sessionManager: {
				getBranch: vi.fn().mockReturnValue([]),
				messages: [],
				sessionId: "test-session",
				sessionFile: "/test/session.json",
				sessionName: "Test Session",
			},
			model: { id: "test-model", provider: "test" },
			modelRegistry: {
				getAvailable: vi.fn().mockResolvedValue([]),
			},
			isIdle: vi.fn().mockReturnValue(true),
			signal: undefined,
			abort: vi.fn(),
			compact: vi.fn(),
			shutdown: vi.fn(),
			hasPendingMessages: vi.fn().mockReturnValue(false),
			getContextUsage: vi.fn().mockReturnValue({ tokens: 100, contextWindow: 1000, percent: 10 }),
			getSystemPrompt: vi.fn().mockReturnValue("test prompt"),
			waitForIdle: vi.fn().mockResolvedValue(undefined),
			newSession: vi.fn().mockResolvedValue({ cancelled: false }),
			fork: vi.fn().mockResolvedValue({ cancelled: false }),
			navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
			switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
		},
	});

	let eventBus: BridgeEventBus;
	let mockContext: WsRpcAdapterContext;
	let events: BridgeEvent[];

	beforeEach(() => {
		eventBus = new BridgeEventBus(DEFAULT_BRIDGE_CONFIG);
		mockContext = createMockContext();
		events = [];
	});

	afterEach(() => {
		eventBus.dispose();
	});

	describe("lifecycle", () => {
		it("starts on an available port and emits server_start", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);

			const address = await server.start();

			expect(server.getIsRunning()).toBe(true);
			expect(address.port).toBeGreaterThan(0);
			expect(events).toContainEqual({ type: "server_start", host: "localhost", port: address.port });

			await server.stop();
		});

		it("rejects a second start while already running", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);

			await server.start();
			await expect(server.start()).rejects.toThrow("Server is already running");

			await server.stop();
		});

		it("stops gracefully and clears its address", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);

			await server.start();
			await server.stop();

			expect(server.getIsRunning()).toBe(false);
			expect(server.getAddress()).toBeUndefined();
			expect(events).toContainEqual({ type: "server_stop" });
		});

		it("can restart after a full stop", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);

			const first = await server.start();
			await server.stop();
			const second = await server.start();

			expect(first.port).toBeGreaterThan(0);
			expect(second.port).toBeGreaterThan(0);
			expect(server.getIsRunning()).toBe(true);

			await server.stop();
		});
	});

	describe("port fallback", () => {
		it("falls back within the configured port range when the preferred port is taken", async () => {
			const occupiedServer = http.createServer((_req, res) => {
				res.writeHead(200);
				res.end("occupied");
			});
			await new Promise<void>((resolve) => occupiedServer.listen(0, "localhost", () => resolve()));

			const address = occupiedServer.address();
			if (!address || typeof address === "string") {
				throw new Error("failed to get occupied port");
			}

			const preferredPort = address.port;
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: preferredPort, portMax: preferredPort + 3 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);

			try {
				const bridgeAddress = await server.start();
				expect(bridgeAddress.port).not.toBe(preferredPort);
				expect(bridgeAddress.port).toBeGreaterThan(preferredPort);
				expect(bridgeAddress.port).toBeLessThanOrEqual(preferredPort + 3);
			} finally {
				await server.stop();
				await new Promise<void>((resolve, reject) => {
					occupiedServer.close((error) => {
						if (error) reject(error);
						else resolve();
					});
				});
			}
		});

		it("uses an OS-assigned port when configured with port 0", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);

			const address = await server.start();
			expect(address.port).toBeGreaterThan(0);
			expect(server.getAddress()).toEqual({ host: "localhost", port: address.port });

			await server.stop();
		});
	});

	describe("HTTP static file serving", () => {
		it("serves placeholder HTML at the root when no staticDir is configured", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/`);
			expect(response.status).toBe(200);
			expect(response.body).toContain("Pi Web Bridge");
			expect(response.body).toContain(`ws://${address.host}:${address.port}/ws`);

			await server.stop();
		});

		it("returns 404 for unknown files when no staticDir is configured", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/some-file.js`);
			expect(response.status).toBe(404);
			expect(response.body).toContain("Not Found");

			await server.stop();
		});

		it("rejects non-GET methods", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/`, { method: "POST" });
			expect(response.status).toBe(405);
			expect(response.body).toContain("Method Not Allowed");

			await server.stop();
		});
	});

	describe("client tracking", () => {
		it("reflects WebSocket clients as they connect and disconnect", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event)
			);
			const address = await server.start();

			expect(server.getClientCount()).toBe(0);
			expect(server.getClients()).toEqual([]);

			const ws = new WebSocket(`ws://localhost:${address.port}/ws`);
			await new Promise<void>((resolve, reject) => {
				ws.once("open", () => resolve());
				ws.once("error", reject);
			});
			await waitForAsyncWork();

			const clients = server.getClients();
			expect(server.getClientCount()).toBe(1);
			expect(clients).toHaveLength(1);
			expect(clients[0].id).toBeTruthy();
			expect(clients[0].connectedAt).toBeTruthy();

			ws.close();
			await waitForAsyncWork();

			expect(server.getClientCount()).toBe(0);
			expect(server.getClients()).toEqual([]);
			expect(events.map((event) => event.type)).toContain("client_connect");
			expect(events.map((event) => event.type)).toContain("client_disconnect");

			await server.stop();
		});
	});
});
