import { ref, readonly, computed, onUnmounted, watch } from "vue";
import type {
  ClientMessage,
  RpcBridgeEvent,
  RpcCommand,
  RpcAgentEndEvent,
  RpcAgentStartEvent,
  RpcImageContent,
  RpcResponse,
  RpcSessionState,
  RpcSessionStats,
  RpcSlashCommand,
  RpcThinkingLevel,
  RpcTreeEntry,
  RpcTreeTrackColumn,
  RpcWorkspaceEntry,
  RpcWorkspaceFile,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcGitBranch,
  RpcGitRepoState,
  RpcQueuedMessage,
  RpcQueueUpdateEvent,
  RpcTranscriptMessage,
  RpcTranscriptPage,
  RpcTranscriptSnapshotEvent,
  RpcTranscriptUpsertEvent,
  RpcSessionStatsEvent,
  ServerMessage,
} from "../shared-types";
import {
  normalizeRpcModel,
  upsertModel,
  type RpcModelInfo,
} from "../utils/models";
import {
  normalizeTranscript,
  transcriptConfigState,
  type PendingTranscriptSessionEvent,
} from "../utils/transcript";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type TranscriptEntry = RpcTranscriptMessage;

export interface SessionEntry {
  id: string;
  name: string;
  path: string;
  isRunning?: boolean;
  timestamp?: string;
  updatedAt?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
}

export type TreeTrackColumn = RpcTreeTrackColumn;

export type TreeEntry = RpcTreeEntry;

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

function normalizeGitBranch(value: unknown): RpcGitBranch | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<RpcGitBranch>;
  if (typeof data.name !== "string" || typeof data.shortName !== "string") {
    return null;
  }
  if (data.kind !== "local" && data.kind !== "remote") {
    return null;
  }

  return {
    name: data.name,
    shortName: data.shortName,
    kind: data.kind,
    remoteName:
      typeof data.remoteName === "string" ? data.remoteName : undefined,
    isCurrent: data.isCurrent === true,
  };
}

function normalizeGitRepoState(value: unknown): RpcGitRepoState | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<RpcGitRepoState>;
  if (typeof data.repoRoot !== "string" || typeof data.headLabel !== "string") {
    return null;
  }

  const branches = Array.isArray(data.branches)
    ? data.branches
        .map(branch => normalizeGitBranch(branch))
        .filter((branch): branch is RpcGitBranch => branch !== null)
    : [];

  return {
    repoRoot: data.repoRoot,
    headLabel: data.headLabel,
    currentBranch:
      typeof data.currentBranch === "string" ? data.currentBranch : undefined,
    detached: data.detached === true,
    isDirty: data.isDirty === true,
    branches,
  };
}

function normalizeQueuedMessage(value: unknown): RpcQueuedMessage | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<RpcQueuedMessage>;
  if (typeof data.text !== "string") {
    return null;
  }

  const images = Array.isArray(data.images)
    ? data.images.filter(
        (image): image is RpcImageContent =>
          Boolean(image) &&
          image.type === "image" &&
          typeof image.data === "string" &&
          typeof image.mimeType === "string",
      )
    : [];

  return {
    text: data.text,
    images,
    timestamp:
      typeof data.timestamp === "number" && Number.isFinite(data.timestamp)
        ? data.timestamp
        : Date.now(),
  };
}

// ---------------------------------------------------------------------------
// State refs
// ---------------------------------------------------------------------------

const connectionStatus = ref<ConnectionStatus>("disconnected");
const rawTranscript = ref<TranscriptEntry[]>([]);
const transcriptSessionPath = ref<string | null>(null);
const transcriptHasOlder = ref(false);
const transcriptOldestCursor = ref<string | null>(null);
const transcriptNewestCursor = ref<string | null>(null);
const transcriptInitialLoading = ref(true);
const transcriptPageLoading = ref(false);
const transcript = computed(() => normalizeTranscript(rawTranscript.value));
const sessionState = ref<RpcSessionState | null>(null);
const pendingTranscriptConfigEvent = ref<
  (PendingTranscriptSessionEvent & { sessionPath: string | null }) | null
>(null);
const sessions = ref<SessionEntry[]>([]);
const treeEntries = ref<TreeEntry[]>([]);
const activeTreeSessionPath = ref<string | null>(null);
const liveSessionPath = ref<string | null>(null);
const runningSessionPaths = ref<string[]>([]);
const workspaceSessionCursors = ref<Record<string, string | null>>({});
const commands = ref<RpcSlashCommand[]>([]);
const workspaceEntries = ref<RpcWorkspaceEntry[]>([]);
const workspaceEntriesLoaded = ref(false);
const workspaceEntriesLoading = ref(false);
const availableModels = ref<RpcModelInfo[]>([]);
const currentModel = ref<RpcModelInfo | null>(null);
const currentThinkingLevel = ref<RpcThinkingLevel | null>(null);
const isStreaming = ref(false);
const compactingRequestCount = ref(0);
const remoteCompactionActive = ref(false);
const isCompacting = computed(
  () => compactingRequestCount.value > 0 || remoteCompactionActive.value,
);

// Locally queued follow-up messages that are not yet reflected in the transcript.
const queuedUserMessages = ref<RpcQueuedMessage[]>([]);

