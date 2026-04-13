import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  SessionManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import type { WebSocket } from "ws";
import type { BridgeEventBus } from "./bridge-event-bus.js";
import type {
  BridgeConfig,
  BridgeEvent,
  ClientMessage,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  RpcSessionState,
  RpcSlashCommand,
  RpcTreeEntry,
  RpcTreeTrackColumn,
  ServerMessage,
  WsClient,
} from "./types.js";
import { getPluginState, setPluginState } from "./plugin-state.js";

/**
 * Extended context available in Pi extension API
 */
interface PiExtensionContext {
  sessionManager: {
    getBranch: () => unknown[];
    getEntries: () => unknown[] | undefined;
    getSessionId: () => string;
    getSessionFile: () => string | undefined;
  };
  model: unknown;
  modelRegistry: {
    getAvailable: () => Promise<unknown[]>;
  };
  isIdle: () => boolean;
  signal: AbortSignal | undefined;
  abort: () => void;
  compact: (options?: {
    onComplete?: (result: unknown) => void;
    onError?: (error: Error) => void;
  }) => void;
  shutdown: () => void;
  hasPendingMessages: () => boolean;
  getContextUsage: () =>
    | { tokens: number | null; contextWindow: number; percent: number | null }
    | undefined;
  getSystemPrompt: () => string;
  cwd: string;
}

/**
 * Extended command context available in Pi extension API
 */
interface PiExtensionCommandContext extends PiExtensionContext {
  waitForIdle: () => Promise<void>;
  newSession: (options?: {
    parentSession?: string;
  }) => Promise<{ cancelled: boolean }>;
  fork: (entryId: string) => Promise<{ cancelled: boolean }>;
  navigateTree: (
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ) => Promise<{ cancelled: boolean }>;
  switchSession: (sessionPath: string) => Promise<{ cancelled: boolean }>;
}

/**
 * Pi extension API surface
 */
interface PiExtensionAPI {
  sendUserMessage: (
    content: string | unknown[],
    options?: { deliverAs?: "steer" | "followUp" },
  ) => void;
  setModel: (model: unknown) => Promise<boolean>;
  setThinkingLevel: (level: unknown) => void;
  getThinkingLevel: () => unknown;
  setSessionName: (name: string) => void;
  getSessionName: () => string | undefined;
  getCommands: () => Array<{
    name: string;
    description?: string;
    source: string;
  }>;
  on: (event: string, handler: (event: object) => void) => void;
}

/**
 * Context passed to the adapter containing Pi extension APIs
 */
export interface WsRpcAdapterContext {
  pi: PiExtensionAPI;
  ctx: PiExtensionCommandContext;
}

/**
 * Pending extension UI request
 */
interface PendingUIRequest {
  resolve: (value: RpcExtensionUIResponse) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  method: string;
}

interface SessionTreeNodeLike {
  entry: SessionEntry;
  children: SessionTreeNodeLike[];
  label?: string;
}

interface VisibleTreeNodeLike {
  entry: SessionEntry;
  children: VisibleTreeNodeLike[];
  label?: string;
  containsActiveLeaf: boolean;
}

interface TreeRowGutter {
  position: number;
  show: boolean;
}

const HIDDEN_TREE_ENTRY_TYPES = new Set([
  "label",
  "custom",
  "model_change",
  "thinking_level_change",
  "session_info",
]);

function openSessionManager(sessionPath: string): SessionManager {
  return SessionManager.open(sessionPath, path.dirname(sessionPath));
}

function buildVisibleTree(
  nodes: readonly SessionTreeNodeLike[],
  activeLeafId: string | null,
): VisibleTreeNodeLike[] {
  const visibleNodes: VisibleTreeNodeLike[] = [];

  for (const node of nodes) {
    const visibleChildren = buildVisibleTree(node.children, activeLeafId);
    const containsActiveLeaf =
      node.entry.id === activeLeafId ||
      visibleChildren.some((child) => child.containsActiveLeaf);
    const hidden = HIDDEN_TREE_ENTRY_TYPES.has(node.entry.type);

    if (hidden) {
      visibleNodes.push(...visibleChildren);
      continue;
    }

    visibleNodes.push({
      entry: node.entry,
      children: visibleChildren,
      label: node.label,
      containsActiveLeaf,
    });
  }

  return visibleNodes;
}

function flattenVisibleTree(
  nodes: readonly VisibleTreeNodeLike[],
): RpcTreeEntry[] {
  const entries: RpcTreeEntry[] = [];
  const multipleRoots = nodes.length > 1;
  const orderedRoots = orderTreeChildren(nodes);
  const stack: Array<{
    node: VisibleTreeNodeLike;
    indent: number;
    justBranched: boolean;
    showConnector: boolean;
    isLast: boolean;
    gutters: TreeRowGutter[];
    isVirtualRootChild: boolean;
    parentId: string | null;
  }> = [];

  for (let index = orderedRoots.length - 1; index >= 0; index--) {
    stack.push({
      node: orderedRoots[index],
      indent: multipleRoots ? 1 : 0,
      justBranched: multipleRoots,
      showConnector: multipleRoots,
      isLast: index === orderedRoots.length - 1,
      gutters: [],
      isVirtualRootChild: multipleRoots,
      parentId: null,
    });
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const {
      node,
      indent,
      justBranched,
      showConnector,
      isLast,
      gutters,
      isVirtualRootChild,
      parentId,
    } = current;
    const displayIndent = multipleRoots ? Math.max(0, indent - 1) : indent;
    const connectorDisplayed = showConnector && !isVirtualRootChild;
    const connectorPosition = connectorDisplayed
      ? Math.max(0, displayIndent - 1)
      : -1;
    const children = orderTreeChildren(node.children);
    const hasActiveChild = children.some((child) => child.containsActiveLeaf);

    entries.push({
      id: node.entry.id,
      parentId,
      label: formatTreeEntryLabel(node),
      type: node.entry.type,
      timestamp: node.entry.timestamp,
      depth: displayIndent,
      trackColumns: buildTrackColumns(
        displayIndent,
        connectorPosition,
        isLast,
        gutters,
      ),
      isActive: node.containsActiveLeaf && !hasActiveChild,
      isOnActivePath: node.containsActiveLeaf,
    });

    const multipleChildren = children.length > 1;
    const childIndent = multipleChildren
      ? indent + 1
      : justBranched && indent > 0
        ? indent + 1
        : indent;
    const childGutters = connectorDisplayed
      ? [...gutters, { position: connectorPosition, show: !isLast }]
      : gutters;

    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({
        node: children[index],
        indent: childIndent,
        justBranched: multipleChildren,
        showConnector: multipleChildren,
        isLast: index === children.length - 1,
        gutters: childGutters,
        isVirtualRootChild: false,
        parentId: node.entry.id,
      });
    }
  }

  return entries;
}

