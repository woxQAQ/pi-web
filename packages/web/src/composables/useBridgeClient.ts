import { ref, readonly, computed, onUnmounted } from "vue";
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
import {
  normalizeRpcModel,
  upsertModel,
  type RpcModelInfo,
} from "../utils/models";
import { normalizeTranscript } from "../utils/transcript";

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

export type TreeTrackColumn = "blank" | "line" | "branch" | "branch-last";

export interface TreeEntry {
  id: string;
  label?: string;
  type: string;
  timestamp?: string;
  parentId?: string | null;
  depth?: number;
  trackColumns?: TreeTrackColumn[];
  isActive?: boolean;
  isOnActivePath?: boolean;
}

// ---------------------------------------------------------------------------
// State refs
// ---------------------------------------------------------------------------

const connectionStatus = ref<ConnectionStatus>("disconnected");
const rawTranscript = ref<TranscriptEntry[]>([]);
const transcript = computed(() => normalizeTranscript(rawTranscript.value));
const sessionState = ref<RpcSessionState | null>(null);
const sessions = ref<SessionEntry[]>([]);
const treeEntries = ref<TreeEntry[]>([]);
const activeTreeSessionPath = ref<string | null>(null);
const liveSessionPath = ref<string | null>(null);
const commands = ref<RpcSlashCommand[]>([]);
const availableModels = ref<RpcModelInfo[]>([]);
const currentModel = ref<RpcModelInfo | null>(null);
const currentThinkingLevel = ref<string | null>(null);
const isStreaming = ref(false);

// Session stats (context usage + cost)
const sessionStats = ref<{
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  messageCount: number;
  cost: number;
} | null>(null);

// Reconnect diagnostics
const reconnectCount = ref(0);
const lastDisconnectReason = ref("");
const connectionError = ref("");

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
let requestIdCounter = 0;

/** Ephemeral auth token extracted from the initial URL query param. */
let authToken = "";

/** Extract token from the current page URL and store it. */
function captureToken(): void {
  if (!authToken) {
    const params = new URLSearchParams(location.search);
    authToken = params.get("token") || "";
  }
}

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
  if (connectionError.value) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!disposed) connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function updateCurrentModel(value: unknown) {
  currentModel.value = normalizeRpcModel(value);
  if (currentModel.value) {
    availableModels.value = upsertModel(
      availableModels.value,
      currentModel.value,
    );
  }
}

function updateAvailableModels(values: unknown[]) {
  availableModels.value = values
    .map((value) => normalizeRpcModel(value))
    .filter((model): model is RpcModelInfo => model !== null);

  if (currentModel.value) {
    availableModels.value = upsertModel(
      availableModels.value,
      currentModel.value,
    );
  }
}

