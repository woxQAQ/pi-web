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
vi.stubGlobal("location", { protocol: "http:", host: "localhost:8080", search: "?token=test-token" });

// Provide a minimal document mock so Vue's runtime-dom can initialize.
// Vue's runtime-dom calls doc.createElement("div") at module load time.
vi.stubGlobal("document", {
	title: "",
	createElement: () => ({ style: {}, setAttribute: vi.fn(), addEventListener: vi.fn() }),
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
	vi.stubGlobal("location", { protocol: "http:", host: "localhost:8080", search: "?token=test-token" });
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

	it("shows an auth error and skips reconnect when token is missing", async () => {
		vi.stubGlobal("location", { protocol: "http:", host: "localhost:8080", search: "" });

		const client = await importComposable();

		expect(mockWsInstances).toHaveLength(0);
		expect(client.connectionError.value).toContain("Missing authentication token");
		expect(client.isReconnecting.value).toBe(false);
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
		const client = await importComposable();
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