function buildTrackColumns(
  displayIndent: number,
  connectorPosition: number,
  isLast: boolean,
  gutters: readonly TreeRowGutter[],
): RpcTreeTrackColumn[] {
  const columns: RpcTreeTrackColumn[] = [];

  for (let level = 0; level < displayIndent; level++) {
    const gutter = gutters.find((item) => item.position === level);
    if (gutter) {
      columns.push(gutter.show ? "line" : "blank");
      continue;
    }
    if (connectorPosition === level) {
      columns.push(isLast ? "branch-last" : "branch");
      continue;
    }
    columns.push("blank");
  }

  return columns;
}

function orderTreeChildren(
  children: readonly VisibleTreeNodeLike[],
): VisibleTreeNodeLike[] {
  const activeChildren = children.filter((child) => child.containsActiveLeaf);
  const inactiveChildren = children.filter(
    (child) => !child.containsActiveLeaf,
  );
  return [...activeChildren, ...inactiveChildren];
}

function buildTreeEntriesFromSession(
  sessionManager: SessionManager,
): RpcTreeEntry[] {
  const activeLeafId = sessionManager.getLeafId();
  const visibleTree = buildVisibleTree(
    sessionManager.getTree() as SessionTreeNodeLike[],
    activeLeafId,
  );
  return flattenVisibleTree(orderTreeChildren(visibleTree));
}

function buildTreeEntriesFromBranch(
  branch: readonly unknown[],
): RpcTreeEntry[] {
  return branch
    .filter((entry) => {
      const typedEntry = entry as { type?: string; id?: string };
      if (!typedEntry.id) return false;
      if (typedEntry.type && HIDDEN_TREE_ENTRY_TYPES.has(typedEntry.type))
        return false;
      return true;
    })
    .map((entry, index) => {
      const typedEntry = entry as
        | SessionEntry
        | ({ role?: string; content?: unknown; text?: string } & Record<
            string,
            unknown
          >);
      const type =
        typeof typedEntry.type === "string"
          ? typedEntry.type
          : ((typedEntry as { role?: string }).role ?? "unknown");
      return {
        id: String((typedEntry as { id: string }).id),
        parentId:
          index === 0
            ? null
            : String((branch[index - 1] as { id?: string }).id ?? ""),
        label: formatFallbackTreeEntryLabel(typedEntry),
        type,
        timestamp:
          typeof (typedEntry as { timestamp?: string }).timestamp === "string"
            ? (typedEntry as { timestamp: string }).timestamp
            : undefined,
        depth: 0,
        trackColumns: [],
        isActive: index === branch.length - 1,
        isOnActivePath: true,
      };
    });
}

function buildTreeEntriesForSessionPath(sessionPath: string): RpcTreeEntry[] {
  const sessionManager = openSessionManager(sessionPath);
  return buildTreeEntriesFromSession(sessionManager);
}

function flattenMessagesForTranscript(
  branch: readonly SessionEntry[],
): unknown[] {
  return branch
    .filter((entry) => entry.type === "message")
    .map((entry) => {
      const messageEntry = entry as Extract<SessionEntry, { type: "message" }>;
      return {
        id: messageEntry.id,
        ...messageEntry.message,
        timestamp: messageEntry.timestamp,
      };
    });
}

function findLatestModelInfo(
  branch: readonly SessionEntry[],
): { provider: string; id: string } | null {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "model_change") {
      return { provider: entry.provider, id: entry.modelId };
    }
  }

  return null;
}

function buildStateFromStoredSession(sessionManager: SessionManager): RpcSessionState {
  const branch = sessionManager.getBranch();
  const context = sessionManager.buildSessionContext();
  const model = findLatestModelInfo(branch);

  return {
    model,
    thinkingLevel: context.thinkingLevel,
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "all",
    sessionFile: sessionManager.getSessionFile(),
    sessionId: sessionManager.getSessionId(),
    sessionName:
      sessionManager.getSessionName() ??
      sessionDisplayName(sessionManager, sessionManager.getSessionFile()),
    autoCompactionEnabled: false,
    messageCount: sessionManager.getEntries()?.length ?? 0,
    pendingMessageCount: 0,
  };
}

function toClientEventPayload(event: AgentSessionEvent): Record<string, unknown> {
  switch (event.type) {
    case "message_start":
      return { type: event.type, ...event.message };
    case "message_update":
      return {
        type: event.type,
        ...event.message,
        assistantMessageEvent: event.assistantMessageEvent,
      };
    case "message_end":
      return { type: event.type, ...event.message };
    default:
      return event as unknown as Record<string, unknown>;
  }
}

function formatTreeEntryLabel(node: SessionTreeNodeLike): string {
  const labelPrefix = node.label ? `[${node.label}] ` : "";
  return `${labelPrefix}${describeSessionEntry(node.entry)}`.trim();
}

function sessionDisplayName(
  sessionManager: SessionManager,
  sessionPath?: string,
): string {
  const explicitName = sessionManager.getSessionName()?.trim();
  if (explicitName) return explicitName;

  const firstUserEntry = sessionManager
    .getEntries()
    .find((entry) => entry.type === "message" && entry.message.role === "user");
  if (firstUserEntry && firstUserEntry.type === "message") {
    const text = collapseWhitespace(
      extractMessageText(
        firstUserEntry.message as { content?: unknown; text?: string },
      ),
    );
    if (text) return text;
  }

  return sessionPath
    ? path.basename(sessionPath, ".jsonl")
    : sessionManager.getSessionId();
}

function formatFallbackTreeEntryLabel(
  entry:
    | SessionEntry
    | ({ role?: string; content?: unknown; text?: string } & Record<
        string,
        unknown
      >),
): string {
  if ((entry as { type?: string }).type === "message" && "message" in entry) {
    return describeSessionEntry(entry as SessionEntry);
  }

  const role =
    typeof (entry as { role?: string }).role === "string"
      ? (entry as { role: string }).role
      : undefined;
  if (role) {
    const content = collapseWhitespace(
      extractMessageText(entry as { content?: unknown; text?: string }),
    );
    return content ? `${role}: ${content}` : role;
  }

  return describeSessionEntry(entry as SessionEntry);
}