function normalizeThinkingLevel(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function sendEnvelope(msg: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function createRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  requestIdCounter += 1;
  return `req_${Date.now().toString(36)}_${requestIdCounter}_${Math.random().toString(36).slice(2)}`;
}

function sendCommand(payload: RpcCommand): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const id = payload.id ?? createRequestId();
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

async function setThinkingLevel(level: string) {
  const response = await sendCommand({ type: "set_thinking_level", level });
  if (response.success) {
    currentThinkingLevel.value = normalizeThinkingLevel(level);
  }
  return response;
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
        const data = payload.data as
          | { messages: TranscriptEntry[] }
          | undefined;
        if (data) rawTranscript.value = data.messages;
        break;
      }
      case "get_state": {
        const data = payload.data as RpcSessionState | undefined;
        if (data) {
          liveSessionPath.value = data.sessionFile ?? null;
          const isBrowsingDifferentSession = Boolean(
            activeTreeSessionPath.value &&
            data.sessionFile &&
            activeTreeSessionPath.value !== data.sessionFile,
          );
          sessionState.value = isBrowsingDifferentSession
            ? {
                ...data,
                sessionId: sessionState.value?.sessionId ?? data.sessionId,
                sessionName:
                  sessionState.value?.sessionName ?? data.sessionName,
                sessionFile: activeTreeSessionPath.value ?? data.sessionFile,
              }
            : data;
          updateCurrentModel(data.model);
          currentThinkingLevel.value = normalizeThinkingLevel(
            data.thinkingLevel,
          );
          isStreaming.value = data.isStreaming;
          if (!activeTreeSessionPath.value && data.sessionFile) {
            activeTreeSessionPath.value = data.sessionFile;
          }
        }
        break;
      }
      case "list_sessions": {
        const data = payload.data as { sessions: SessionEntry[] } | undefined;
        if (data) sessions.value = data.sessions;
        break;
      }
      case "switch_session": {
        const data = payload.data as
          | {
              messages: TranscriptEntry[];
              treeEntries?: TreeEntry[];
              sessionId?: string;
              sessionName?: string;
              sessionPath?: string;
            }
          | undefined;
        if (data && Array.isArray(data.messages)) {
          rawTranscript.value = [...data.messages];
          if (data.sessionPath) {
            activeTreeSessionPath.value = data.sessionPath;
            liveSessionPath.value = data.sessionPath;
          }
          if (Array.isArray(data.treeEntries)) {
            treeEntries.value = data.treeEntries;
          }
          if (data.sessionId) {
            sessionState.value = {
              ...sessionState.value,
              sessionId: data.sessionId,
              sessionName: data.sessionName,
              sessionFile: data.sessionPath ?? sessionState.value?.sessionFile,
            } as RpcSessionState;
          }
          sendCommand({
            type: "get_state",
          }).catch(() => {});
          sendCommand({
            type: "get_session_stats",
            sessionPath: data.sessionPath,
          }).catch(() => {});
        }
        break;
      }
      case "list_tree_entries": {
        const data = payload.data as
          | { entries: TreeEntry[]; sessionPath?: string }
          | undefined;
        if (data) {
          const responseSessionPath = data.sessionPath ?? null;
          if (
            !activeTreeSessionPath.value ||
            activeTreeSessionPath.value === responseSessionPath
          ) {
            treeEntries.value = data.entries;
            activeTreeSessionPath.value = responseSessionPath;
          }
        }
        break;
      }
      case "new_session": {
        rawTranscript.value = [];
        treeEntries.value = [];
        sessionState.value = null;
        sendCommand({ type: "list_sessions" }).catch(() => {});
        break;
      }
      case "get_commands": {
        const data = payload.data as
          | { commands: RpcSlashCommand[] }
          | undefined;
        if (data) commands.value = data.commands;
        break;
      }
      case "set_model": {
        updateCurrentModel(payload.data);
        if (currentModel.value) {
          availableModels.value = upsertModel(
            availableModels.value,
            currentModel.value,
          );
        }
        break;
      }
      case "get_available_models": {
        const data = payload.data as { models: unknown[] } | undefined;
        if (data) updateAvailableModels(data.models);
        break;
      }
      case "set_thinking_level":
        break;
      case "get_session_stats": {
        const data = payload.data as
          | {
              tokens: number | null;
              contextWindow: number;
              percent: number | null;
              messageCount: number;
              cost: number;
            }
          | undefined;
        if (data) sessionStats.value = data;
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
        rawTranscript.value = [...rawTranscript.value, msg];
      }
      break;
    }
    case "message_update": {
      // Update the last message with matching id, or append
      const msg = payload as unknown as TranscriptEntry;
      const idx = msg.id
        ? rawTranscript.value.findIndex((m) => m.id === msg.id)
        : rawTranscript.value.length - 1;
      if (idx >= 0) {
        const updated = [...rawTranscript.value];
        updated[idx] = { ...updated[idx], ...msg };
        rawTranscript.value = updated;
      } else {
        rawTranscript.value = [...rawTranscript.value, msg];
      }
      break;
    }
    case "message_end": {
      const msg = payload as unknown as TranscriptEntry;
      if (msg.id) {
        const idx = rawTranscript.value.findIndex((m) => m.id === msg.id);
        if (idx >= 0) {
          const updated = [...rawTranscript.value];
          updated[idx] = { ...updated[idx], ...msg };
          rawTranscript.value = updated;
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
      sendCommand({ type: "get_session_stats" }).catch(() => {});
      break;
    }
    case "model_select": {
      const model = normalizeRpcModel(
        (payload as { model?: unknown }).model ?? payload,
      );
      if (model) {
        currentModel.value = model;
        availableModels.value = upsertModel(availableModels.value, model);
      }
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
      sendCommand({ type: "get_commands" }),
      sendCommand({ type: "get_available_models" }),
      sendCommand({ type: "get_session_stats" }),
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

  captureToken();
  if (!authToken) {
    connectionStatus.value = "disconnected";
    connectionError.value =
      "Missing authentication token. Open the bridge URL with its token parameter.";
    lastDisconnectReason.value = connectionError.value;
    return;
  }

  connectionError.value = "";
  connectionStatus.value = "connecting";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = authToken
    ? `${protocol}//${location.host}/ws?token=${encodeURIComponent(authToken)}`
    : `${protocol}//${location.host}/ws`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    connectionStatus.value = "connected";
    connectionError.value = "";
    lastDisconnectReason.value = "";
    resetReconnectDelay();
    fetchInitialState();
  });

  ws.addEventListener("close", (event?: CloseEvent) => {
    connectionStatus.value = "disconnected";
    reconnectCount.value++;
    lastDisconnectReason.value = event?.reason
      ? `Connection lost: ${event.reason}`
      : "Connection lost";
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

  const isReconnecting = computed(
    () =>
      connectionStatus.value === "disconnected" &&
      !disposed &&
      !connectionError.value,
  );
  const isHistoricalView = computed(() =>
    Boolean(
      activeTreeSessionPath.value &&
      liveSessionPath.value &&
      activeTreeSessionPath.value !== liveSessionPath.value,
    ),
  );

  return {
    connectionStatus: readonly(connectionStatus),
    transcript: readonly(transcript),
    sessionState: readonly(sessionState),
    sessions: readonly(sessions),
    treeEntries: readonly(treeEntries),
    activeTreeSessionPath: readonly(activeTreeSessionPath),
    liveSessionPath: readonly(liveSessionPath),
    isHistoricalView,
    commands: readonly(commands),
    availableModels: readonly(availableModels),
    currentModel: readonly(currentModel),
    currentThinkingLevel: readonly(currentThinkingLevel),
    isStreaming: readonly(isStreaming),
    sessionStats: readonly(sessionStats),
    // Reconnect diagnostics
    isReconnecting,
    reconnectCount: readonly(reconnectCount),
    lastDisconnectReason: readonly(lastDisconnectReason),
    connectionError: readonly(connectionError),
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
    setThinkingLevel,
    connect,
    disconnect,
  };
}
