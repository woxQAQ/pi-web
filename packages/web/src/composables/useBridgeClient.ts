import { ref, readonly, computed, onUnmounted } from "vue";
import type {
  RpcCommand,
  RpcImageContent,
  RpcResponse,
  RpcSessionState,
  RpcSessionStats,
  RpcSlashCommand,
  RpcWorkspaceEntry,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcTranscriptMessage,
  RpcTranscriptSnapshotEvent,
  RpcTranscriptUpsertEvent,
  RpcSessionStatsEvent,
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
  transcriptKey?: string;
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

function readFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeSessionStats(value: unknown): RpcSessionStats | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<RpcSessionStats>;
  return {
    tokens:
      typeof data.tokens === "number" && Number.isFinite(data.tokens)
        ? data.tokens
        : null,
    contextWindow: readFiniteNumber(data.contextWindow),
    percent:
      typeof data.percent === "number" && Number.isFinite(data.percent)
        ? data.percent
        : null,
    messageCount: readFiniteNumber(data.messageCount),
    cost: readFiniteNumber(data.cost),
    inputTokens: readFiniteNumber(data.inputTokens),
    outputTokens: readFiniteNumber(data.outputTokens),
    cacheReadTokens: readFiniteNumber(data.cacheReadTokens),
    cacheWriteTokens: readFiniteNumber(data.cacheWriteTokens),
  };
}

// ---------------------------------------------------------------------------
// State refs
// ---------------------------------------------------------------------------

const connectionStatus = ref<ConnectionStatus>("disconnected");
const rawTranscript = ref<TranscriptEntry[]>([]);
const transcriptSessionPath = ref<string | null>(null);
const transcript = computed(() => normalizeTranscript(rawTranscript.value));
const sessionState = ref<RpcSessionState | null>(null);
const sessions = ref<SessionEntry[]>([]);
const treeEntries = ref<TreeEntry[]>([]);
const activeTreeSessionPath = ref<string | null>(null);
const liveSessionPath = ref<string | null>(null);
const commands = ref<RpcSlashCommand[]>([]);
const workspaceEntries = ref<RpcWorkspaceEntry[]>([]);
const workspaceEntriesLoaded = ref(false);
const workspaceEntriesLoading = ref(false);
const availableModels = ref<RpcModelInfo[]>([]);
const currentModel = ref<RpcModelInfo | null>(null);
const currentThinkingLevel = ref<string | null>(null);
const isStreaming = ref(false);

// Session stats (context usage + cost)
const sessionStats = ref<RpcSessionStats | null>(null);

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
let workspaceEntriesRequest: Promise<RpcWorkspaceEntry[]> | null = null;

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
    .map(value => normalizeRpcModel(value))
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
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0"));
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

function normalizeTranscriptEntry(
  entry: TranscriptEntry | RpcTranscriptMessage,
  fallbackKey: string,
): TranscriptEntry {
  return {
    ...entry,
    transcriptKey:
      typeof entry.transcriptKey === "string" && entry.transcriptKey
        ? entry.transcriptKey
        : typeof entry.id === "string" && entry.id
          ? entry.id
          : fallbackKey,
  };
}

function replaceTranscript(
  entries: readonly (TranscriptEntry | RpcTranscriptMessage)[],
  sessionPath: string | null = transcriptSessionPath.value,
) {
  rawTranscript.value = entries.map((entry, index) =>
    normalizeTranscriptEntry(entry, `snapshot:${index}`),
  );
  transcriptSessionPath.value = sessionPath;
}

function shouldReplaceSessionTranscript(sessionPath: string | null): boolean {
  return (
    rawTranscript.value.length === 0 ||
    transcriptSessionPath.value !== sessionPath
  );
}

function applySessionTranscript(
  entries: readonly (TranscriptEntry | RpcTranscriptMessage)[],
  sessionPath: string | null,
) {
  if (!shouldReplaceSessionTranscript(sessionPath)) return;
  replaceTranscript(entries, sessionPath);
}

function upsertTranscriptMessage(
  entry: TranscriptEntry | RpcTranscriptMessage,
  sessionPath: string | null = transcriptSessionPath.value,
) {
  const normalized = normalizeTranscriptEntry(
    entry,
    `live:${rawTranscript.value.length}`,
  );
  transcriptSessionPath.value = sessionPath;
  const index = rawTranscript.value.findIndex(
    current => current.transcriptKey === normalized.transcriptKey,
  );

  if (index >= 0) {
    const updated = [...rawTranscript.value];
    updated[index] = { ...updated[index], ...normalized };
    rawTranscript.value = updated;
    return;
  }

  rawTranscript.value = [...rawTranscript.value, normalized];
}