function describeSessionEntry(entry: SessionEntry): string {
  switch (entry.type) {
    case "message":
      return describeMessage(
        entry.message as {
          role?: string;
          content?: unknown;
          text?: string;
          stopReason?: string;
          errorMessage?: string;
          toolName?: string;
          command?: string;
        },
      );
    case "custom_message": {
      const customText = Array.isArray(entry.content)
        ? entry.content
            .filter(
              (item) =>
                typeof item === "object" &&
                item !== null &&
                (item as { type?: string }).type === "text",
            )
            .map((item) => (item as { text?: string }).text ?? "")
            .join(" ")
        : typeof entry.content === "string"
          ? entry.content
          : "";
      const content = collapseWhitespace(customText);
      return content
        ? `[${entry.customType}]: ${content}`
        : `[${entry.customType}]`;
    }
    case "compaction":
      return `[compaction: ${Math.round(entry.tokensBefore / 1000)}k tokens]`;
    case "branch_summary":
      return `[branch summary]: ${collapseWhitespace(entry.summary)}`;
    case "model_change":
      return `[model: ${entry.modelId}]`;
    case "thinking_level_change":
      return `[thinking: ${entry.thinkingLevel}]`;
    case "session_info":
      return entry.name ? `[title: ${entry.name}]` : "[title]";
    case "custom":
      return `[custom: ${entry.customType}]`;
    case "label":
      return entry.label ? `[label: ${entry.label}]` : "[label]";
    default:
      return (entry as { type: string }).type;
  }
}

function describeMessage(message: {
  role?: string;
  content?: unknown;
  text?: string;
  stopReason?: string;
  errorMessage?: string;
  toolName?: string;
  command?: string;
}): string {
  const role = message.role ?? "message";
  const content = collapseWhitespace(extractMessageText(message));

  switch (role) {
    case "user":
      return content ? `user: ${content}` : "user";
    case "assistant":
      if (content) return `assistant: ${content}`;
      if (message.stopReason === "aborted") return "assistant: (aborted)";
      if (message.errorMessage)
        return `assistant: ${collapseWhitespace(message.errorMessage)}`;
      return "assistant: (no content)";
    case "toolResult":
      return message.toolName ? `[tool: ${message.toolName}]` : "[tool result]";
    case "bashExecution":
      return message.command
        ? `[bash]: ${collapseWhitespace(message.command)}`
        : "[bash]";
    default:
      return content ? `${role}: ${content}` : `[${role}]`;
  }
}

