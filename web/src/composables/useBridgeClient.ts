import { ref, readonly, onUnmounted } from "vue";
import type {
	RpcCommand,
	RpcResponse,
	RpcSessionState,
	RpcSlashCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	ClientMessage,
	ServerMessage,
} from "../shared-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/** Minimal shape of a message entry from get_messages / message events. */
export interface TranscriptEntry {
	id?: string;
	role: string;
	content?: unknown;
	text?: string;
	timestamp?: string;
	[key: string]: unknown;
}

export interface SessionEntry {
	id: string;
	name: string;
	path: string;
}

export interface TreeEntry {
	id: string;
	label?: string;
	type: string;
	timestamp?: string;
}

// ---------------------------------------------------------------------------
// State refs
// ---------------------------------------------------------------------------

const connectionStatus = ref<ConnectionStatus>("disconnected");
const transcript = ref<TranscriptEntry[]>([]);
const sessionState = ref<RpcSessionState | null>(null);
const sessions = ref<SessionEntry[]>([]);
const treeEntries = ref<TreeEntry[]>([]);
const commands = ref<RpcSlashCommand[]>([]);
const isStreaming = ref(false);

// ---------------------------------------------------------------------------
// Extension UI state
// ---------------------------------------------------------------------------

/** Current dialog-requiring extension UI request, or null. */
const pendingExtensionRequest = ref<RpcExtensionUIRequest | null>(null);

/** Toast notification entries from extension notify calls. */
const notifications = ref<
	Array<{ message: string; notifyType?: string; id: string }>
>([]);

/** Status bar entries from extension setStatus calls. */
const statusEntries = ref<Record<string, string>>({});

/** Widget entries from extension setWidget calls. */
const widgetEntries = ref<
	Record<string, { lines: string[]; placement?: string }>
>({});

/** Prefill text from set_editor_text, consumed by ComposerBar. */
const prefillText = ref<string | null>(null);

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;
let disposed = false;

/** Pending RPC requests keyed by correlation id. */
const pendingRequests = new Map<
	string,
	{
		resolve: (response: RpcResponse) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}
>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetReconnectDelay() {
	reconnectDelay = 1000;
}

function scheduleReconnect() {
	if (reconnectTimer) clearTimeout(reconnectTimer);
	reconnectTimer = setTimeout(() => {
		if (!disposed) connect();
	}, reconnectDelay);
	reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function sendEnvelope(msg: ClientMessage) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg));
	}
}

function sendCommand(payload: RpcCommand): Promise<RpcResponse> {
	return new Promise((resolve, reject) => {
		const id = payload.id ?? crypto.randomUUID();
		const command = { ...payload, id };
		const timer = setTimeout(() => {
			pendingRequests.delete(id);
			reject(new Error(`RPC timeout: ${command.type}`));
		}, 15_000);
		pendingRequests.set(id, { resolve, reject, timer });
		sendEnvelope({ type: "command", payload: command });
	});
}

function sendPrompt(message: string) {
	sendEnvelope({
		type: "command",
		payload: { type: "prompt", message, streamingBehavior: "steer" },
	});
}

/** Send a response back to the server resolving a pending extension UI request. */
function respondToUIRequest(payload: RpcExtensionUIResponse) {
	pendingExtensionRequest.value = null;
	sendEnvelope({ type: "extension_ui_response", payload });
}