// Session stats (context usage + cost)
const sessionStats = ref<RpcSessionStats | null>(null);
const gitRepoState = ref<RpcGitRepoState | null>(null);
const gitRepoLoading = ref(false);
const gitBranchSwitching = ref(false);

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
let pendingTranscriptConfigEventCounter = 0;
let workspaceEntriesRequest: Promise<RpcWorkspaceEntry[]> | null = null;
let gitRepoStateRequest: Promise<RpcGitRepoState | null> | null = null;
let stopDisplayedSessionRouteSync: (() => void) | null = null;
let popStateListenerInstalled = false;

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

function updateAvailableModels(values: readonly unknown[]) {
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

function getDisplayedSessionPath(): string | null {
  return activeTreeSessionPath.value ?? sessionState.value?.sessionFile ?? null;
}

const SESSION_ROUTE_PARAM = "session";
const displayedSessionPath = computed(() => getDisplayedSessionPath());

type HistoryMode = "push" | "replace";

function readSessionRoutePath(): string | null {
  const search = globalThis.location?.search;
  if (typeof search !== "string") return null;
  const value = new URLSearchParams(search).get(SESSION_ROUTE_PARAM);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildSessionRouteUrl(sessionPath: string | null): string | null {
  const currentLocation = globalThis.location;
  if (!currentLocation) return null;

  const params = new URLSearchParams(currentLocation.search ?? "");
  if (sessionPath) {
    params.set(SESSION_ROUTE_PARAM, sessionPath);
  } else {
    params.delete(SESSION_ROUTE_PARAM);
  }

  const pathname = currentLocation.pathname ?? "/";
  const search = params.toString();
  const hash = currentLocation.hash ?? "";
  return `${pathname}${search ? `?${search}` : ""}${hash}`;
}

function writeSessionRoutePath(
  sessionPath: string | null,
  mode: HistoryMode = "replace",
) {
  const historyApi = globalThis.history;
  const nextUrl = buildSessionRouteUrl(sessionPath);
  if (!historyApi || !nextUrl) return;
  if (readSessionRoutePath() === sessionPath) return;

  if (mode === "push" && typeof historyApi.pushState === "function") {
    historyApi.pushState(null, "", nextUrl);
    return;
  }

  if (typeof historyApi.replaceState === "function") {
    historyApi.replaceState(null, "", nextUrl);
  }
}

function syncDisplayedSessionRoute(mode: HistoryMode = "replace") {
  writeSessionRoutePath(getDisplayedSessionPath(), mode);
}

async function restoreLiveSessionState() {
  activeTreeSessionPath.value = null;
  treeEntries.value = [];
  sessionStats.value = null;

  await Promise.all([
    sendCommand({ type: "get_messages", direction: "latest", limit: 40 }),
    sendCommand({ type: "get_state" }),
  ]);
}

async function applySessionRouteFromLocation() {
  const routeSessionPath = readSessionRoutePath();
  const currentSessionPath = getDisplayedSessionPath();
  if (routeSessionPath === currentSessionPath) {
    return;
  }

  try {
    if (!routeSessionPath) {
      await restoreLiveSessionState();
      return;
    }

    const response = await sendCommand({
      type: "switch_session",
      sessionPath: routeSessionPath,
    });
    if (!response.success) {
      pushNotification(
        summarizeErrorMessage(
          response.error ?? "Failed to open session from URL",
          "Failed to open session from URL",
        ),
        "error",
      );
      syncDisplayedSessionRoute("replace");
    }
  } catch {
    // Leave the current selection unchanged if the browser navigates mid-reconnect.
  }
}

function handleSessionRoutePopState() {
  if (connectionStatus.value !== "connected") {
    return;
  }

  void applySessionRouteFromLocation();
}

function startSessionRouteSync() {
  if (!stopDisplayedSessionRouteSync) {
    stopDisplayedSessionRouteSync = watch(displayedSessionPath, sessionPath => {
      writeSessionRoutePath(sessionPath, "replace");
    });
  }

  if (!popStateListenerInstalled) {
    globalThis.addEventListener?.("popstate", handleSessionRoutePopState);
    popStateListenerInstalled = true;
  }
}

function stopSessionRouteSync() {
  stopDisplayedSessionRouteSync?.();
  stopDisplayedSessionRouteSync = null;

  if (popStateListenerInstalled) {
    globalThis.removeEventListener?.("popstate", handleSessionRoutePopState);
    popStateListenerInstalled = false;
  }
}

function shouldApplyQueueUpdate(sessionPath: string | null): boolean {
  const displayedSessionPath = getDisplayedSessionPath();
  if (!sessionPath) return displayedSessionPath === null;
  if (!displayedSessionPath) return true;
  return displayedSessionPath === sessionPath;
}

function applyQueuedMessages(
  followUp: readonly RpcQueuedMessage[],
  options?: {
    sessionPath?: string | null;
    steeringCount?: number;
  },
) {
  const sessionPath = options?.sessionPath ?? getDisplayedSessionPath();
  if (!shouldApplyQueueUpdate(sessionPath)) return;

  queuedUserMessages.value = [...followUp];
  if (sessionState.value) {
    const steeringCount = options?.steeringCount ?? 0;
    sessionState.value = {
      ...sessionState.value,
      pendingMessageCount: steeringCount + followUp.length,
    };
  }
}

function resetGitRepoState() {
  gitRepoState.value = null;
  gitRepoLoading.value = false;
  gitBranchSwitching.value = false;
  gitRepoStateRequest = null;
}

function setSessionRunning(sessionPath: string | null, isRunning: boolean) {
  if (!sessionPath) return;

  const next = new Set(runningSessionPaths.value);
  if (isRunning) {
    next.add(sessionPath);
  } else {
    next.delete(sessionPath);
  }
  runningSessionPaths.value = [...next];

  sessions.value = sessions.value.map(session =>
    session.path === sessionPath ? { ...session, isRunning } : session,
  );
}

function syncRunningSessionsFromEntries(entries: readonly SessionEntry[]) {
  runningSessionPaths.value = entries
    .filter(session => session.isRunning)
    .map(session => session.path);
}

function workspaceKeyForSession(session: SessionEntry): string | null {
  return session.workspacePath ?? session.workspaceId ?? null;
}

function mergeSessionEntries(
  current: readonly SessionEntry[],
  incoming: readonly SessionEntry[],
): SessionEntry[] {
  const nextByPath = new Map(current.map(session => [session.path, session]));
  for (const session of incoming) {
    nextByPath.set(session.path, session);
  }
  return [...nextByPath.values()].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? left.timestamp ?? "");
    const rightTime = Date.parse(right.updatedAt ?? right.timestamp ?? "");
    const timeDelta =
      (Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY) -
      (Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY);
    return timeDelta || right.path.localeCompare(left.path);
  });
}