function extractMessageText(message: {
  content?: unknown;
  text?: string;
}): string {
  if (typeof message.content === "string") return message.content;
  if (typeof message.text === "string") return message.text;
  if (!Array.isArray(message.content)) return "";

  return message.content
    .map((block) => {
      if (typeof block === "string") return block;
      if (typeof block !== "object" || block === null) return "";
      const typedBlock = block as {
        type?: string;
        text?: string;
        thinking?: string;
      };
      if (typedBlock.type === "text" || typedBlock.type === "toolResult") {
        return typeof typedBlock.text === "string" ? typedBlock.text : "";
      }
      if (typedBlock.type === "thinking") {
        return typeof typedBlock.thinking === "string"
          ? typedBlock.thinking
          : "";
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * WS-RPC adapter handles:
 * - Command dispatch from WebSocket clients to Pi
 * - Extension UI request routing to specific clients
 * - Event subscription and fan-out via BridgeEventBus
 */
export class WsRpcAdapter {
  private client: WsClient;
  private ws: WebSocket;
  private context: WsRpcAdapterContext;
  private config: BridgeConfig;
  private eventBus: BridgeEventBus;
  private emitEvent: (event: BridgeEvent) => void;

  // Pending extension UI requests keyed by request ID
  private pendingUIRequests = new Map<string, PendingUIRequest>();

  // Event subscription unsubscribe function
  private unsubscribeEvents: (() => void) | undefined;

  // Track if adapter is disposed
  private disposed = false;

  // Session selected in the browser client. When set, prompts and mutable
  // session operations run against a detached SDK session instead of the live
  // /web command runtime.
  private selectedSessionPath: string | null = null;
  private selectedSession: AgentSession | null = null;
  private selectedSessionUnsubscribe: (() => void) | undefined;

  constructor(
    client: WsClient,
    ws: WebSocket,
    context: WsRpcAdapterContext,
    config: BridgeConfig,
    eventBus: BridgeEventBus,
    emitEvent: (event: BridgeEvent) => void,
  ) {
    this.client = client;
    this.ws = ws;
    this.context = context;
    this.config = config;
    this.eventBus = eventBus;
    this.emitEvent = emitEvent;

    this.setupWebSocket();
    this.subscribeToEvents();
  }

  /**
   * Setup WebSocket message handlers
   */
  private setupWebSocket(): void {
    this.ws.on("message", (data) => {
      if (this.disposed) return;
      this.handleMessage(data.toString());
    });

    this.ws.on("close", () => {
      this.dispose();
    });

    this.ws.on("error", (err) => {
      console.error(`WsRpcAdapter[${this.client.id}]: WebSocket error:`, err);
      this.emitEvent({
        type: "command_error",
        client: this.client,
        commandType: "websocket",
        error: err.message,
      });
    });
  }

  /**
   * Subscribe to Pi events and broadcast them
   */
  subscribeToEvents(): void {
    // Subscribe to all Pi events via the extension API
    this.context.pi.on("agent_start", (event: object) => {
      this.eventBus.broadcast({ type: "agent_start", ...event });
    });

    this.context.pi.on("agent_end", (event: object) => {
      this.eventBus.broadcast({ type: "agent_end", ...event });
    });

    this.context.pi.on("message_start", (event: object) => {
      this.eventBus.broadcast({ type: "message_start", ...event });
    });

    this.context.pi.on("message_update", (event: object) => {
      this.eventBus.broadcast({ type: "message_update", ...event });
    });

    this.context.pi.on("message_end", (event: object) => {
      this.eventBus.broadcast({ type: "message_end", ...event });
    });

    this.context.pi.on("turn_start", (event: object) => {
      this.eventBus.broadcast({ type: "turn_start", ...event });
    });

    this.context.pi.on("turn_end", (event: object) => {
      this.eventBus.broadcast({ type: "turn_end", ...event });
    });

    this.context.pi.on("tool_execution_start", (event: object) => {
      this.eventBus.broadcast({ type: "tool_execution_start", ...event });
    });

    this.context.pi.on("tool_execution_update", (event: object) => {
      this.eventBus.broadcast({ type: "tool_execution_update", ...event });
    });

    this.context.pi.on("tool_execution_end", (event: object) => {
      this.eventBus.broadcast({ type: "tool_execution_end", ...event });
    });

    this.context.pi.on("model_select", (event: object) => {
      this.eventBus.broadcast({ type: "model_select", ...event });
    });
  }

  private disposeSelectedSession(): void {
    this.selectedSessionUnsubscribe?.();
    this.selectedSessionUnsubscribe = undefined;
    this.selectedSession?.dispose();
    this.selectedSession = null;
  }

  private async ensureSelectedSession(): Promise<AgentSession> {
    const sessionPath = this.selectedSessionPath;
    if (!sessionPath || !fs.existsSync(sessionPath)) {
      throw new Error("Selected session file not found");
    }

    if (this.selectedSession?.sessionFile === sessionPath) {
      return this.selectedSession;
    }

    this.disposeSelectedSession();

    const sessionManager = openSessionManager(sessionPath);
    const created = await createAgentSession({
      cwd: sessionManager.getCwd() || this.context.ctx.cwd,
      sessionManager,
    });

    await created.session.bindExtensions({
      uiContext: this.createExtensionUIContext() as never,
      onError: (error) => {
        console.error(
          `WsRpcAdapter[${this.client.id}]: Detached session extension error:`,
          error,
        );
      },
      shutdownHandler: () => {},
    });

    this.selectedSession = created.session;
    this.selectedSessionUnsubscribe = created.session.subscribe((event) => {
      this.sendResponse({
        type: "event",
        payload: toClientEventPayload(event),
      });
    });

    return created.session;
  }

  private buildActiveState(): RpcSessionState {
    if (this.selectedSession) {
      return {
        model: this.selectedSession.model ?? findLatestModelInfo(this.selectedSession.sessionManager.getBranch()),
        thinkingLevel: this.selectedSession.thinkingLevel,
        isStreaming: this.selectedSession.isStreaming,
        isCompacting: this.selectedSession.isCompacting,
        steeringMode: this.selectedSession.steeringMode,
        followUpMode: this.selectedSession.followUpMode,
        sessionFile: this.selectedSession.sessionFile,
        sessionId: this.selectedSession.sessionId,
        sessionName:
          this.selectedSession.sessionManager.getSessionName() ??
          sessionDisplayName(
            this.selectedSession.sessionManager,
            this.selectedSession.sessionFile,
          ),
        autoCompactionEnabled: this.selectedSession.autoCompactionEnabled,
        messageCount: this.selectedSession.sessionManager.getEntries()?.length ?? 0,
        pendingMessageCount: this.selectedSession.pendingMessageCount,
      };
    }

    if (this.selectedSessionPath && fs.existsSync(this.selectedSessionPath)) {
      return buildStateFromStoredSession(openSessionManager(this.selectedSessionPath));
    }

    const { pi, ctx } = this.context;
    return {
      model: ctx.model,
      thinkingLevel: pi.getThinkingLevel(),
      isStreaming: !ctx.isIdle(),
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      sessionFile: ctx.sessionManager.getSessionFile(),
      sessionId: ctx.sessionManager.getSessionId(),
      sessionName: pi.getSessionName() ?? undefined,
      autoCompactionEnabled: false,
      messageCount: ctx.sessionManager.getEntries()?.length ?? 0,
      pendingMessageCount: ctx.hasPendingMessages() ? 1 : 0,
    };
  }

  private buildSwitchSessionResponse(
    correlationId: string,
    sessionManager: SessionManager,
    sessionPath: string,
  ): RpcResponse {
    return {
      id: correlationId,
      type: "response",
      command: "switch_session",
      success: true,
      data: {
        messages: flattenMessagesForTranscript(sessionManager.getBranch()),
        treeEntries: buildTreeEntriesFromSession(sessionManager),
        sessionId: sessionManager.getSessionId(),
        sessionName: sessionDisplayName(sessionManager, sessionPath),
        sessionPath,
        cancelled: false,
      },
    };
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(data) as ClientMessage;
    } catch (err) {
      this.sendResponse({
        type: "response",
        payload: {
          type: "response",
          command: "parse",
          success: false,
          error: `Failed to parse message: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
      return;
    }

    if (message.type === "command") {
      void this.handleCommand(message.payload);
    } else if (message.type === "extension_ui_response") {
      this.handleUIResponse(message.payload);
    } else {
      this.sendResponse({
        type: "response",
        payload: {
          type: "response",
          command: "unknown",
          success: false,
          error: `Unknown message type`,
        },
      });
    }
  }

  /**
   * Handle RPC command dispatch
   */
  private async handleCommand(command: RpcCommand): Promise<void> {
    const correlationId = command.id ?? crypto.randomUUID();

    this.emitEvent({
      type: "command_received",
      client: this.client,
      commandType: command.type,
      correlationId,
    });

    try {
      const response = await this.dispatchCommand(command, correlationId);
      this.sendResponse({ type: "response", payload: response });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(
        `WsRpcAdapter[${this.client.id}]: Command error (${command.type}):`,
        error,
      );

      this.emitEvent({
        type: "command_error",
        client: this.client,
        commandType: command.type,
        correlationId,
        error,
      });

      this.sendResponse({
        type: "response",
        payload: {
          id: correlationId,
          type: "response",
          command: command.type,
          success: false,
          error,
        },
      });
    }
  }

  /**
   * Dispatch command to Pi extension API
   */
  private async dispatchCommand(
    command: RpcCommand,
    correlationId: string,
  ): Promise<RpcResponse> {
    const { pi, ctx } = this.context;

    switch (command.type) {
      // =================================================================
      // Prompting (use ONLY extension API)
      // =================================================================

      case "prompt": {
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          const promptOptions = session.isStreaming
            ? {
                source: "rpc" as const,
                streamingBehavior: command.streamingBehavior ?? "steer",
              }
            : { source: "rpc" as const };

          setTimeout(() => {
            void session.prompt(command.message, promptOptions).catch((error) => {
              const message =
                error instanceof Error ? error.message : String(error);
              console.error(
                `WsRpcAdapter[${this.client.id}]: Detached prompt failed:`,
                message,
              );
              this.emitEvent({
                type: "command_error",
                client: this.client,
                commandType: "prompt",
                correlationId,
                error: message,
              });
            });
          }, 0);
        } else {
          pi.sendUserMessage(command.message, {
            deliverAs: command.streamingBehavior ?? "steer",
          });
        }
        return {
          id: correlationId,
          type: "response",
          command: "prompt",
          success: true,
        };
      }

      case "steer": {
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          void session.steer(command.message).catch((error) => {
            console.error(
              `WsRpcAdapter[${this.client.id}]: Detached steer failed:`,
              error,
            );
          });
        } else {
          pi.sendUserMessage(command.message, { deliverAs: "steer" });
        }
        return {
          id: correlationId,
          type: "response",
          command: "steer",
          success: true,
        };
      }

      case "follow_up": {
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          void session.followUp(command.message).catch((error) => {
            console.error(
              `WsRpcAdapter[${this.client.id}]: Detached follow_up failed:`,
              error,
            );
          });
        } else {
          pi.sendUserMessage(command.message, { deliverAs: "followUp" });
        }
        return {
          id: correlationId,
          type: "response",
          command: "follow_up",
          success: true,
        };
      }

      case "abort": {
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          await session.abort();
        } else {
          ctx.abort();
        }
        return {
          id: correlationId,
          type: "response",
          command: "abort",
          success: true,
        };
      }

      // =================================================================
      // State (reconstruct from ctx)
      // =================================================================

      case "get_state": {
        return {
          id: correlationId,
          type: "response",
          command: "get_state",
          success: true,
          data: this.buildActiveState(),
        };
      }

      // =================================================================
      // Model (use extension API)
      // =================================================================

      case "set_model": {
        const modelRegistry = this.selectedSession
          ? this.selectedSession.modelRegistry
          : ctx.modelRegistry;
        const models = await modelRegistry.getAvailable();
        const model = models.find(
          (m: unknown) =>
            (m as { provider: string; id: string }).provider ===
              command.provider &&
            (m as { provider: string; id: string }).id === command.modelId,
        );
        if (!model) {
          return {
            id: correlationId,
            type: "response",
            command: "set_model",
            success: false,
            error: `Model not found: ${command.provider}/${command.modelId}`,
          };
        }
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          await session.setModel(model as never);
        } else {
          await pi.setModel(model);
        }
        return {
          id: correlationId,
          type: "response",
          command: "set_model",
          success: true,
          data: model,
        };
      }

      case "get_available_models": {
        const modelRegistry = this.selectedSession
          ? this.selectedSession.modelRegistry
          : ctx.modelRegistry;
        const models = await modelRegistry.getAvailable();
        return {
          id: correlationId,
          type: "response",
          command: "get_available_models",
          success: true,
          data: { models },
        };
      }

      case "cycle_model": {
        // Not directly supported via extension API
        return {
          id: correlationId,
          type: "response",
          command: "cycle_model",
          success: false,
          error: "cycle_model not supported via bridge",
        };
      }

      // =================================================================
      // Thinking (use extension API)
      // =================================================================

      case "set_thinking_level": {
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          session.setThinkingLevel(command.level as never);
        } else {
          pi.setThinkingLevel(command.level);
        }
        return {
          id: correlationId,
          type: "response",
          command: "set_thinking_level",
          success: true,
        };
      }

      case "cycle_thinking_level": {
        // Not directly supported via extension API
        return {
          id: correlationId,
          type: "response",
          command: "cycle_thinking_level",
          success: false,
          error: "cycle_thinking_level not supported via bridge",
        };
      }

      // =================================================================
      // Queue modes (not supported via extension API)
      // =================================================================

      case "set_steering_mode": {
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          session.setSteeringMode(command.mode);
          return {
            id: correlationId,
            type: "response",
            command: "set_steering_mode",
            success: true,
          };
        }
        return {
          id: correlationId,
          type: "response",
          command: "set_steering_mode",
          success: false,
          error: "set_steering_mode not supported via bridge",
        };
      }

      case "set_follow_up_mode": {
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          session.setFollowUpMode(command.mode);
          return {
            id: correlationId,
            type: "response",
            command: "set_follow_up_mode",
            success: true,
          };
        }
        return {
          id: correlationId,
          type: "response",
          command: "set_follow_up_mode",
          success: false,
          error: "set_follow_up_mode not supported via bridge",
        };
      }

      // =================================================================
      // Compaction (use ctx.compact)
      // =================================================================

      case "compact": {
        if (this.selectedSessionPath) {
          try {
            const session = await this.ensureSelectedSession();
            const result = await session.compact(command.customInstructions);
            return {
              id: correlationId,
              type: "response",
              command: "compact",
              success: true,
              data: result,
            };
          } catch (error) {
            return {
              id: correlationId,
              type: "response",
              command: "compact",
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }

        return new Promise((resolve) => {
          ctx.compact({
            onComplete: (result) => {
              resolve({
                id: correlationId,
                type: "response",
                command: "compact",
                success: true,
                data: result,
              });
            },
            onError: (error) => {
              resolve({
                id: correlationId,
                type: "response",
                command: "compact",
                success: false,
                error: error.message,
              });
            },
          });
        });
      }

      case "set_auto_compaction": {
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          session.setAutoCompactionEnabled(command.enabled);
          return {
            id: correlationId,
            type: "response",
            command: "set_auto_compaction",
            success: true,
          };
        }
        return {
          id: correlationId,
          type: "response",
          command: "set_auto_compaction",
          success: false,
          error: "set_auto_compaction not supported via bridge",
        };
      }

      // =================================================================
      // Retry (not supported via extension API)
      // =================================================================

      case "set_auto_retry":
      case "abort_retry": {
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          if (command.type === "set_auto_retry") {
            session.setAutoRetryEnabled(command.enabled);
          } else {
            session.abortRetry();
          }
          return {
            id: correlationId,
            type: "response",
            command: command.type,
            success: true,
          };
        }
        return {
          id: correlationId,
          type: "response",
          command: command.type,
          success: false,
          error: `${command.type} not supported via bridge`,
        };
      }

      // =================================================================
      // Bash (not supported via extension API - security)
      // =================================================================

      case "bash":
      case "abort_bash": {
        return {
          id: correlationId,
          type: "response",
          command: command.type,
          success: false,
          error: `${command.type} not supported via bridge for security`,
        };
      }

      // =================================================================
      // Session (use ctx methods)
      // =================================================================

      case "get_session_stats": {
        const requestedPath = command.sessionPath as string | undefined;
        const selectedSessionPath = this.selectedSessionPath;
        // Always use the actual live Pi session file, not the web-selected one.
        // selectedSessionPath is for detached prompt routing, not for stats lookup.
        const liveSessionPath = ctx.sessionManager.getSessionFile();
        const targetPath =
          requestedPath ?? selectedSessionPath ?? liveSessionPath;

        if (
          this.selectedSession &&
          (!targetPath || targetPath === this.selectedSession.sessionFile)
        ) {
          const stats = this.selectedSession.getSessionStats();
          return {
            id: correlationId,
            type: "response",
            command: "get_session_stats",
            success: true,
            data: {
              tokens: stats.contextUsage?.tokens ?? null,
              contextWindow: stats.contextUsage?.contextWindow ?? 0,
              percent: stats.contextUsage?.percent ?? null,
              messageCount: stats.totalMessages,
              cost: stats.cost,
            },
          };
        }

        // If targeting a stored session different from the live session, read from disk.
        if (targetPath && targetPath !== liveSessionPath && fs.existsSync(targetPath)) {
          try {
            const diskSession = openSessionManager(targetPath);
            const branch = diskSession.getBranch();
            let totalCost = 0;
            let lastAssistantEntry: {
              usage?: {
                input?: number;
                output?: number;
                cacheRead?: number;
                cacheWrite?: number;
              };
            } | null = null;
            let lastModel: { provider?: string; modelId?: string } | null =
              null;
            for (const entry of branch) {
              const e = entry as {
                type?: string;
                provider?: string;
                modelId?: string;
                message?: {
                  role?: string;
                  usage?: {
                    cost?: { total?: number };
                    input?: number;
                    output?: number;
                    cacheRead?: number;
                    cacheWrite?: number;
                  };
                };
              };
              if (e.type === "model_change") {
                lastModel = { provider: e.provider, modelId: e.modelId };
              }
              if (
                e.type === "message" &&
                e.message?.role === "assistant" &&
                e.message?.usage?.cost
              ) {
                totalCost += e.message.usage.cost.total ?? 0;
                // Only use entries with actual input tokens for context estimation
                if ((e.message.usage.input ?? 0) > 0) {
                  lastAssistantEntry = e.message;
                }
              }
            }

            // Reconstruct context info from last assistant usage + model registry
            let tokens: number | null = null;
            let contextWindow = 0;
            let percent: number | null = null;
            if (lastAssistantEntry?.usage) {
              const u = lastAssistantEntry.usage;
              tokens =
                (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
            }
            if (lastModel?.provider && lastModel?.modelId && tokens != null) {
              const models = await ctx.modelRegistry.getAvailable();
              const matched = models.find(
                (m: unknown) =>
                  (m as { provider: string; id: string }).provider ===
                    lastModel!.provider &&
                  (m as { provider: string; id: string }).id ===
                    lastModel!.modelId,
              );
              if (matched) {
                contextWindow =
                  (matched as { contextWindow?: number }).contextWindow ?? 0;
                if (contextWindow > 0) {
                  percent =
                    Math.round((tokens / contextWindow) * 100 * 10) / 10;
                }
              }
            }

            return {
              id: correlationId,
              type: "response",
              command: "get_session_stats",
              success: true,
              data: {
                tokens,
                contextWindow,
                percent,
                messageCount: diskSession.getEntries()?.length ?? 0,
                cost: totalCost,
              },
            };
          } catch {
            // Fall through to live session stats
          }
        }

        // Live session: use context API, with fallback to branch reconstruction
        const usage = ctx.getContextUsage();
        const branch = ctx.sessionManager.getBranch();
        let totalCost = 0;
        let lastAssistantUsage: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
        } | null = null;
        let lastModel: { provider?: string; modelId?: string } | null = null;
        for (const entry of branch) {
          const e = entry as {
            type?: string;
            provider?: string;
            modelId?: string;
            message?: {
              role?: string;
              usage?: {
                cost?: { total?: number };
                input?: number;
                output?: number;
                cacheRead?: number;
                cacheWrite?: number;
              };
            };
          };
          if (e.type === "model_change") {
            lastModel = { provider: e.provider, modelId: e.modelId };
          }
          if (
            e.type === "message" &&
            e.message?.role === "assistant" &&
            e.message?.usage?.cost
          ) {
            totalCost += e.message.usage.cost.total ?? 0;
            if ((e.message.usage.input ?? 0) > 0) {
              lastAssistantUsage = e.message.usage;
            }
          }
        }

        let tokens: number | null = usage?.tokens ?? null;
        let contextWindow: number = usage?.contextWindow ?? 0;
        let percent: number | null = usage?.percent ?? null;

        // Fallback: reconstruct from branch entries when getContextUsage() is empty
        if (tokens == null && lastAssistantUsage) {
          tokens =
            (lastAssistantUsage.input ?? 0) +
            (lastAssistantUsage.cacheRead ?? 0) +
            (lastAssistantUsage.cacheWrite ?? 0);
        }
        if (
          contextWindow === 0 &&
          lastModel?.provider &&
          lastModel?.modelId &&
          tokens != null
        ) {
          try {
            const models = await ctx.modelRegistry.getAvailable();
            const matched = models.find(
              (m: unknown) =>
                (m as { provider: string; id: string }).provider ===
                  lastModel!.provider &&
                (m as { provider: string; id: string }).id ===
                  lastModel!.modelId,
            );
            if (matched) {
              contextWindow =
                (matched as { contextWindow?: number }).contextWindow ?? 0;
            }
          } catch {
            // Model registry unavailable; skip context window lookup
          }
        }
        if (percent == null && tokens != null && contextWindow > 0) {
          percent = Math.round((tokens / contextWindow) * 100 * 10) / 10;
        }

        return {
          id: correlationId,
          type: "response",
          command: "get_session_stats",
          success: true,
          data: {
            tokens,
            contextWindow,
            percent,
            messageCount: ctx.sessionManager.getEntries()?.length ?? 0,
            cost: totalCost,
          },
        };
      }

      case "export_html": {
        return {
          id: correlationId,
          type: "response",
          command: "export_html",
          success: false,
          error: "export_html not supported via bridge",
        };
      }

      case "switch_session": {
        try {
          const sessionPath = command.sessionPath as string;
          if (!sessionPath || !fs.existsSync(sessionPath)) {
            return {
              id: correlationId,
              type: "response",
              command: "switch_session",
              success: false,
              error: "Session file not found",
            };
          }

          this.selectedSessionPath = sessionPath;
          if (
            this.selectedSession &&
            this.selectedSession.sessionFile !== sessionPath
          ) {
            this.disposeSelectedSession();
          }

          const sessionManager = openSessionManager(sessionPath);
          return this.buildSwitchSessionResponse(
            correlationId,
            sessionManager,
            sessionPath,
          );
        } catch (err) {
          return {
            id: correlationId,
            type: "response",
            command: "switch_session",
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      case "fork": {
        const result = await ctx.fork(command.entryId);
        return {
          id: correlationId,
          type: "response",
          command: "fork",
          success: true,
          data: { text: "", ...result },
        };
      }

      case "get_fork_messages": {
        // Not directly available via extension API
        return {
          id: correlationId,
          type: "response",
          command: "get_fork_messages",
          success: false,
          error: "get_fork_messages not supported via bridge",
        };
      }

      case "get_last_assistant_text": {
        // Not directly available via extension API
        return {
          id: correlationId,
          type: "response",
          command: "get_last_assistant_text",
          success: false,
          error: "get_last_assistant_text not supported via bridge",
        };
      }

      case "set_session_name": {
        const name = command.name.trim();
        if (!name) {
          return {
            id: correlationId,
            type: "response",
            command: "set_session_name",
            success: false,
            error: "Session name cannot be empty",
          };
        }
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          session.sessionManager.appendSessionInfo(name);
        } else {
          pi.setSessionName(name);
        }
        return {
          id: correlationId,
          type: "response",
          command: "set_session_name",
          success: true,
        };
      }

      case "new_session": {
        const cwd = ctx.cwd;
        const currentSessionFile =
          this.selectedSessionPath ?? ctx.sessionManager.getSessionFile();
        const sessionDir = currentSessionFile
          ? path.dirname(currentSessionFile)
          : undefined;

        this.disposeSelectedSession();

        const sessionManager = SessionManager.create(cwd, sessionDir);
        const sessionFile = sessionManager.getSessionFile();
        if (sessionFile) {
          this.selectedSessionPath = sessionFile;
        }

        return {
          id: correlationId,
          type: "response",
          command: "new_session",
          success: true,
          data: {
            messages: flattenMessagesForTranscript(sessionManager.getBranch()),
            treeEntries: buildTreeEntriesFromSession(sessionManager),
            sessionId: sessionManager.getSessionId(),
            sessionName: sessionDisplayName(sessionManager, sessionFile),
            sessionPath: sessionFile ?? "",
            cancelled: false,
          },
        };
      }

      // =================================================================
      // Messages (use ctx.sessionManager)
      // =================================================================

      case "get_messages": {
        if (this.selectedSession) {
          return {
            id: correlationId,
            type: "response",
            command: "get_messages",
            success: true,
            data: {
              messages: flattenMessagesForTranscript(
                this.selectedSession.sessionManager.getBranch(),
              ),
            },
          };
        }

        if (this.selectedSessionPath && fs.existsSync(this.selectedSessionPath)) {
          const sessionManager = openSessionManager(this.selectedSessionPath);
          return {
            id: correlationId,
            type: "response",
            command: "get_messages",
            success: true,
            data: {
              messages: flattenMessagesForTranscript(sessionManager.getBranch()),
            },
          };
        }

        const entries = ctx.sessionManager.getBranch();
        const messages = entries.filter((e: unknown) => {
          const entry = e as { role?: string; type?: string };
          return entry.role !== undefined || entry.type === "message";
        });
        return {
          id: correlationId,
          type: "response",
          command: "get_messages",
          success: true,
          data: { messages },
        };
      }

      // =================================================================
      // Commands (use pi.getCommands)
      // =================================================================

      case "get_commands": {
        const commands = pi.getCommands();
        const rpcCommands: RpcSlashCommand[] = commands.map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          source: "extension" as const,
        }));
        return {
          id: correlationId,
          type: "response",
          command: "get_commands",
          success: true,
          data: { commands: rpcCommands },
        };
      }

      // =================================================================
      // Navigate Tree (use ctx.navigateTree)
      // =================================================================

      case "navigate_tree": {
        const result = this.selectedSessionPath
          ? await (await this.ensureSelectedSession()).navigateTree(
              command.entryId,
              {
                summarize: command.summarize,
                customInstructions: command.customInstructions,
                replaceInstructions: command.replaceInstructions,
                label: command.label,
              },
            )
          : await ctx.navigateTree(command.entryId, {
              summarize: command.summarize,
              customInstructions: command.customInstructions,
              replaceInstructions: command.replaceInstructions,
              label: command.label,
            });
        return {
          id: correlationId,
          type: "response" as const,
          command: "navigate_tree" as const,
          success: true as const,
          data: result,
        };
      }

      // =================================================================
      // Discovery (session list + tree entries for sidebar rails)
      // =================================================================

      case "list_sessions": {
        try {
          const sessions: Array<{
            id: string;
            name: string;
            path: string;
            timestamp?: string;
          }> = [];
          const currentSessionFile =
            this.selectedSessionPath ?? ctx.sessionManager.getSessionFile();
          const sessionDir = currentSessionFile
            ? path.dirname(currentSessionFile)
            : undefined;

          if (sessionDir && fs.existsSync(sessionDir)) {
            const files = fs
              .readdirSync(sessionDir)
              .filter((f: string) => f.endsWith(".jsonl"))
              .sort()
              .reverse(); // newest first

            for (const file of files) {
              const filePath = path.join(sessionDir, file);
              try {
                const sessionManager = openSessionManager(filePath);
                const header = sessionManager.getHeader();
                if (!header) continue;
                sessions.push({
                  id: header.id,
                  name: sessionDisplayName(sessionManager, filePath),
                  path: filePath,
                  timestamp: header.timestamp,
                });
              } catch {
                // Skip malformed session files
              }
            }
          }
          return {
            id: correlationId,
            type: "response" as const,
            command: "list_sessions" as const,
            success: true as const,
            data: { sessions },
          };
        } catch {
          return {
            id: correlationId,
            type: "response" as const,
            command: "list_sessions" as const,
            success: true as const,
            data: {
              sessions: [] as Array<{
                id: string;
                name: string;
                path: string;
                timestamp?: string;
              }>,
            },
          };
        }
      }

      case "list_tree_entries": {
        try {
          const requestedSessionPath = command.sessionPath;
          const liveSessionPath =
            this.selectedSessionPath ?? ctx.sessionManager.getSessionFile();
          const sessionPath = requestedSessionPath ?? liveSessionPath;
          const entries =
            sessionPath && fs.existsSync(sessionPath)
              ? buildTreeEntriesForSessionPath(sessionPath)
              : buildTreeEntriesFromBranch(ctx.sessionManager.getBranch());
          return {
            id: correlationId,
            type: "response" as const,
            command: "list_tree_entries" as const,
            success: true as const,
            data: { entries, sessionPath: sessionPath ?? undefined },
          };
        } catch {
          return {
            id: correlationId,
            type: "response" as const,
            command: "list_tree_entries" as const,
            success: true as const,
            data: {
              entries: [] as RpcTreeEntry[],
              sessionPath: command.sessionPath,
            },
          };
        }
      }

      // =================================================================
      // Plugin state persistence (~/.pi/agent/pi-web.json)
      // =================================================================

      case "get_plugin_state": {
        const value = getPluginState(command.key);
        return {
          id: correlationId,
          type: "response" as const,
          command: "get_plugin_state" as const,
          success: true as const,
          data: { value },
        };
      }

      case "set_plugin_state": {
        setPluginState(command.key, command.value);
        return {
          id: correlationId,
          type: "response" as const,
          command: "set_plugin_state" as const,
          success: true as const,
        };
      }

      default: {
        const unknownCommand = command as { type: string };
        return {
          id: correlationId,
          type: "response",
          command: unknownCommand.type,
          success: false,
          error: `Unknown command: ${unknownCommand.type}`,
        };
      }
    }
  }

  /**
   * Handle extension UI response from client
   */
  private handleUIResponse(response: RpcExtensionUIResponse): void {
    const pending = this.pendingUIRequests.get(response.id);
    if (!pending) {
      console.warn(
        `WsRpcAdapter[${this.client.id}]: Received UI response for unknown request: ${response.id}`,
      );
      return;
    }

    // Clear timeout
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingUIRequests.delete(response.id);

    console.log(
      `WsRpcAdapter[${this.client.id}]: UI request ${response.id} (${pending.method}) resolved`,
    );

    // Pass the full response object to the resolver
    pending.resolve(response);
  }

  /**
   * Create an extension UI context for routing UI requests to this WS client
   */
  createExtensionUIContext() {
    const createDialogPromise = <T>(
      request: Record<string, unknown>,
      defaultValue: T,
      parseResponse: (response: RpcExtensionUIResponse) => T,
    ): Promise<T> => {
      const id = crypto.randomUUID();

      return new Promise((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          this.pendingUIRequests.delete(id);
        };

        timeoutId = setTimeout(() => {
          console.log(
            `WsRpcAdapter[${this.client.id}]: UI request ${id} (${request.method}) timed out`,
          );
          cleanup();
          resolve(defaultValue);
        }, this.config.uiRequestTimeout);

        this.pendingUIRequests.set(id, {
          resolve: (value: RpcExtensionUIResponse) => {
            cleanup();
            resolve(parseResponse(value));
          },
          reject,
          timeoutId,
          method: request.method as string,
        });

        const envelope: ServerMessage = {
          type: "extension_ui_request",
          payload: {
            type: "extension_ui_request",
            id,
            ...request,
          } as RpcExtensionUIRequest,
        };

        console.log(
          `WsRpcAdapter[${this.client.id}]: Sending UI request ${id} (${request.method})`,
        );
        this.sendResponse(envelope);
      });
    };

    const setEditorText = (text: string) => {
      const id = crypto.randomUUID();
      const envelope: ServerMessage = {
        type: "extension_ui_request",
        payload: {
          type: "extension_ui_request",
          id,
          method: "set_editor_text",
          text,
        } as RpcExtensionUIRequest,
      };
      this.sendResponse(envelope);
    };

    return {
      select: (
        title: string,
        options: string[],
        opts?: { timeout?: number; signal?: AbortSignal },
      ) =>
        createDialogPromise(
          { method: "select", title, options, timeout: opts?.timeout },
          undefined as string | undefined,
          (r) =>
            "cancelled" in r && r.cancelled
              ? undefined
              : "value" in r
                ? r.value
                : undefined,
        ),

      confirm: (
        title: string,
        message: string,
        opts?: { timeout?: number; signal?: AbortSignal },
      ) =>
        createDialogPromise(
          { method: "confirm", title, message, timeout: opts?.timeout },
          false,
          (r) =>
            "cancelled" in r && r.cancelled
              ? false
              : "confirmed" in r
                ? r.confirmed
                : false,
        ),

      input: (
        title: string,
        placeholder?: string,
        opts?: { timeout?: number; signal?: AbortSignal },
      ) =>
        createDialogPromise(
          { method: "input", title, placeholder, timeout: opts?.timeout },
          undefined as string | undefined,
          (r) =>
            "cancelled" in r && r.cancelled
              ? undefined
              : "value" in r
                ? r.value
                : undefined,
        ),

      editor: (title: string, prefill?: string) =>
        createDialogPromise(
          { method: "editor", title, prefill },
          undefined as string | undefined,
          (r) =>
            "cancelled" in r && r.cancelled
              ? undefined
              : "value" in r
                ? r.value
                : undefined,
        ),

      notify: (message: string, notifyType?: "info" | "warning" | "error") => {
        const id = crypto.randomUUID();
        const envelope: ServerMessage = {
          type: "extension_ui_request",
          payload: {
            type: "extension_ui_request",
            id,
            method: "notify",
            message,
            notifyType,
          } as RpcExtensionUIRequest,
        };
        this.sendResponse(envelope);
      },

      setStatus: (key: string, statusText: string | undefined) => {
        const id = crypto.randomUUID();
        const envelope: ServerMessage = {
          type: "extension_ui_request",
          payload: {
            type: "extension_ui_request",
            id,
            method: "setStatus",
            statusKey: key,
            statusText,
          } as RpcExtensionUIRequest,
        };
        this.sendResponse(envelope);
      },

      setWidget: (
        key: string,
        widgetLines: string[] | undefined,
        options?: { placement?: "aboveEditor" | "belowEditor" },
      ) => {
        const id = crypto.randomUUID();
        const envelope: ServerMessage = {
          type: "extension_ui_request",
          payload: {
            type: "extension_ui_request",
            id,
            method: "setWidget",
            widgetKey: key,
            widgetLines,
            widgetPlacement: options?.placement,
          } as RpcExtensionUIRequest,
        };
        this.sendResponse(envelope);
      },

      setTitle: (title: string) => {
        const id = crypto.randomUUID();
        const envelope: ServerMessage = {
          type: "extension_ui_request",
          payload: {
            type: "extension_ui_request",
            id,
            method: "setTitle",
            title,
          } as RpcExtensionUIRequest,
        };
        this.sendResponse(envelope);
      },

      setEditorText,

      getEditorText: () => "", // Synchronous - not supported
      onTerminalInput: () => () => {}, // Not supported
      setWorkingMessage: () => {}, // Not supported
      setHiddenThinkingLabel: () => {}, // Not supported
      setFooter: () => {}, // Not supported
      setHeader: () => {}, // Not supported
      custom: async () => undefined, // Not supported
      pasteToEditor: (text: string) => {
        setEditorText(text);
      },
      setEditorComponent: () => {}, // Not supported
      theme: {} as unknown, // Not available
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Not supported" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  /**
   * Send a response to the WebSocket client
   */
  private sendResponse(message: ServerMessage): void {
    if (this.disposed || this.ws.readyState !== 1) {
      // WebSocket.OPEN = 1
      return;
    }
    try {
      this.ws.send(JSON.stringify(message));
    } catch (err) {
      console.error(
        `WsRpcAdapter[${this.client.id}]: Failed to send response:`,
        err,
      );
    }
  }

  /**
   * Dispose the adapter, cleaning up pending requests and subscriptions
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    console.log(`WsRpcAdapter[${this.client.id}]: Disposing adapter`);

    // Resolve all pending UI requests with cancelled response
    for (const [id, pending] of this.pendingUIRequests) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      console.log(
        `WsRpcAdapter[${this.client.id}]: Resolving UI request ${id} (${pending.method}) on disconnect`,
      );
      // Resolve with a cancelled response
      pending.resolve({
        type: "extension_ui_response",
        id,
        cancelled: true,
      } as RpcExtensionUIResponse);
    }
    this.pendingUIRequests.clear();

    // Unsubscribe from events
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
    }

    this.disposeSelectedSession();

    // Notify event bus
    this.emitEvent({
      type: "client_disconnect",
      client: this.client,
      reason: "adapter_disposed",
    });
  }
}
