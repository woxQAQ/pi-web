import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import { WebSocket } from "ws";
import { BridgeEventBus } from "../bridge-event-bus.js";
import { BridgeServer } from "../server.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeEvent } from "../types.js";
import type { WsRpcAdapterContext } from "../ws-rpc-adapter.js";

const TOKEN = "test-auth-token-12345";

const waitForAsyncWork = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

const requestText = (
	url: string,
	options?: http.RequestOptions & { cookies?: Record<string, string> }
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> =>
	new Promise((resolve, reject) => {
		const parsedUrl = new URL(url);
		const opts: http.RequestOptions = {
			hostname: parsedUrl.hostname,
			port: parsedUrl.port,
			path: parsedUrl.pathname + parsedUrl.search,
			method: options?.method ?? "GET",
			headers: {} as Record<string, string>,
		};
		if (options?.cookies) {
			(opts.headers as Record<string, string>)["Cookie"] = Object.entries(options.cookies)
				.map(([k, v]) => `${k}=${v}`)
				.join("; ");
		}
		if (options?.headers) {
			Object.assign(opts.headers as Record<string, string>, options.headers);
		}
		const request = http.request(opts, (response) => {
			let body = "";
			response.on("data", (chunk) => {
				body += chunk;
			});
			response.on("end", () => {
				resolve({ status: response.statusCode ?? 0, body, headers: response.headers });
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
				(event) => events.push(event),
				TOKEN
			);

			const address = await server.start();

			expect(server.getIsRunning()).toBe(true);
			expect(address.port).toBeGreaterThan(0);
			expect(events).toContainEqual({ type: "server_start", host: "0.0.0.0", port: address.port });

			await server.stop();
		});

		it("rejects a second start while already running", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
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
				(event) => events.push(event),
				TOKEN
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
				(event) => events.push(event),
				TOKEN
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
			await new Promise<void>((resolve) => occupiedServer.listen(0, "127.0.0.1", () => resolve()));

			const address = occupiedServer.address();
			if (!address || typeof address === "string") {
				throw new Error("failed to get occupied port");
			}

			const preferredPort = address.port;
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, host: "127.0.0.1", port: preferredPort, portMax: preferredPort + 3 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
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
				(event) => events.push(event),
				TOKEN
			);

			const address = await server.start();
			expect(address.port).toBeGreaterThan(0);
			expect(server.getAddress()).toEqual({ host: "0.0.0.0", port: address.port });

			await server.stop();
		});
	});

	describe("HTTP token authentication", () => {
		it("rejects HTTP GET without token with 401", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/`);
			expect(response.status).toBe(401);
			expect(response.body).toBe("Unauthorized");

			await server.stop();
		});

		it("allows HTTP GET with valid query param token and sets cookie", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/?token=${TOKEN}`);
			expect(response.status).toBe(200);
			expect(response.body).toContain("Pi Web Bridge");
			// Verify Set-Cookie header
			const setCookie = response.headers["set-cookie"];
			expect(setCookie).toBeDefined();
			expect(setCookie!.some((c: string) => c.startsWith(`pi_token=${TOKEN}`))).toBe(true);

			await server.stop();
		});

		it("allows HTTP GET with valid cookie token", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/`, {
				cookies: { pi_token: TOKEN },
			});
			expect(response.status).toBe(200);
			expect(response.body).toContain("Pi Web Bridge");

			await server.stop();
		});

		it("rejects HTTP GET with wrong cookie token", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/`, {
				cookies: { pi_token: "wrong-token" },
			});
			expect(response.status).toBe(401);

			await server.stop();
		});
	});

	describe("HTTP static file serving", () => {
		it("serves placeholder HTML at the root when no staticDir is configured", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/?token=${TOKEN}`);
			expect(response.status).toBe(200);
			expect(response.body).toContain("Pi Web Bridge");
			expect(response.body).toContain(`http://localhost:${address.port}`);

			await server.stop();
		});

		it("returns 404 for unknown files when no staticDir is configured", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/some-file.js?token=${TOKEN}`);
			expect(response.status).toBe(404);
			expect(response.body).toContain("Not Found");

			await server.stop();
		});

		it("rejects non-GET methods", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			const response = await requestText(`http://localhost:${address.port}/?token=${TOKEN}`, { method: "POST" });
			expect(response.status).toBe(405);
			expect(response.body).toContain("Method Not Allowed");

			await server.stop();
		});
	});

	describe("WS token authentication", () => {
		it("rejects WS connect without token", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			let closed = false;
			const ws = new WebSocket(`ws://localhost:${address.port}/ws`);
			await new Promise<void>((resolve) => {
				ws.on("close", () => {
					closed = true;
					resolve();
				});
				ws.on("error", () => {
					// Connection may error before close
				});
			});
			expect(closed).toBe(true);
			expect(server.getClientCount()).toBe(0);

			await server.stop();
		});

		it("rejects WS connect with wrong token", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			let closed = false;
			const ws = new WebSocket(`ws://localhost:${address.port}/ws?token=wrong`);
			await new Promise<void>((resolve) => {
				ws.on("close", () => {
					closed = true;
					resolve();
				});
				ws.on("error", () => {});
			});
			expect(closed).toBe(true);
			expect(server.getClientCount()).toBe(0);

			await server.stop();
		});

		it("accepts WS connect with valid token", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			const ws = new WebSocket(`ws://localhost:${address.port}/ws?token=${TOKEN}`);
			await new Promise<void>((resolve, reject) => {
				ws.once("open", () => resolve());
				ws.once("error", reject);
			});
			expect(ws.readyState).toBe(WebSocket.OPEN);

			ws.close();
			await server.stop();
		});
	});

	describe("client tracking", () => {
		it("reflects WebSocket clients as they connect and disconnect", async () => {
			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0 },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			expect(server.getClientCount()).toBe(0);
			expect(server.getClients()).toEqual([]);

			const ws = new WebSocket(`ws://localhost:${address.port}/ws?token=${TOKEN}`);
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

	describe("staticDir serving", () => {
		it("serves files from staticDir instead of placeholder", async () => {
			const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
			const { join } = await import("node:path");
			const { tmpdir } = await import("node:os");

			const tmpDir = mkdtempSync(join(tmpdir(), "bridge-static-test-"));
			writeFileSync(join(tmpDir, "index.html"), "<h1>Real Bundle</h1>");
			writeFileSync(join(tmpDir, "app.js"), 'console.log("app");');

			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0, staticDir: tmpDir },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			try {
				// Root should serve the real index.html
				const indexResponse = await requestText(`http://localhost:${address.port}/?token=${TOKEN}`);
				expect(indexResponse.status).toBe(200);
				expect(indexResponse.body).toContain("<h1>Real Bundle</h1>");
				expect(indexResponse.body).not.toContain("Pi Web Bridge");

				// JS asset should be served
				const jsResponse = await requestText(`http://localhost:${address.port}/app.js?token=${TOKEN}`);
				expect(jsResponse.status).toBe(200);
				expect(jsResponse.body).toContain('console.log("app");');

				// Unknown path should fall back to index.html (SPA routing)
				const spaResponse = await requestText(`http://localhost:${address.port}/some-route?token=${TOKEN}`);
				expect(spaResponse.status).toBe(200);
				expect(spaResponse.body).toContain("<h1>Real Bundle</h1>");
			} finally {
				await server.stop();
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("rejects directory traversal attempts against staticDir", async () => {
			const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import("node:fs");
			const { join } = await import("node:path");
			const { tmpdir } = await import("node:os");

			const tmpDir = mkdtempSync(join(tmpdir(), "bridge-traversal-test-"));
			const secretDir = join(tmpDir, "secret");
			mkdirSync(secretDir);
			writeFileSync(join(secretDir, "key.txt"), "secret-key");
			writeFileSync(join(tmpDir, "index.html"), "<h1>Safe</h1>");

			const server = new BridgeServer(
				{ ...DEFAULT_BRIDGE_CONFIG, port: 0, staticDir: tmpDir },
				mockContext,
				eventBus,
				(event) => events.push(event),
				TOKEN
			);
			const address = await server.start();

			try {
				// The server normalizes paths, so /../../../etc/passwd becomes /etc/passwd
				// which doesn't start with staticDir — that should 404/fallback
				const traversalResponse = await requestText(
					`http://localhost:${address.port}/../../../etc/passwd?token=${TOKEN}`
				);
				// Path is normalized and doesn't match staticDir prefix → fallback to index.html (SPA)
				expect(traversalResponse.status).toBe(200);
				expect(traversalResponse.body).toContain("<h1>Safe</h1>");
				expect(traversalResponse.body).not.toContain("secret-key");

				// The secret file within staticDir should be accessible (it's a real file)
				// but URLs that resolve outside staticDir should not expose anything
				const insideResponse = await requestText(
					`http://localhost:${address.port}/secret/key.txt?token=${TOKEN}`
				);
				expect(insideResponse.status).toBe(200);
				expect(insideResponse.body).toContain("secret-key");
			} finally {
				await server.stop();
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});
});