function normalizeThinkingLevel(value: unknown): RpcThinkingLevel | null {
  switch (value) {
    case "normal":
    case "medium":
      return "medium";
    case "off":
    case "minimal":
    case "low":
    case "high":
    case "xhigh":
      return value;
    default:
      return null;
  }
}

function clearPendingTranscriptConfigEvent() {
  pendingTranscriptConfigEvent.value = null;
}

function pendingTranscriptAnchorKey(): string | null {
  const message = transcript.value.at(-1);
  return message?.transcriptKey ?? message?.id ?? null;
}

function samePendingTranscriptModel(
  left: PendingTranscriptSessionEvent["model"] | undefined,
  right: PendingTranscriptSessionEvent["model"] | undefined,
): boolean {
  if (!left || !right) return false;
  return left.id === right.id && left.provider === right.provider;
}

function reconcilePendingTranscriptConfigEvent() {
  const pending = pendingTranscriptConfigEvent.value;
  if (!pending || pending.sessionPath !== transcriptSessionPath.value) return;

  const configState = transcriptConfigState(rawTranscript.value);
  const next = { ...pending };
  if (samePendingTranscriptModel(next.model, configState.model)) {
    next.model = undefined;
  }
  if (next.thinkingLevel && next.thinkingLevel === configState.thinkingLevel) {
    next.thinkingLevel = undefined;
  }

  pendingTranscriptConfigEvent.value =
    next.model || next.thinkingLevel ? next : null;
}

function updatePendingTranscriptConfigEvent(change: {
  model?: RpcModelInfo | null;
  thinkingLevel?: RpcThinkingLevel | null;
}) {
  reconcilePendingTranscriptConfigEvent();

  const sessionPath = transcriptSessionPath.value;
  const existing = pendingTranscriptConfigEvent.value;
  const existingForSession =
    existing && existing.sessionPath === sessionPath ? existing : null;
  const nextKey = existingForSession
    ? existingForSession.key
    : `pending-session-event:${++pendingTranscriptConfigEventCounter}`;
  const next: PendingTranscriptSessionEvent & { sessionPath: string | null } = {
    key: nextKey,
    sessionPath,
    model: existingForSession?.model,
    thinkingLevel: existingForSession?.thinkingLevel,
    insertAfterMessageKey: existingForSession
      ? existingForSession.insertAfterMessageKey
      : pendingTranscriptAnchorKey(),
  };

  if ("model" in change) {
    next.model = change.model
      ? {
          provider: change.model.provider,
          id: change.model.id,
        }
      : undefined;
  }
  if ("thinkingLevel" in change) {
    next.thinkingLevel = change.thinkingLevel ?? undefined;
  }

  pendingTranscriptConfigEvent.value =
    next.model || next.thinkingLevel ? next : null;
}

const visiblePendingTranscriptConfigEvent =
  computed<PendingTranscriptSessionEvent | null>(() => {
    const pending = pendingTranscriptConfigEvent.value;
    if (!pending) return null;
    return pending.sessionPath === transcriptSessionPath.value
      ? {
          key: pending.key,
          model: pending.model,
          thinkingLevel: pending.thinkingLevel,
          insertAfterMessageKey: pending.insertAfterMessageKey,
        }
      : null;
  });

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