/** Remove a toast notification by its id. */
function dismissNotification(id: string) {
	notifications.value = notifications.value.filter((n) => n.id !== id);
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleServerMessage(raw: MessageEvent) {
	let envelope: ServerMessage;
	try {
		envelope = JSON.parse(raw.data as string) as ServerMessage;
	} catch {
		return;
	}

	if (envelope.type === "response") {
		handleResponse(envelope.payload);
	} else if (envelope.type === "event") {
		handleEvent(envelope.payload as Record<string, unknown>);
	} else if (envelope.type === "extension_ui_request") {
		handleExtensionUIRequest(envelope.payload as RpcExtensionUIRequest);
	}
}

function handleResponse(payload: RpcResponse) {
	// Resolve pending request if correlated
	if (payload.id) {
		const pending = pendingRequests.get(payload.id);
		if (pending) {
			clearTimeout(pending.timer);
			pendingRequests.delete(payload.id);
			pending.resolve(payload);
		}
	}

	// Also update local state from specific response types
	if (payload.success) {
		switch (payload.command) {
			case "get_messages": {
				const data = payload.data as { messages: TranscriptEntry[] } | undefined;
				if (data) transcript.value = data.messages;
				break;
			}
			case "get_state": {
				const data = payload.data as RpcSessionState | undefined;
				if (data) {
					sessionState.value = data;
					isStreaming.value = data.isStreaming;
				}
				break;
			}
			case "list_sessions": {
				const data = payload.data as { sessions: SessionEntry[] } | undefined;
				if (data) sessions.value = data.sessions;
				break;
			}
			case "list_tree_entries": {
				const data = payload.data as { entries: TreeEntry[] } | undefined;
				if (data) treeEntries.value = data.entries;
				break;
			}
			case "get_commands": {
				const data = payload.data as { commands: RpcSlashCommand[] } | undefined;
				if (data) commands.value = data.commands;
				break;
			}
		}
	}
}

function handleEvent(payload: Record<string, unknown>) {
	const eventType = payload.type as string;

	switch (eventType) {
		case "message_start": {
			isStreaming.value = true;
			const msg = payload as unknown as TranscriptEntry;
			if (msg.role) {
				transcript.value = [...transcript.value, msg];
			}
			break;
		}
		case "message_update": {
			// Update the last message with matching id, or append
			const msg = payload as unknown as TranscriptEntry;
			const idx = msg.id
				? transcript.value.findIndex((m) => m.id === msg.id)
				: transcript.value.length - 1;
			if (idx >= 0) {
				const updated = [...transcript.value];
				updated[idx] = { ...updated[idx], ...msg };
				transcript.value = updated;
			} else {
				transcript.value = [...transcript.value, msg];
			}
			break;
		}
		case "message_end": {
			const msg = payload as unknown as TranscriptEntry;
			if (msg.id) {
				const idx = transcript.value.findIndex((m) => m.id === msg.id);
				if (idx >= 0) {
					const updated = [...transcript.value];
					updated[idx] = { ...updated[idx], ...msg };
					transcript.value = updated;
				}
			}
			break;
		}
		case "agent_start": {
			isStreaming.value = true;
			break;
		}
		case "agent_end": {
			isStreaming.value = false;
			// Refresh state after agent completes
			sendCommand({ type: "get_state" }).catch(() => {});
			break;
		}
	}
}

/** Handle extension UI requests routed from Pi over the WebSocket. */
function handleExtensionUIRequest(payload: RpcExtensionUIRequest) {
	switch (payload.method) {
		case "select":
		case "confirm":
		case "input":
		case "editor":
			// Dialog-requiring methods: store for UI to render
			pendingExtensionRequest.value = payload;
			break;
		case "notify":
			notifications.value = [
				...notifications.value,
				{
					message: payload.message,
					notifyType: payload.notifyType,
					id: payload.id,
				},
			];
			break;
		case "setTitle":
			document.title = payload.title;
			break;
		case "set_editor_text":
			prefillText.value = payload.text;
			break;
		case "setStatus":
			statusEntries.value = {
				...statusEntries.value,
				[payload.statusKey]: payload.statusText ?? "",
			};
			break;
		case "setWidget":
			if (payload.widgetLines) {
				widgetEntries.value = {
					...widgetEntries.value,
					[payload.widgetKey]: {
						lines: payload.widgetLines,
						placement: payload.widgetPlacement,
					},
				};
			} else {
				// undefined widgetLines means remove
				const { [payload.widgetKey]: _, ...rest } = widgetEntries.value;
				widgetEntries.value = rest;
			}
			break;
	}
}

// ---------------------------------------------------------------------------
// Initial data fetch after connection
// ---------------------------------------------------------------------------

async function fetchInitialState() {
	try {
		await Promise.all([
			sendCommand({ type: "get_state" }),
			sendCommand({ type: "get_messages" }),
			sendCommand({ type: "list_sessions" }),
			sendCommand({ type: "list_tree_entries" }),
			sendCommand({ type: "get_commands" }),
		]);
	} catch {
		// Individual errors already handled by reject; swallow aggregate
	}
}

// ---------------------------------------------------------------------------
// Connect / disconnect
// ---------------------------------------------------------------------------

function connect() {
	if (disposed) return;

	connectionStatus.value = "connecting";
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	const wsUrl = `${protocol}//${location.host}/ws`;
	ws = new WebSocket(wsUrl);

	ws.addEventListener("open", () => {
		connectionStatus.value = "connected";
		resetReconnectDelay();
		fetchInitialState();
	});

	ws.addEventListener("close", () => {
		connectionStatus.value = "disconnected";
		// Clear extension UI state
		pendingExtensionRequest.value = null;
		notifications.value = [];
		// Clear pending requests
		for (const [id, pending] of pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error("WebSocket closed"));
			pendingRequests.delete(id);
		}
		scheduleReconnect();
	});

	ws.addEventListener("error", () => {
		connectionStatus.value = "disconnected";
		scheduleReconnect();
	});

	ws.addEventListener("message", handleServerMessage);
}

function disconnect() {
	disposed = true;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (ws) {
		ws.close();
		ws = null;
	}
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useBridgeClient() {
	onUnmounted(() => {
		disconnect();
	});

	// Auto-connect on first use if not already connected
	if (!ws && !disposed) {
		connect();
	}

	return {
		connectionStatus: readonly(connectionStatus),
		transcript: readonly(transcript),
		sessionState: readonly(sessionState),
		sessions: readonly(sessions),
		treeEntries: readonly(treeEntries),
		commands: readonly(commands),
		isStreaming: readonly(isStreaming),
		// Extension UI
		pendingExtensionRequest: readonly(pendingExtensionRequest),
		notifications: readonly(notifications),
		statusEntries: readonly(statusEntries),
		widgetEntries: readonly(widgetEntries),
		prefillText: readonly(prefillText),
		respondToUIRequest,
		dismissNotification,
		sendCommand,
		sendPrompt,
		connect,
		disconnect,
	};
}