function sendPrompt(message: string, images?: RpcImageContent[]) {
  sendEnvelope({
    type: "command",
    payload: { type: "prompt", message, images, streamingBehavior: "steer" },
  });
}

async function fetchWorkspaceEntries(
  force: boolean = false,
): Promise<RpcWorkspaceEntry[]> {
  if (workspaceEntriesLoaded.value && !force) {
    return workspaceEntries.value;
  }

  if (workspaceEntriesRequest && !force) {
    return workspaceEntriesRequest;
  }

  if (connectionStatus.value !== "connected") {
    return workspaceEntries.value;
  }

  workspaceEntriesLoading.value = true;
  workspaceEntriesRequest = sendCommand({ type: "list_workspace_entries" })
    .then(response => {
      if (response.success) {
        const data = response.data as
          | { entries?: RpcWorkspaceEntry[] }
          | undefined;
        workspaceEntries.value = Array.isArray(data?.entries)
          ? data.entries
          : [];
        workspaceEntriesLoaded.value = true;
      }
      return workspaceEntries.value;
    })
    .catch(() => workspaceEntries.value)
    .finally(() => {
      workspaceEntriesLoading.value = false;
      workspaceEntriesRequest = null;
    });

  return workspaceEntriesRequest;
}

function abortGeneration() {
  if (!isStreaming.value) return Promise.resolve(null);
  return sendCommand({ type: "abort" });
}

async function setThinkingLevel(level: string) {
  const response = await sendCommand({ type: "set_thinking_level", level });
  if (response.success) {
    currentThinkingLevel.value = normalizeThinkingLevel(level);
  }
  return response;
}

async function setAutoCompactionEnabled(enabled: boolean) {
  const response = await sendCommand({
    type: "set_auto_compaction",
    enabled,
  });
  if (response.success && sessionState.value) {
    sessionState.value = {
      ...sessionState.value,
      autoCompactionEnabled: enabled,
    };
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
  notifications.value = notifications.value.filter(n => n.id !== id);
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
        if (data) {
          replaceTranscript(data.messages, transcriptSessionPath.value);
        }
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
          applySessionTranscript(data.messages, data.sessionPath ?? null);
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
          applySessionTranscript(data.messages, data.sessionPath ?? null);
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
        } else {
          replaceTranscript([], null);
          treeEntries.value = [];
          sessionState.value = null;
        }
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
      case "list_workspace_entries": {
        const data = payload.data as
          | { entries?: RpcWorkspaceEntry[] }
          | undefined;
        workspaceEntries.value = Array.isArray(data?.entries)
          ? data.entries
          : [];
        workspaceEntriesLoaded.value = true;
        workspaceEntriesLoading.value = false;
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
      case "navigate_tree": {
        sendCommand({ type: "get_state" }).catch(() => {});
        sendCommand({
          type: "list_tree_entries",
          sessionPath:
            activeTreeSessionPath.value ?? sessionState.value?.sessionFile,
        }).catch(() => {});
        break;
      }
      case "set_thinking_level":
        break;
    }
  }
}

function handleEvent(payload: Record<string, unknown>) {
  const eventType = payload.type as string;

  switch (eventType) {
    case "transcript_snapshot": {
      const data = payload as RpcTranscriptSnapshotEvent;
      if (Array.isArray(data.messages)) {
        replaceTranscript(data.messages, data.sessionPath ?? null);
      }
      break;
    }
    case "transcript_upsert": {
      const data = payload as RpcTranscriptUpsertEvent;
      if (data.message) {
        upsertTranscriptMessage(data.message, data.sessionPath ?? null);
      }
      break;
    }
    case "session_stats": {
      const data = payload as RpcSessionStatsEvent;
      if (
        !activeTreeSessionPath.value ||
        !data.sessionPath ||
        activeTreeSessionPath.value === data.sessionPath
      ) {
        const stats = normalizeSessionStats(data.stats);
        if (stats) sessionStats.value = stats;
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
      sendCommand({ type: "list_sessions" }),
      sendCommand({ type: "get_commands" }),
      sendCommand({ type: "get_available_models" }),
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

  connectionError.value = "";
  connectionStatus.value = "connecting";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${location.host}/ws`;
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
    workspaceEntries: readonly(workspaceEntries),
    workspaceEntriesLoading: readonly(workspaceEntriesLoading),
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
    fetchWorkspaceEntries,
    abortGeneration,
    setThinkingLevel,
    setAutoCompactionEnabled,
    connect,
    disconnect,
  };
}