function sendCommand(
  payload: RpcCommand,
  options?: { timeoutMs?: number },
): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const id = payload.id ?? createRequestId();
    const command = { ...payload, id };
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`RPC timeout: ${command.type}`));
    }, options?.timeoutMs ?? 15_000);
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
  const previousSessionPath = transcriptSessionPath.value;
  rawTranscript.value = entries.map((entry, index) =>
    normalizeTranscriptEntry(entry, `snapshot:${index}`),
  );
  if (previousSessionPath !== sessionPath || rawTranscript.value.length === 0) {
    clearPendingTranscriptConfigEvent();
  }
  if (previousSessionPath !== sessionPath) {
    queuedUserMessages.value = [];
  }
  transcriptSessionPath.value = sessionPath;
  reconcilePendingTranscriptConfigEvent();
}

function applyTranscriptPage(
  page: RpcTranscriptPage,
  mode: "replace" | "prepend" = "replace",
) {
  const previousSessionPath = transcriptSessionPath.value;
  const normalized = page.messages.map((entry, index) =>
    normalizeTranscriptEntry(entry, `snapshot:${index}`),
  );

  if (mode === "prepend") {
    const existingKeys = new Set(
      rawTranscript.value.map(entry => entry.transcriptKey),
    );
    const merged = normalized.filter(
      entry => !existingKeys.has(entry.transcriptKey),
    );
    rawTranscript.value = [...merged, ...rawTranscript.value];
  } else {
    rawTranscript.value = normalized;
  }

  const nextSessionPath = page.sessionPath ?? null;
  if (previousSessionPath !== nextSessionPath) {
    clearPendingTranscriptConfigEvent();
    queuedUserMessages.value = [];
  }
  transcriptSessionPath.value = nextSessionPath;
  transcriptHasOlder.value = page.hasOlder;
  transcriptOldestCursor.value = page.oldestCursor ?? null;
  transcriptNewestCursor.value = page.newestCursor ?? null;
  transcriptInitialLoading.value = false;
  transcriptPageLoading.value = false;
  reconcilePendingTranscriptConfigEvent();
}

function shouldReplaceSessionTranscript(sessionPath: string | null): boolean {
  return (
    rawTranscript.value.length === 0 ||
    transcriptSessionPath.value !== sessionPath
  );
}

function currentTranscriptContainsLiveOnlyEntries(): boolean {
  return rawTranscript.value.some(
    entry =>
      typeof entry.transcriptKey === "string" &&
      entry.transcriptKey.startsWith("live:"),
  );
}

function applySessionTranscriptPage(page: RpcTranscriptPage) {
  if (
    page.messages.length === 0 &&
    !shouldReplaceSessionTranscript(page.sessionPath ?? null) &&
    currentTranscriptContainsLiveOnlyEntries()
  ) {
    transcriptHasOlder.value = page.hasOlder;
    transcriptOldestCursor.value = page.oldestCursor ?? null;
    transcriptNewestCursor.value = page.newestCursor ?? null;
    transcriptInitialLoading.value = false;
    transcriptPageLoading.value = false;
    return;
  }

  applyTranscriptPage(page, "replace");
}

function applyTreeEntriesUpdate(
  entries: readonly TreeEntry[],
  sessionPath: string | null,
  options?: { force?: boolean },
) {
  if (
    !options?.force &&
    activeTreeSessionPath.value &&
    activeTreeSessionPath.value !== sessionPath
  ) {
    return;
  }

  treeEntries.value = [...entries];
  activeTreeSessionPath.value = sessionPath;
}

function applySessionSnapshotResponse(
  data:
    | {
        transcript: RpcTranscriptPage;
        treeEntries?: TreeEntry[];
        sessionId?: string;
        sessionName?: string;
        sessionPath?: string;
      }
    | undefined,
  options?: { refreshState?: boolean },
): boolean {
  if (!data?.transcript) {
    return false;
  }

  const previousSessionPath = getDisplayedSessionPath();

  applySessionTranscriptPage(data.transcript);
  if (data.sessionPath) {
    liveSessionPath.value = data.sessionPath;
  }
  if (Array.isArray(data.treeEntries)) {
    applyTreeEntriesUpdate(data.treeEntries, data.sessionPath ?? null, {
      force: true,
    });
  } else if (data.sessionPath) {
    activeTreeSessionPath.value = data.sessionPath;
  }
  if (data.sessionId) {
    sessionState.value = {
      ...sessionState.value,
      sessionId: data.sessionId,
      sessionName: data.sessionName,
      sessionFile: data.sessionPath ?? sessionState.value?.sessionFile,
    } as RpcSessionState;
  }
  if (previousSessionPath !== getDisplayedSessionPath()) {
    resetGitRepoState();
    isStreaming.value = false;
  }
  if (options?.refreshState) {
    sendCommand({ type: "get_state" }).catch(() => {});
  }
  return true;
}

async function loadOlderTranscriptPage() {
  if (
    transcriptPageLoading.value ||
    !transcriptHasOlder.value ||
    !transcriptOldestCursor.value
  ) {
    return;
  }

  transcriptPageLoading.value = true;
  try {
    const response = await sendCommand({
      type: "get_messages",
      direction: "older",
      cursor: transcriptOldestCursor.value,
      limit: 40,
    });
    if (!response.success) {
      transcriptPageLoading.value = false;
    }
  } catch {
    transcriptPageLoading.value = false;
  }
}

function upsertTranscriptMessage(
  entry: TranscriptEntry | RpcTranscriptMessage,
  sessionPath: string | null = transcriptSessionPath.value,
) {
  const normalized = normalizeTranscriptEntry(
    entry,
    `live:${rawTranscript.value.length}`,
  );
  if (shouldReplaceSessionTranscript(sessionPath)) {
    transcriptSessionPath.value = sessionPath;
  }
  const index = rawTranscript.value.findIndex(
    current => current.transcriptKey === normalized.transcriptKey,
  );

  if (index >= 0) {
    const updated = [...rawTranscript.value];
    updated[index] = { ...updated[index], ...normalized };
    rawTranscript.value = updated;
    reconcilePendingTranscriptConfigEvent();
    return;
  }

  rawTranscript.value = [...rawTranscript.value, normalized];
  reconcilePendingTranscriptConfigEvent();
}

function appendCompactErrorMessage(message: string) {
  const detail = message.trim();
  const errorMessage = detail
    ? `Compaction failed: ${detail}`
    : "Compaction failed";

  upsertTranscriptMessage({
    transcriptKey: `local:compact-error:${Date.now()}:${requestIdCounter}`,
    role: "assistant",
    stopReason: "error",
    errorMessage,
    timestamp: new Date().toISOString(),
  });
}

function setCompactionState(isCompacting: boolean) {
  remoteCompactionActive.value = isCompacting;
  if (!sessionState.value) return;
  sessionState.value = {
    ...sessionState.value,
    isCompacting,
  };
}

function sendPrompt(
  message: string,
  images?: RpcImageContent[],
  streamingBehavior: "steer" | "followUp" = "followUp",
) {
  if (streamingBehavior === "followUp" && isStreaming.value) {
    queuedUserMessages.value = [
      ...queuedUserMessages.value,
      { text: message, images: images ?? [], timestamp: Date.now() },
    ];
  }
  sendEnvelope({
    type: "command",
    payload: { type: "prompt", message, images, streamingBehavior },
  });
}

async function dequeueQueuedMessage(
  index: number,
): Promise<RpcQueuedMessage | null> {
  if (!Number.isInteger(index) || index < 0) return null;

  try {
    const response = await sendCommand({
      type: "dequeue_follow_up_message",
      index,
    });
    if (!response.success) {
      pushNotification(
        summarizeErrorMessage(
          response.error ?? "Failed to update queued messages",
          "Failed to update queued messages",
        ),
        "error",
      );
      return null;
    }

    const removed = normalizeQueuedMessage(
      (response.data as { removed?: RpcQueuedMessage } | undefined)?.removed,
    );
    if (removed) {
      queuedUserMessages.value = queuedUserMessages.value.filter(
        (_, queuedIndex) => queuedIndex !== index,
      );
      if (sessionState.value) {
        sessionState.value = {
          ...sessionState.value,
          pendingMessageCount: Math.max(
            0,
            sessionState.value.pendingMessageCount - 1,
          ),
        };
      }
    }
    return removed;
  } catch (error) {
    pushNotification(
      summarizeErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to update queued messages",
        "Failed to update queued messages",
      ),
      "error",
    );
    return null;
  }
}

async function cancelQueuedMessage(index: number): Promise<boolean> {
  return (await dequeueQueuedMessage(index)) !== null;
}

async function editQueuedMessage(
  index: number,
): Promise<{ text: string; images: RpcImageContent[] } | null> {
  const item = await dequeueQueuedMessage(index);
  if (!item) return null;
  return { text: item.text, images: item.images };
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

function pushNotification(message: string, notifyType?: string) {
  notifications.value = [
    ...notifications.value,
    {
      message,
      notifyType,
      id: `local-notify:${createRequestId()}`,
    },
  ];
}

function summarizeErrorMessage(message: string, fallback: string): string {
  const line = message
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(Boolean);
  if (!line) return fallback;
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}

async function readWorkspaceFile(path: string): Promise<RpcWorkspaceFile> {
  const response = await sendCommand({ type: "read_workspace_file", path });
  if (!response.success) {
    throw new Error(response.error ?? "Failed to read workspace file");
  }

  const data = response.data;
  if (!data || typeof data !== "object") {
    throw new Error("Failed to parse workspace file contents");
  }

  return data as RpcWorkspaceFile;
}

async function loadGitRepoState(
  force: boolean = false,
): Promise<RpcGitRepoState | null> {
  if (gitRepoState.value && !force) {
    return gitRepoState.value;
  }

  if (gitRepoStateRequest && !force) {
    return gitRepoStateRequest;
  }

  if (connectionStatus.value !== "connected") {
    return gitRepoState.value;
  }

  gitRepoLoading.value = true;
  gitRepoStateRequest = sendCommand({ type: "list_git_branches" })
    .then(response => {
      if (!response.success) {
        pushNotification(
          summarizeErrorMessage(
            response.error ?? "Failed to load git branches",
            "Failed to load git branches",
          ),
          "error",
        );
        return gitRepoState.value;
      }

      const state = normalizeGitRepoState(response.data);
      gitRepoState.value = state;
      if (!state) {
        pushNotification("Failed to parse git branch data", "error");
      }
      return state;
    })
    .catch(error => {
      pushNotification(
        summarizeErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load git branches",
          "Failed to load git branches",
        ),
        "error",
      );
      return gitRepoState.value;
    })
    .finally(() => {
      gitRepoLoading.value = false;
      gitRepoStateRequest = null;
    });

  return gitRepoStateRequest;
}

function applyGitRepoMutation(state: RpcGitRepoState | null) {
  gitRepoState.value = state;

  if (state && sessionState.value) {
    sessionState.value = {
      ...sessionState.value,
      gitBranch: state.headLabel,
    };
  }

  workspaceEntriesLoaded.value = false;
  workspaceEntries.value = [];
  workspaceEntriesRequest = null;
  void fetchWorkspaceEntries(true).catch(() => {});
}

async function switchGitBranch(
  branchName: string,
): Promise<RpcGitRepoState | null> {
  if (!branchName.trim() || connectionStatus.value !== "connected") {
    return null;
  }

  gitBranchSwitching.value = true;

  try {
    const response = await sendCommand({
      type: "switch_git_branch",
      branchName,
    });
    if (!response.success) {
      pushNotification(
        summarizeErrorMessage(
          response.error ?? "Failed to switch git branch",
          "Failed to switch git branch",
        ),
        "error",
      );
      return null;
    }

    const state = normalizeGitRepoState(response.data);
    if (!state) {
      pushNotification("Failed to parse git branch data", "error");
      return null;
    }
    applyGitRepoMutation(state);
    return state;
  } catch (error) {
    pushNotification(
      summarizeErrorMessage(
        error instanceof Error ? error.message : "Failed to switch git branch",
        "Failed to switch git branch",
      ),
      "error",
    );
    return null;
  } finally {
    gitBranchSwitching.value = false;
  }
}

async function createGitBranch(
  branchName: string,
): Promise<RpcGitRepoState | null> {
  if (!branchName.trim() || connectionStatus.value !== "connected") {
    return null;
  }

  gitBranchSwitching.value = true;

  try {
    const response = await sendCommand({
      type: "create_git_branch",
      branchName,
    });
    if (!response.success) {
      pushNotification(
        summarizeErrorMessage(
          response.error ?? "Failed to create git branch",
          "Failed to create git branch",
        ),
        "error",
      );
      return null;
    }

    const state = normalizeGitRepoState(response.data);
    if (!state) {
      pushNotification("Failed to parse git branch data", "error");
      return null;
    }
    applyGitRepoMutation(state);
    return state;
  } catch (error) {
    pushNotification(
      summarizeErrorMessage(
        error instanceof Error ? error.message : "Failed to create git branch",
        "Failed to create git branch",
      ),
      "error",
    );
    return null;
  } finally {
    gitBranchSwitching.value = false;
  }
}

function abortGeneration() {
  if (!isStreaming.value) return Promise.resolve(null);
  return sendCommand({ type: "abort" });
}

async function loadWorkspaceSessions(options: {
  workspacePath: string;
  cursor?: string | null;
  limit?: number;
  query?: string;
  merge?: "replace" | "append";
}): Promise<RpcResponse> {
  return sendCommand({
    type: "list_sessions",
    scope: "workspace",
    workspacePath: options.workspacePath,
    cursor: options.cursor ?? undefined,
    limit: options.limit ?? 50,
    query: options.query,
    includeActive: true,
    merge: options.merge ?? "append",
  });
}

async function refreshWorkspaceSessions(): Promise<RpcResponse> {
  return sendCommand({
    type: "list_sessions",
    scope: "workspaces",
    limit: 10,
    includeActive: true,
  });
}

async function switchSession(sessionPath: string): Promise<RpcResponse> {
  const response = await sendCommand({ type: "switch_session", sessionPath });
  if (response.success) {
    const data = response.data as { sessionPath?: string } | undefined;
    writeSessionRoutePath(data?.sessionPath ?? sessionPath, "push");
  }
  return response;
}

async function newSession(workspacePath: string): Promise<RpcResponse> {
  const response = await sendCommand({ type: "new_session", workspacePath });
  if (response.success) {
    const data = response.data as { sessionPath?: string } | undefined;
    writeSessionRoutePath(data?.sessionPath ?? null, "push");
  }
  return response;
}

async function compactSession(customInstructions?: string) {
  compactingRequestCount.value += 1;

  try {
    const response = await sendCommand(
      { type: "compact", customInstructions },
      { timeoutMs: 120_000 },
    );

    if (!response.success) {
      appendCompactErrorMessage(response.error ?? "Unknown compaction error");
    }

    return response;
  } catch (error) {
    appendCompactErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    compactingRequestCount.value = Math.max(
      0,
      compactingRequestCount.value - 1,
    );
  }
}

async function setThinkingLevel(level: RpcThinkingLevel) {
  const response = await sendCommand({ type: "set_thinking_level", level });
  if (response.success) {
    currentThinkingLevel.value = normalizeThinkingLevel(level);
    updatePendingTranscriptConfigEvent({
      thinkingLevel: currentThinkingLevel.value,
    });
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
    handleEvent(envelope.payload);
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
          | (RpcTranscriptPage & { direction: "latest" | "older" })
          | undefined;
        if (data) {
          applyTranscriptPage(
            data,
            data.direction === "older" ? "prepend" : "replace",
          );
        }
        break;
      }
      case "get_state": {
        const data = payload.data as RpcSessionState | undefined;
        if (data) {
          const previousSessionPath = getDisplayedSessionPath();
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
          setSessionRunning(data.sessionFile ?? null, data.isStreaming);
          isStreaming.value = data.isStreaming;
          setCompactionState(data.isCompacting);
          if (!activeTreeSessionPath.value && data.sessionFile) {
            activeTreeSessionPath.value = data.sessionFile;
          }
          if (previousSessionPath !== getDisplayedSessionPath()) {
            resetGitRepoState();
          }
        }
        break;
      }
      case "list_sessions": {
        const data = payload.data as
          | {
              sessions?: SessionEntry[];
              workspacePath?: string;
              nextCursor?: string;
              workspaceCursors?: Record<string, string | null>;
              merge?: "replace" | "append";
            }
          | undefined;
        if (Array.isArray(data?.sessions)) {
          sessions.value =
            data.merge === "append"
              ? mergeSessionEntries(sessions.value, data.sessions)
              : data.sessions;
          syncRunningSessionsFromEntries(sessions.value);

          if (data.workspaceCursors) {
            workspaceSessionCursors.value = {
              ...workspaceSessionCursors.value,
              ...data.workspaceCursors,
            };
          } else {
            const workspacePath =
              data.workspacePath ??
              data.sessions.map(workspaceKeyForSession).find(Boolean);
            if (workspacePath) {
              workspaceSessionCursors.value = {
                ...workspaceSessionCursors.value,
                [workspacePath]: data.nextCursor ?? null,
              };
            }
          }
        }
        break;
      }
      case "switch_session": {
        const data = payload.data as
          | {
              transcript: RpcTranscriptPage;
              treeEntries?: TreeEntry[];
              sessionId?: string;
              sessionName?: string;
              sessionPath?: string;
            }
          | undefined;
        applySessionSnapshotResponse(data, { refreshState: true });
        break;
      }
      case "list_tree_entries": {
        const data = payload.data as
          | { entries: TreeEntry[]; sessionPath?: string }
          | undefined;
        if (data) {
          applyTreeEntriesUpdate(data.entries, data.sessionPath ?? null);
        }
        break;
      }
      case "new_session": {
        const data = payload.data as
          | {
              transcript: RpcTranscriptPage;
              treeEntries?: TreeEntry[];
              sessionId?: string;
              sessionName?: string;
              sessionPath?: string;
            }
          | undefined;
        if (!applySessionSnapshotResponse(data)) {
          replaceTranscript([], null);
          transcriptHasOlder.value = false;
          transcriptOldestCursor.value = null;
          transcriptNewestCursor.value = null;
          transcriptInitialLoading.value = false;
          treeEntries.value = [];
          sessionState.value = null;
          isStreaming.value = false;
        }
        setCompactionState(false);
        sendCommand({ type: "list_sessions" }).catch(() => {});
        break;
      }
      case "compact": {
        sendCommand({ type: "get_state" }).catch(() => {});
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
      case "list_git_branches": {
        const state = normalizeGitRepoState(payload.data);
        gitRepoState.value = state;
        if (!state) {
          pushNotification("Failed to parse git branch data", "error");
        }
        break;
      }
      case "switch_git_branch": {
        const state = normalizeGitRepoState(payload.data);
        applyGitRepoMutation(state);
        break;
      }
      case "create_git_branch": {
        const state = normalizeGitRepoState(payload.data);
        applyGitRepoMutation(state);
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
        updatePendingTranscriptConfigEvent({ model: currentModel.value });
        break;
      }
      case "get_available_models": {
        const data = payload.data;
        if (data) updateAvailableModels(data.models);
        break;
      }
      case "select_tree_entry": {
        const data = payload.data as
          | {
              transcript: RpcTranscriptPage;
              treeEntries?: TreeEntry[];
              sessionId?: string;
              sessionName?: string;
              sessionPath?: string;
            }
          | undefined;
        applySessionSnapshotResponse(data, { refreshState: true });
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

function handleEvent(payload: RpcBridgeEvent) {
  const eventType = payload.type;

  switch (eventType) {
    case "transcript_snapshot": {
      const data = payload as RpcTranscriptSnapshotEvent;
      if (Array.isArray(data.messages)) {
        applyTranscriptPage(data, "replace");
      }
      break;
    }
    case "transcript_upsert": {
      const data = payload as RpcTranscriptUpsertEvent;
      if (data.message) {
        upsertTranscriptMessage(data.message, data.sessionPath ?? null);
      }
      if (Array.isArray(data.treeEntries)) {
        applyTreeEntriesUpdate(data.treeEntries, data.sessionPath ?? null);
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
    case "queue_update": {
      const data = payload as RpcQueueUpdateEvent;
      const steering = Array.isArray(data.steering)
        ? data.steering
            .map(message => normalizeQueuedMessage(message))
            .filter((message): message is RpcQueuedMessage => message !== null)
        : [];
      const followUp = Array.isArray(data.followUp)
        ? data.followUp
            .map(message => normalizeQueuedMessage(message))
            .filter((message): message is RpcQueuedMessage => message !== null)
        : [];
      applyQueuedMessages(followUp, {
        sessionPath: data.sessionPath ?? null,
        steeringCount: steering.length,
      });
      break;
    }
    case "agent_start": {
      const data = payload as RpcAgentStartEvent;
      const sessionPath = data.sessionPath ?? liveSessionPath.value ?? null;
      setSessionRunning(sessionPath, true);
      if (!sessionPath || sessionPath === getDisplayedSessionPath()) {
        isStreaming.value = true;
      }
      break;
    }
    case "agent_end": {
      const data = payload as RpcAgentEndEvent;
      const sessionPath = data.sessionPath ?? liveSessionPath.value ?? null;
      setSessionRunning(sessionPath, false);
      if (!sessionPath || sessionPath === getDisplayedSessionPath()) {
        isStreaming.value = false;
        // Refresh state after agent completes
        sendCommand({ type: "get_state" }).catch(() => {});
      }
      break;
    }
    case "model_select": {
      const model = normalizeRpcModel(payload.model ?? payload);
      if (model) {
        currentModel.value = model;
        availableModels.value = upsertModel(availableModels.value, model);
      }
      break;
    }
    case "compaction_start": {
      setCompactionState(true);
      break;
    }
    case "compaction_end": {
      setCompactionState(false);
      if (
        payload.reason !== "manual" &&
        !payload.aborted &&
        typeof payload.errorMessage === "string" &&
        payload.errorMessage.trim()
      ) {
        appendCompactErrorMessage(payload.errorMessage);
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
  transcriptInitialLoading.value = true;
  const routeSessionPath = readSessionRoutePath();

  try {
    const bootstrapRequests = [
      sendCommand({
        type: "list_sessions",
        scope: "workspaces",
        limit: 10,
        includeActive: true,
      }),
      sendCommand({ type: "get_available_models" }),
      sendCommand({ type: "get_commands" }),
    ];

    if (routeSessionPath) {
      const response = await sendCommand({
        type: "switch_session",
        sessionPath: routeSessionPath,
      });
      await Promise.all(bootstrapRequests);
      if (!response.success) {
        pushNotification(
          summarizeErrorMessage(
            response.error ?? "Failed to restore session from URL",
            "Failed to restore session from URL",
          ),
          "error",
        );
        writeSessionRoutePath(null, "replace");
        await restoreLiveSessionState();
      }
      return;
    }

    await Promise.all([restoreLiveSessionState(), ...bootstrapRequests]);
  } catch {
    transcriptInitialLoading.value = false;
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
    remoteCompactionActive.value = false;
    reconnectCount.value++;
    runningSessionPaths.value = [];
    resetGitRepoState();
    sessions.value = sessions.value.map(session => ({
      ...session,
      isRunning: false,
    }));
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
  stopSessionRouteSync();
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
    startSessionRouteSync();
    connect();
  } else if (!disposed) {
    startSessionRouteSync();
  }

  const isReconnecting = computed(
    () =>
      connectionStatus.value === "disconnected" &&
      !disposed &&
      !connectionError.value,
  );

  return {
    connectionStatus: readonly(connectionStatus),
    transcript: readonly(transcript),
    transcriptHasOlder: readonly(transcriptHasOlder),
    transcriptInitialLoading: readonly(transcriptInitialLoading),
    transcriptPageLoading: readonly(transcriptPageLoading),
    pendingTranscriptConfigEvent: readonly(visiblePendingTranscriptConfigEvent),
    sessionState: readonly(sessionState),
    sessions: readonly(sessions),
    treeEntries: readonly(treeEntries),
    activeTreeSessionPath: readonly(activeTreeSessionPath),
    liveSessionPath: readonly(liveSessionPath),
    runningSessionPaths: readonly(runningSessionPaths),
    workspaceSessionCursors: readonly(workspaceSessionCursors),
    commands: readonly(commands),
    workspaceEntries: readonly(workspaceEntries),
    workspaceEntriesLoading: readonly(workspaceEntriesLoading),
    availableModels: readonly(availableModels),
    currentModel: readonly(currentModel),
    currentThinkingLevel: readonly(currentThinkingLevel),
    isStreaming: readonly(isStreaming),
    isCompacting: readonly(isCompacting),
    sessionStats: readonly(sessionStats),
    gitRepoState: readonly(gitRepoState),
    gitRepoLoading: readonly(gitRepoLoading),
    gitBranchSwitching: readonly(gitBranchSwitching),
    // Pending messages
    pendingMessageCount: computed(
      () => sessionState.value?.pendingMessageCount ?? 0,
    ),
    queuedUserMessages: readonly(queuedUserMessages),
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
    loadOlderTranscriptPage,
    fetchWorkspaceEntries,
    readWorkspaceFile,
    loadWorkspaceSessions,
    refreshWorkspaceSessions,
    loadGitRepoState,
    switchGitBranch,
    createGitBranch,
    switchSession,
    newSession,
    abortGeneration,
    compactSession,
    setThinkingLevel,
    setAutoCompactionEnabled,
    renameSession: (sessionPath: string, name: string) =>
      sendCommand({ type: "set_session_name", sessionPath, name }),
    deleteSession: (sessionPath: string) =>
      sendCommand({ type: "delete_session", sessionPath }),
    cancelQueuedMessage,
    editQueuedMessage,
    connect,
    disconnect,
  };
}
