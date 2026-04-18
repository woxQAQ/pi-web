import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  SessionManager,
  createAgentSession,
  type AgentEndEvent as PiAgentEndEvent,
  type AgentSession,
  type AgentSessionEvent,
  type AgentStartEvent as PiAgentStartEvent,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionUIContext,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import type { WebSocket } from "ws";
import type { BridgeEventBus } from "./bridge-event-bus.js";
import { getPluginState, setPluginState } from "./plugin-state.js";
import type {
  BridgeConfig,
  BridgeEvent,
  ClientMessage,
  RpcAgentEndEvent,
  RpcAgentMessage,
  RpcAgentStartEvent,
  RpcBridgeEvent,
  RpcCommand,
  RpcCompactionEndEvent,
  RpcCompactionStartEvent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcImageContent,
  RpcModel,
  RpcModelSelectEvent,
  RpcResponse,
  RpcSessionState,
  RpcSessionStats,
  RpcSessionStatsEvent,
  RpcSlashCommand,
  RpcThinkingLevel,
  RpcTranscriptMessage,
  RpcTranscriptPage,
  RpcTranscriptSnapshotEvent,
  RpcTranscriptUpsertEvent,
  RpcTreeEntry,
  RpcWorkspaceEntry,
  RpcTreeTrackColumn,
  ServerMessage,
  WsClient,
} from "./types.js";

type PiModel = Parameters<ExtensionAPI["setModel"]>[0];
type PiThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type UserMessageContent = Parameters<ExtensionAPI["sendUserMessage"]>[0];
type UserMessageBlock = Exclude<UserMessageContent, string>[number];
type PiTextContent = Extract<UserMessageBlock, { type: "text" }>;
type PiAgentMessage = NonNullable<PiAgentEndEvent["messages"]>[number];
type PiAgentUserMessage = Extract<PiAgentMessage, { role: "user" }>;
type PiAgentAssistantMessage = Extract<PiAgentMessage, { role: "assistant" }>;
type PiAgentToolResultMessage = Extract<PiAgentMessage, { role: "toolResult" }>;
type PiAgentUserContentBlock = Exclude<
  PiAgentUserMessage["content"],
  string
>[number];
type PiAgentAssistantContentBlock = PiAgentAssistantMessage["content"][number];
type PiAgentToolResultContentBlock =
  PiAgentToolResultMessage["content"][number];
type PiAgentTextOrImageContentBlock =
  | PiAgentUserContentBlock
  | PiAgentToolResultContentBlock;
type RpcAgentUserContentBlock = Exclude<
  Extract<RpcAgentMessage, { role: "user" }>["content"],
  string
>[number];
type RpcAgentAssistantContentBlock = Extract<
  RpcAgentMessage,
  { role: "assistant" }
>["content"][number];
type RpcAgentToolResultContentBlock = Extract<
  RpcAgentMessage,
  { role: "toolResult" }
>["content"][number];
type RpcAgentTextOrImageContentBlock =
  | RpcAgentUserContentBlock
  | RpcAgentToolResultContentBlock;
type PiModelSelectEventLike = {
  model: PiModel;
  previousModel?: PiModel;
  source: RpcModelSelectEvent["source"];
};

/**
 * Context passed to the adapter containing Pi extension APIs.
 */
export interface WsRpcAdapterContext {
  pi: ExtensionAPI;
  ctx: ExtensionCommandContext;
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

interface TranscriptSyncState {
  sessionPath: string | null;
  nextEphemeralId: number;
  messageIdToKey: Map<string, string>;
  openKeysByRole: Map<string, string[]>;
}

function toRpcAgentStartEvent(): RpcAgentStartEvent {
  return { type: "agent_start" };
}

function toRpcAgentEndEvent(event: {
  messages?: PiAgentEndEvent["messages"];
}): RpcAgentEndEvent {
  if (!Array.isArray(event.messages)) {
    return { type: "agent_end" };
  }

  return {
    type: "agent_end",
    messages: event.messages.flatMap(message => {
      const shaped = toRpcAgentMessage(message);
      return shaped ? [shaped] : [];
    }),
  };
}

function toRpcAgentMessage(message: PiAgentMessage): RpcAgentMessage | null {
  switch (message.role) {
    case "user":
      return {
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : message.content.map(toRpcAgentTextOrImageContentBlock),
        timestamp: message.timestamp,
      };
    case "assistant":
      return {
        role: "assistant",
        content: message.content.map(toRpcAgentAssistantContentBlock),
        api: message.api,
        provider: message.provider,
        model: message.model,
        responseId: message.responseId,
        usage: {
          input: message.usage.input,
          output: message.usage.output,
          cacheRead: message.usage.cacheRead,
          cacheWrite: message.usage.cacheWrite,
          totalTokens: message.usage.totalTokens,
          cost: {
            input: message.usage.cost.input,
            output: message.usage.cost.output,
            cacheRead: message.usage.cost.cacheRead,
            cacheWrite: message.usage.cost.cacheWrite,
            total: message.usage.cost.total,
          },
        },
        stopReason: message.stopReason,
        errorMessage: message.errorMessage,
        timestamp: message.timestamp,
      };
    case "toolResult":
      return {
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content.map(toRpcAgentTextOrImageContentBlock),
        details: message.details,
        isError: message.isError,
        timestamp: message.timestamp,
      };
    default:
      return null;
  }
}

function toRpcAgentTextOrImageContentBlock(
  block: PiAgentTextOrImageContentBlock,
): RpcAgentTextOrImageContentBlock {
  switch (block.type) {
    case "text":
      return {
        type: "text",
        text: block.text,
        textSignature: block.textSignature,
      };
    case "image":
      return {
        type: "image",
        data: block.data,
        mimeType: block.mimeType,
      };
  }
}

function toRpcAgentAssistantContentBlock(
  block: PiAgentAssistantContentBlock,
): RpcAgentAssistantContentBlock {
  switch (block.type) {
    case "text":
      return {
        type: "text",
        text: block.text,
        textSignature: block.textSignature,
      };
    case "thinking":
      return {
        type: "thinking",
        thinking: block.thinking,
        thinkingSignature: block.thinkingSignature,
        redacted: block.redacted,
      };
    case "toolCall":
      return {
        type: "toolCall",
        id: block.id,
        name: block.name,
        arguments: block.arguments,
        thoughtSignature: block.thoughtSignature,
      };
  }
}

function toRpcModel(model: PiModel): RpcModel {
  return {
    id: model.id,
    provider: model.provider,
    name: model.name,
    api: model.api,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

function isPiModel(value: unknown): value is PiModel {
  if (!value || typeof value !== "object") return false;
  const typedValue = value as { id?: unknown; provider?: unknown };
  return (
    typeof typedValue.id === "string" && typeof typedValue.provider === "string"
  );
}

function isModelSelectSource(
  value: unknown,
): value is RpcModelSelectEvent["source"] {
  return value === "set" || value === "cycle" || value === "restore";
}

function isPiModelSelectEventLike(
  value: unknown,
): value is PiModelSelectEventLike {
  if (!value || typeof value !== "object") return false;
  const typedValue = value as {
    model?: unknown;
    previousModel?: unknown;
    source?: unknown;
  };
  return (
    isPiModel(typedValue.model) &&
    (typedValue.previousModel === undefined ||
      isPiModel(typedValue.previousModel)) &&
    isModelSelectSource(typedValue.source)
  );
}

function toRpcModelSelectEvent(
  event: PiModelSelectEventLike,
): RpcModelSelectEvent {
  return {
    type: "model_select",
    model: toRpcModel(event.model),
    previousModel: event.previousModel
      ? toRpcModel(event.previousModel)
      : undefined,
    source: event.source,
  };
}

function toRpcCompactionStartEvent(
  event: Extract<AgentSessionEvent, { type: "compaction_start" }>,
): RpcCompactionStartEvent {
  return {
    type: "compaction_start",
    reason: event.reason,
  };
}

function toRpcCompactionEndEvent(
  event: Extract<AgentSessionEvent, { type: "compaction_end" }>,
): RpcCompactionEndEvent {
  return {
    type: "compaction_end",
    reason: event.reason,
    result: event.result
      ? {
          summary: event.result.summary,
          firstKeptEntryId: event.result.firstKeptEntryId,
          tokensBefore: event.result.tokensBefore,
          details: event.result.details,
        }
      : null,
    aborted: event.aborted,
    willRetry: event.willRetry,
    errorMessage: event.errorMessage,
  };
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

interface TreeEntryPresentation {
  role: Exclude<RpcTreeEntry["role"], undefined>;
  labelTag?: string;
  previewText: string;
  searchText: string;
  isSettingsEntry: boolean;
  isLabeled: boolean;
  isToolOnlyAssistant: boolean;
}

const TREE_HARD_HIDDEN_ENTRY_TYPES = new Set(["label"]);
const TREE_SETTINGS_ENTRY_TYPES = new Set([
  "custom",
  "model_change",
  "thinking_level_change",
  "session_info",
]);

function openSessionManager(sessionPath: string): SessionManager {
  return SessionManager.open(sessionPath, path.dirname(sessionPath));
}

function normalizeWorkspacePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function collectWorkspaceEntries(
  filePaths: readonly string[],
): RpcWorkspaceEntry[] {
  const files = new Set<string>();
  const directories = new Set<string>();

  for (const rawFilePath of filePaths) {
    const filePath = normalizeWorkspacePath(rawFilePath.trim());
    if (!filePath) continue;

    files.add(filePath);

    let currentDir = path.posix.dirname(filePath);
    while (currentDir && currentDir !== ".") {
      if (directories.has(currentDir)) break;
      directories.add(currentDir);
      currentDir = path.posix.dirname(currentDir);
    }
  }

  return [
    ...Array.from(directories)
      .sort((a, b) => a.localeCompare(b))
      .map(entryPath => ({ path: entryPath, kind: "directory" as const })),
    ...Array.from(files)
      .sort((a, b) => a.localeCompare(b))
      .map(entryPath => ({ path: entryPath, kind: "file" as const })),
  ];
}

function listWorkspaceFilesWithRipgrep(cwd: string): string[] | null {
  const args = ["--files", "--hidden", "-g", "!.git"];
  const rootIgnoreFile = path.join(cwd, ".gitignore");
  if (fs.existsSync(rootIgnoreFile)) {
    args.push("--ignore-file", rootIgnoreFile);
  }

  const result = spawnSync("rg", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function listWorkspaceFilesFallback(cwd: string): string[] {
  const files: string[] = [];
  const stack = [""];
  const rootIgnoreFile = path.join(cwd, ".gitignore");
  const ignoredPatterns = fs.existsSync(rootIgnoreFile)
    ? new Set(
        fs
          .readFileSync(rootIgnoreFile, "utf8")
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.length > 0 && !line.startsWith("#")),
      )
    : new Set<string>();

  while (stack.length > 0) {
    const currentRelativeDir = stack.pop();
    if (currentRelativeDir === undefined) continue;

    const absoluteDir = currentRelativeDir
      ? path.join(cwd, currentRelativeDir)
      : cwd;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }

      const relativePath = currentRelativeDir
        ? path.join(currentRelativeDir, entry.name)
        : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);
      const normalizedRelativePath = normalizeWorkspacePath(relativePath);
      if (
        ignoredPatterns.has(entry.name) ||
        ignoredPatterns.has(normalizedRelativePath)
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(relativePath);
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        try {
          const stats = fs.statSync(absolutePath);
          if (stats.isDirectory()) {
            stack.push(relativePath);
          } else if (stats.isFile()) {
            files.push(relativePath);
          }
        } catch {
          // Ignore broken links while building the workspace index.
        }
      }
    }
  }

  return files;
}

function listWorkspaceEntries(cwd: string): RpcWorkspaceEntry[] {
  const filePaths =
    listWorkspaceFilesWithRipgrep(cwd) ?? listWorkspaceFilesFallback(cwd);
  return collectWorkspaceEntries(filePaths);
}

function isTreeSettingsEntry(type: string): boolean {
  return TREE_SETTINGS_ENTRY_TYPES.has(type);
}

function getTreeEntryRole(
  entry:
    | SessionEntry
    | ({ role?: string; type?: string } & Record<string, unknown>),
): Exclude<RpcTreeEntry["role"], undefined> {
  const entryType = typeof entry.type === "string" ? entry.type : undefined;

  if (entryType === "message") {
    const messageRole =
      typeof (entry as { message?: { role?: string } }).message?.role ===
      "string"
        ? (entry as { message: { role: string } }).message.role
        : typeof (entry as { role?: string }).role === "string"
          ? (entry as { role: string }).role
          : undefined;

    if (messageRole === "user") return "user";
    if (messageRole === "assistant") return "assistant";
    if (messageRole === "toolResult" || messageRole === "bashExecution") {
      return "tool";
    }
    return "other";
  }

  if (
    entryType === "custom" ||
    entryType === "model_change" ||
    entryType === "thinking_level_change" ||
    entryType === "session_info" ||
    entryType === "compaction" ||
    entryType === "branch_summary"
  ) {
    return "meta";
  }

  return "other";
}

function isToolOnlyAssistantEntry(
  entry:
    | SessionEntry
    | ({ role?: string; content?: unknown; text?: string } & Record<
        string,
        unknown
      >),
): boolean {
  if (entry.type !== "message") return false;

  const message = (
    entry as SessionEntry & {
      message?: {
        role?: string;
        content?: unknown;
        text?: string;
        stopReason?: string;
        errorMessage?: string;
      };
    }
  ).message;

  if (!message || message.role !== "assistant") return false;
  if (collapseWhitespace(extractMessageText(message))) return false;
  if (message.stopReason === "aborted") return false;
  return !message.errorMessage;
}

function buildTreePreviewText(
  entry:
    | SessionEntry
    | ({ role?: string; content?: unknown; text?: string } & Record<
        string,
        unknown
      >),
): string {
  if ((entry as { type?: string }).type === "message" && "message" in entry) {
    const message = (
      entry as SessionEntry & {
        message: {
          role?: string;
          content?: unknown;
          text?: string;
          stopReason?: string;
          errorMessage?: string;
          toolName?: string;
          command?: string;
        };
      }
    ).message;
    const content = collapseWhitespace(extractMessageText(message));

    switch (message.role) {
      case "user":
        return content || "user";
      case "assistant":
        if (content) return content;
        if (message.stopReason === "aborted") return "(aborted)";
        if (message.errorMessage) {
          return collapseWhitespace(message.errorMessage);
        }
        return "(no content)";
      case "toolResult":
        return message.toolName
          ? `[tool: ${message.toolName}]`
          : "[tool result]";
      case "bashExecution":
        return message.command
          ? `[bash]: ${collapseWhitespace(message.command)}`
          : "[bash]";
      default:
        return describeMessage(message);
    }
  }

  if (typeof (entry as { role?: string }).role === "string") {
    const role = (entry as { role: string }).role;
    const content = collapseWhitespace(
      extractMessageText(entry as { content?: unknown; text?: string }),
    );
    if (role === "user") return content || "user";
    if (role === "assistant") return content || "assistant";
    return content ? `${role}: ${content}` : `[${role}]`;
  }

  return describeSessionEntry(entry as SessionEntry);
}

function buildTreeSearchText(
  entryLabel: string,
  previewText: string,
  entryType: string,
  role: Exclude<RpcTreeEntry["role"], undefined>,
  labelTag?: string,
): string {
  return [labelTag, previewText, entryLabel, entryType, role]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .join(" ");
}

function buildTreeEntryPresentation(
  entry:
    | SessionEntry
    | ({ role?: string; content?: unknown; text?: string } & Record<
        string,
        unknown
      >),
  entryLabel: string,
  labelTag?: string,
): TreeEntryPresentation {
  const entryType =
    typeof (entry as { type?: string }).type === "string"
      ? (entry as { type: string }).type
      : typeof (entry as { role?: string }).role === "string"
        ? (entry as { role: string }).role
        : "unknown";
  const role = getTreeEntryRole(entry);
  const previewText = buildTreePreviewText(entry);

  return {
    role,
    labelTag,
    previewText,
    searchText: buildTreeSearchText(
      entryLabel,
      previewText,
      entryType,
      role,
      labelTag,
    ),
    isSettingsEntry: isTreeSettingsEntry(entryType),
    isLabeled: Boolean(labelTag),
    isToolOnlyAssistant: isToolOnlyAssistantEntry(entry),
  };
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
      visibleChildren.some(child => child.containsActiveLeaf);
    const hidden = TREE_HARD_HIDDEN_ENTRY_TYPES.has(node.entry.type);

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
    const hasActiveChild = children.some(child => child.containsActiveLeaf);

    const entryLabel = formatTreeEntryLabel(node);
    const presentation = buildTreeEntryPresentation(
      node.entry,
      entryLabel,
      node.label,
    );

    entries.push({
      id: node.entry.id,
      parentId,
      label: entryLabel,
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
      role: presentation.role,
      labelTag: presentation.labelTag,
      previewText: presentation.previewText,
      searchText: presentation.searchText,
      isSettingsEntry: presentation.isSettingsEntry,
      isLabeled: presentation.isLabeled,
      isToolOnlyAssistant: presentation.isToolOnlyAssistant,
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
    const gutter = gutters.find(item => item.position === level);
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
  const activeChildren = children.filter(child => child.containsActiveLeaf);
  const inactiveChildren = children.filter(child => !child.containsActiveLeaf);
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
  const visibleEntries = branch.filter(entry => {
    const typedEntry = entry as { type?: string; id?: string };
    if (!typedEntry.id) return false;
    if (typedEntry.type && TREE_HARD_HIDDEN_ENTRY_TYPES.has(typedEntry.type)) {
      return false;
    }
    return true;
  });

  return visibleEntries.map((entry, index) => {
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
    const entryLabel = formatFallbackTreeEntryLabel(typedEntry);
    const presentation = buildTreeEntryPresentation(typedEntry, entryLabel);

    return {
      id: String((typedEntry as { id: string }).id),
      parentId:
        index === 0
          ? null
          : String((visibleEntries[index - 1] as { id?: string }).id ?? ""),
      label: entryLabel,
      type,
      timestamp:
        typeof (typedEntry as { timestamp?: string }).timestamp === "string"
          ? (typedEntry as { timestamp: string }).timestamp
          : undefined,
      depth: 0,
      trackColumns: [],
      isActive: index === visibleEntries.length - 1,
      isOnActivePath: true,
      role: presentation.role,
      labelTag: presentation.labelTag,
      previewText: presentation.previewText,
      searchText: presentation.searchText,
      isSettingsEntry: presentation.isSettingsEntry,
      isLabeled: presentation.isLabeled,
      isToolOnlyAssistant: presentation.isToolOnlyAssistant,
    };
  });
}

function buildTreeEntriesForSessionPath(sessionPath: string): RpcTreeEntry[] {
  const sessionManager = openSessionManager(sessionPath);
  return buildTreeEntriesFromSession(sessionManager);
}

function transcriptMessageFromBranchEntry(
  entry: unknown,
  fallbackKey: string,
): RpcTranscriptMessage | null {
  if (!entry || typeof entry !== "object") return null;

  const typedEntry = entry as {
    type?: string;
    id?: unknown;
    role?: unknown;
    timestamp?: unknown;
    message?: unknown;
  };

  if (
    typedEntry.type === "message" &&
    typedEntry.message &&
    typeof typedEntry.message === "object"
  ) {
    const message = typedEntry.message as Record<string, unknown>;
    const id = typeof typedEntry.id === "string" ? typedEntry.id : undefined;
    const role = typeof message.role === "string" ? message.role : null;
    if (!role) return null;
    return {
      ...message,
      transcriptKey: id ?? fallbackKey,
      id,
      role,
      timestamp:
        typeof typedEntry.timestamp === "string"
          ? typedEntry.timestamp
          : undefined,
    };
  }

  if (typedEntry.type) {
    return transcriptMessageFromSessionEntry(
      typedEntry as SessionEntry,
      fallbackKey,
    );
  }

  if (typeof typedEntry.role === "string") {
    const flatMessage = typedEntry as Record<string, unknown>;
    const id = typeof typedEntry.id === "string" ? typedEntry.id : undefined;
    return {
      ...flatMessage,
      transcriptKey: id ?? fallbackKey,
      id,
      role: typedEntry.role,
      timestamp:
        typeof typedEntry.timestamp === "string"
          ? typedEntry.timestamp
          : undefined,
    };
  }

  return null;
}

function transcriptMessageFromSessionEntry(
  entry: SessionEntry,
  fallbackKey: string,
): RpcTranscriptMessage | null {
  const id = typeof entry.id === "string" ? entry.id : undefined;
  const timestamp =
    typeof entry.timestamp === "string" ? entry.timestamp : undefined;

  switch (entry.type) {
    case "compaction":
      return {
        transcriptKey: id ?? fallbackKey,
        id,
        role: "system",
        timestamp,
        content: [
          {
            type: "compaction",
            summary: entry.summary,
            tokensBefore: entry.tokensBefore,
            firstKeptEntryId: entry.firstKeptEntryId,
          },
        ],
      };
    case "branch_summary":
      return {
        transcriptKey: id ?? fallbackKey,
        id,
        role: "system",
        timestamp,
        content: [
          {
            type: "branch_summary",
            summary: entry.summary,
            fromId: entry.fromId,
          },
        ],
      };
    case "model_change":
      return {
        transcriptKey: id ?? fallbackKey,
        id,
        role: "system",
        timestamp,
        content: [
          {
            type: "model_change",
            provider: entry.provider,
            modelId: entry.modelId,
          },
        ],
      };
    case "thinking_level_change":
      return {
        transcriptKey: id ?? fallbackKey,
        id,
        role: "system",
        timestamp,
        content: [
          {
            type: "thinking_level_change",
            thinkingLevel: entry.thinkingLevel,
          },
        ],
      };
    case "session_info":
      return {
        transcriptKey: id ?? fallbackKey,
        id,
        role: "system",
        timestamp,
        content: [{ type: "session_info", name: entry.name }],
      };
    default:
      return null;
  }
}

function flattenMessagesForTranscript(
  branch: readonly unknown[],
): RpcTranscriptMessage[] {
  const messages: RpcTranscriptMessage[] = [];

  for (let index = 0; index < branch.length; index += 1) {
    const message = transcriptMessageFromBranchEntry(
      branch[index],
      `snapshot:${index}`,
    );
    if (message) {
      messages.push(message);
    }
  }

  return filterBootstrapTranscriptMessages(messages);
}

function trimAssistantContentToToolCall(
  content: RpcTranscriptMessage["content"],
  toolCallId: string,
): {
  content: RpcTranscriptMessage["content"];
  found: boolean;
} {
  if (!Array.isArray(content)) {
    return { content, found: false };
  }

  const trimmed: typeof content = [];
  for (const block of content) {
    trimmed.push(block);
    if (
      typeof block === "object" &&
      block !== null &&
      block.type === "toolCall" &&
      block.id === toolCallId
    ) {
      return { content: trimmed, found: true };
    }
  }

  return { content, found: false };
}

function buildExactSelectionTranscriptMessages(
  branch: readonly unknown[],
  targetEntryId: string,
): RpcTranscriptMessage[] {
  const messages = flattenMessagesForTranscript(branch);
  const targetIndex = messages.findIndex(
    message => message.id === targetEntryId,
  );
  if (targetIndex === -1) {
    return messages;
  }

  const targetMessage = messages[targetIndex];
  if (
    targetMessage.role !== "toolResult" ||
    typeof targetMessage.toolCallId !== "string" ||
    !targetMessage.toolCallId
  ) {
    return messages;
  }

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate.role !== "assistant") {
      continue;
    }

    const trimmed = trimAssistantContentToToolCall(
      candidate.content,
      targetMessage.toolCallId,
    );
    if (!trimmed.found) {
      return messages;
    }

    const nextMessages = [...messages];
    nextMessages[index] = {
      ...candidate,
      content: trimmed.content,
    };
    return nextMessages;
  }

  return messages;
}

function filterBootstrapTranscriptMessages(
  messages: readonly RpcTranscriptMessage[],
): RpcTranscriptMessage[] {
  if (messages.length === 0) return [];
  if (messages.some(message => !isBootstrapTranscriptMessage(message))) {
    return [...messages];
  }
  return [];
}

function isBootstrapTranscriptMessage(message: RpcTranscriptMessage): boolean {
  if (message.role !== "system" || !Array.isArray(message.content)) {
    return false;
  }
  if (message.content.length !== 1) return false;

  const [block] = message.content;
  if (typeof block !== "object" || block === null) return false;
  const type = (block as { type?: unknown }).type;
  return type === "model_change" || type === "thinking_level_change";
}

function normalizeTranscriptPageLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 40;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

function encodeTranscriptCursor(index: number): string {
  return `i:${index}`;
}

function decodeTranscriptCursor(cursor: unknown): number | null {
  if (typeof cursor !== "string") return null;
  const matched = /^i:(\d+)$/.exec(cursor);
  if (!matched) return null;
  const index = Number.parseInt(matched[1], 10);
  return Number.isInteger(index) ? index : null;
}

function buildTranscriptPage(
  messages: readonly RpcTranscriptMessage[],
  sessionPath: string | null,
  options?: {
    direction?: "latest" | "older";
    cursor?: string;
    limit?: number;
  },
): RpcTranscriptPage {
  const limit = normalizeTranscriptPageLimit(options?.limit);
  const total = messages.length;

  if (total === 0) {
    return {
      sessionPath: sessionPath ?? undefined,
      messages: [],
      hasOlder: false,
      hasNewer: false,
    };
  }

  const direction = options?.direction ?? "latest";
  let start = Math.max(0, total - limit);
  let end = total;

  if (direction === "older") {
    const cursorIndex = decodeTranscriptCursor(options?.cursor);
    const upperBound =
      cursorIndex == null
        ? Math.max(0, total - 1)
        : Math.min(total - 1, cursorIndex);
    end = Math.max(0, upperBound);
    start = Math.max(0, end - limit);
  }

  const pageMessages = messages.slice(start, end);
  const hasOlder = start > 0;
  const hasNewer = end < total;

  return {
    sessionPath: sessionPath ?? undefined,
    messages: pageMessages,
    oldestCursor:
      pageMessages.length > 0 ? encodeTranscriptCursor(start) : undefined,
    newestCursor:
      pageMessages.length > 0 ? encodeTranscriptCursor(end - 1) : undefined,
    hasOlder,
    hasNewer,
  };
}

function extractEventMessage(event: object): Record<string, unknown> | null {
  if (!event || typeof event !== "object") return null;

  const typedEvent = event as { message?: unknown; role?: unknown };
  if (typedEvent.message && typeof typedEvent.message === "object") {
    return typedEvent.message as Record<string, unknown>;
  }

  if (typeof typedEvent.role === "string") {
    return event as Record<string, unknown>;
  }

  return null;
}

function findLatestModelInfo(branch: readonly SessionEntry[]): RpcModel | null {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "model_change") {
      return { provider: entry.provider, id: entry.modelId };
    }
  }

  return null;
}

function normalizeThinkingLevel(value: string): RpcThinkingLevel {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      return "off";
  }
}

function buildStateFromStoredSession(
  sessionManager: SessionManager,
): RpcSessionState {
  const branch = sessionManager.getBranch();
  const context = sessionManager.buildSessionContext();
  const model = findLatestModelInfo(branch);

  return {
    model: model ?? undefined,
    thinkingLevel: normalizeThinkingLevel(context.thinkingLevel),
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

function formatTreeEntryLabel(node: SessionTreeNodeLike): string {
  const labelPrefix = node.label ? `[${node.label}] ` : "";
  return `${labelPrefix}${describeSessionEntry(node.entry)}`.trim();
}

function summarizeTokenUsage(
  branch: unknown[],
  entries?: unknown[] | undefined,
): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  messageCount: number;
  totalCost: number;
  lastAssistantUsage: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  } | null;
  lastModel: { provider?: string; modelId?: string } | null;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
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

    if (e.type === "message" && e.message?.role === "assistant") {
      const usage = e.message.usage;
      if (!usage) continue;
      inputTokens += usage.input ?? 0;
      outputTokens += usage.output ?? 0;
      cacheReadTokens += usage.cacheRead ?? 0;
      cacheWriteTokens += usage.cacheWrite ?? 0;
      totalCost += usage.cost?.total ?? 0;
      if ((usage.input ?? 0) > 0) {
        lastAssistantUsage = usage;
      }
    }
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    messageCount: entries?.length ?? 0,
    totalCost,
    lastAssistantUsage,
    lastModel,
  };
}

function sessionDisplayName(
  sessionManager: {
    getSessionName: () => string | undefined;
    getEntries: () => unknown[];
    getSessionId: () => string;
  },
  sessionPath?: string,
): string {
  const firstUserEntry = sessionManager.getEntries().find(entry => {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "type" in entry &&
      entry.type === "message" &&
      "message" in entry
    ) {
      const message = entry.message as { role?: unknown };
      return message.role === "user";
    }

    if (typeof entry === "object" && entry !== null && "role" in entry) {
      return entry.role === "user";
    }

    return false;
  });

  if (firstUserEntry && typeof firstUserEntry === "object") {
    const message =
      "type" in firstUserEntry &&
      firstUserEntry.type === "message" &&
      "message" in firstUserEntry
        ? (firstUserEntry.message as { content?: unknown; text?: string })
        : (firstUserEntry as { content?: unknown; text?: string });
    const text = collapseWhitespace(extractMessageText(message));
    if (text) return text;
  }

  const explicitName = sessionManager.getSessionName()?.trim();
  if (explicitName) return explicitName;

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
              item =>
                typeof item === "object" &&
                item !== null &&
                (item as { type?: string }).type === "text",
            )
            .map(item => (item as { text?: string }).text ?? "")
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

function normalizeRpcImages(images: unknown): RpcImageContent[] | undefined {
  if (!Array.isArray(images)) return undefined;

  const normalized = images.flatMap((image): RpcImageContent[] => {
    if (typeof image !== "object" || image === null) return [];

    const data = (image as { data?: unknown }).data;
    const mimeType = (image as { mimeType?: unknown }).mimeType;
    if (
      typeof data !== "string" ||
      typeof mimeType !== "string" ||
      !mimeType.startsWith("image/")
    ) {
      return [];
    }

    return [{ type: "image", data, mimeType }];
  });

  return normalized.length > 0 ? normalized : undefined;
}

function buildUserMessageContent(
  message: string,
  images?: RpcImageContent[],
): UserMessageContent {
  if (!images?.length) return message;

  const content: UserMessageBlock[] = [];
  if (message) {
    content.push({ type: "text", text: message } as PiTextContent);
  }
  content.push(...images);
  return content;
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
    .map(block => {
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
  private pendingSessionManager: SessionManager | null = null;
  private selectedSessionUnsubscribe: (() => void) | undefined;
  private workspaceEntriesCache: RpcWorkspaceEntry[] | null = null;
  private sessionStatsPushInFlight = false;
  private pendingSessionStatsPath: string | null | undefined = undefined;
  private transcriptSync: TranscriptSyncState = {
    sessionPath: null,
    nextEphemeralId: 0,
    messageIdToKey: new Map(),
    openKeysByRole: new Map(),
  };

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
    this.sendInitialTranscriptSnapshot();
    this.queueSessionStatsEvent(this.currentTranscriptSessionPath());
  }

  /**
   * Setup WebSocket message handlers
   */
  private setupWebSocket(): void {
    this.ws.on("message", data => {
      if (this.disposed) return;
      this.handleMessage(data.toString());
    });

    this.ws.on("close", () => {
      this.dispose();
    });

    this.ws.on("error", err => {
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
   * Subscribe to Pi events and route them directly to the active browser view.
   */
  subscribeToEvents(): void {
    void this.eventBus;

    this.context.pi.on("agent_start", (_event: PiAgentStartEvent) => {
      if (!this.shouldHandleLiveSessionEvents()) return;
      this.sendEvent(toRpcAgentStartEvent());
    });

    this.context.pi.on("agent_end", (event: PiAgentEndEvent) => {
      if (!this.shouldHandleLiveSessionEvents()) return;
      this.sendEvent(toRpcAgentEndEvent(event));
      this.queueSessionStatsEvent(this.currentTranscriptSessionPath());
    });

    this.context.pi.on("session_compact", () => {
      if (!this.shouldHandleLiveSessionEvents()) return;
      this.sendTranscriptSnapshot(this.buildCurrentTranscriptPage());
      this.queueSessionStatsEvent(this.currentTranscriptSessionPath());
    });

    this.context.pi.on("message_start", (event: object) => {
      if (!this.shouldHandleLiveSessionEvents()) return;
      this.handleTranscriptLifecycleEvent(
        "message_start",
        event,
        this.currentTranscriptSessionPath(),
      );
    });

    this.context.pi.on("message_update", (event: object) => {
      if (!this.shouldHandleLiveSessionEvents()) return;
      this.handleTranscriptLifecycleEvent(
        "message_update",
        event,
        this.currentTranscriptSessionPath(),
      );
    });

    this.context.pi.on("message_end", (event: object) => {
      if (!this.shouldHandleLiveSessionEvents()) return;
      this.handleTranscriptLifecycleEvent(
        "message_end",
        event,
        this.currentTranscriptSessionPath(),
      );
    });

    this.context.pi.on("model_select", event => {
      if (!this.shouldHandleLiveSessionEvents()) return;
      this.sendEvent(toRpcModelSelectEvent(event));
      this.queueSessionStatsEvent(this.currentTranscriptSessionPath());
    });
  }

  private sendEvent(payload: RpcBridgeEvent): void {
    this.sendResponse({
      type: "event",
      payload,
    });
  }

  private currentTranscriptSessionPath(): string | null {
    return (
      this.selectedSession?.sessionFile ??
      this.selectedSessionPath ??
      this.pendingSessionManager?.getSessionFile() ??
      this.context.ctx.sessionManager.getSessionFile() ??
      null
    );
  }

  private shouldHandleLiveSessionEvents(): boolean {
    const liveSessionPath = this.context.ctx.sessionManager.getSessionFile();
    return (
      !this.selectedSession &&
      (!this.selectedSessionPath ||
        this.selectedSessionPath === liveSessionPath)
    );
  }

  private buildCurrentTranscriptMessages(): RpcTranscriptMessage[] {
    if (this.selectedSession) {
      return flattenMessagesForTranscript(
        this.selectedSession.sessionManager.getBranch(),
      );
    }

    if (this.pendingSessionManager) {
      return flattenMessagesForTranscript(
        this.pendingSessionManager.getBranch(),
      );
    }

    if (this.selectedSessionPath && fs.existsSync(this.selectedSessionPath)) {
      const sessionManager = openSessionManager(this.selectedSessionPath);
      return flattenMessagesForTranscript(sessionManager.getBranch());
    }

    return flattenMessagesForTranscript(
      this.context.ctx.sessionManager.getBranch(),
    );
  }

  private buildCurrentTranscriptPage(options?: {
    direction?: "latest" | "older";
    cursor?: string;
    limit?: number;
  }): RpcTranscriptPage {
    return buildTranscriptPage(
      this.buildCurrentTranscriptMessages(),
      this.currentTranscriptSessionPath(),
      options,
    );
  }

  private resetTranscriptSync(
    messages: readonly RpcTranscriptMessage[],
    sessionPath: string | null,
  ): void {
    this.transcriptSync = {
      sessionPath,
      nextEphemeralId: 0,
      messageIdToKey: new Map(),
      openKeysByRole: new Map(),
    };

    for (const message of messages) {
      if (message.id) {
        this.transcriptSync.messageIdToKey.set(
          message.id,
          message.transcriptKey,
        );
      }
    }
  }

  private sendTranscriptSnapshot(page: RpcTranscriptPage): void {
    this.resetTranscriptSync(page.messages, page.sessionPath ?? null);
    const payload: RpcTranscriptSnapshotEvent = {
      type: "transcript_snapshot",
      ...page,
    };
    this.sendEvent(payload);
  }

  private sendInitialTranscriptSnapshot(): void {
    this.sendTranscriptSnapshot(this.buildCurrentTranscriptPage());
  }

  private nextTranscriptKey(): string {
    this.transcriptSync.nextEphemeralId += 1;
    return `live:${this.transcriptSync.nextEphemeralId}`;
  }

  private roleOpenKeys(role: string): string[] {
    const existing = this.transcriptSync.openKeysByRole.get(role);
    if (existing) return existing;
    const created: string[] = [];
    this.transcriptSync.openKeysByRole.set(role, created);
    return created;
  }

  private markRoleKeyOpen(role: string, key: string): void {
    const keys = this.roleOpenKeys(role);
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }

  private markRoleKeyClosed(role: string, key: string): void {
    const keys = this.transcriptSync.openKeysByRole.get(role);
    if (!keys) return;
    const next = keys.filter(candidate => candidate !== key);
    if (next.length > 0) {
      this.transcriptSync.openKeysByRole.set(role, next);
      return;
    }
    this.transcriptSync.openKeysByRole.delete(role);
  }

  private findOpenRoleKey(role: string): string | null {
    const keys = this.transcriptSync.openKeysByRole.get(role);
    if (!keys || keys.length === 0) return null;
    return keys[keys.length - 1] ?? null;
  }

  private resolveTranscriptKey(
    eventType: "message_start" | "message_update" | "message_end",
    message: Record<string, unknown>,
  ): string | null {
    const role = typeof message.role === "string" ? message.role : null;
    if (!role) return null;

    const messageId = typeof message.id === "string" ? message.id : null;
    if (eventType === "message_start") {
      const key =
        (messageId && this.transcriptSync.messageIdToKey.get(messageId)) ??
        this.nextTranscriptKey();
      if (messageId) {
        this.transcriptSync.messageIdToKey.set(messageId, key);
      }
      this.markRoleKeyOpen(role, key);
      return key;
    }

    const knownKey =
      (messageId && this.transcriptSync.messageIdToKey.get(messageId)) ??
      this.findOpenRoleKey(role);
    const key = knownKey ?? this.nextTranscriptKey();

    if (messageId) {
      this.transcriptSync.messageIdToKey.set(messageId, key);
    }
    if (!knownKey) {
      this.markRoleKeyOpen(role, key);
    }
    if (eventType === "message_end") {
      this.markRoleKeyClosed(role, key);
    }
    return key;
  }

  private toTranscriptMessage(
    message: Record<string, unknown>,
    transcriptKey: string,
  ): RpcTranscriptMessage | null {
    const role = typeof message.role === "string" ? message.role : null;
    if (!role) return null;

    return {
      transcriptKey,
      ...message,
      id: typeof message.id === "string" ? message.id : undefined,
      role,
      timestamp:
        typeof message.timestamp === "string" ? message.timestamp : undefined,
    };
  }

  private handleTranscriptLifecycleEvent(
    eventType: "message_start" | "message_update" | "message_end",
    event: object,
    sessionPath: string | null,
  ): void {
    const message = extractEventMessage(event);
    if (!message) return;

    if (this.transcriptSync.sessionPath !== sessionPath) {
      this.resetTranscriptSync([], sessionPath);
    }

    const transcriptKey = this.resolveTranscriptKey(eventType, message);
    if (!transcriptKey) return;

    const transcriptMessage = this.toTranscriptMessage(message, transcriptKey);
    if (!transcriptMessage) return;

    const payload: RpcTranscriptUpsertEvent = {
      type: "transcript_upsert",
      sessionPath: sessionPath ?? undefined,
      message: transcriptMessage,
    };
    this.sendEvent(payload);
    if (eventType !== "message_start") {
      this.queueSessionStatsEvent(sessionPath);
    }
  }

  private handleSelectedSessionEvent(event: AgentSessionEvent): void {
    const sessionPath = this.currentTranscriptSessionPath();
    const eventType: string = event.type;

    if (eventType === "session_compact") {
      this.sendTranscriptSnapshot(this.buildCurrentTranscriptPage());
      this.queueSessionStatsEvent(sessionPath);
      return;
    }

    if (eventType === "model_select") {
      if (!isPiModelSelectEventLike(event)) return;
      this.sendEvent(toRpcModelSelectEvent(event));
      this.queueSessionStatsEvent(sessionPath);
      return;
    }

    switch (event.type) {
      case "message_start":
      case "message_update":
      case "message_end": {
        this.handleTranscriptLifecycleEvent(event.type, event, sessionPath);
        return;
      }
      case "agent_start":
        this.sendEvent(toRpcAgentStartEvent());
        return;
      case "agent_end":
        if (this.selectedSession) {
          // AgentSession persists message_end entries before agent_end fires, so
          // this snapshot includes the real session entry IDs for the finished turn.
          this.sendTranscriptSnapshot(
            buildTranscriptPage(
              flattenMessagesForTranscript(
                this.selectedSession.sessionManager.getBranch(),
              ),
              this.selectedSession.sessionFile ?? null,
            ),
          );
        }
        this.sendEvent(toRpcAgentEndEvent(event));
        this.queueSessionStatsEvent(sessionPath);
        return;
      case "compaction_start":
        this.sendEvent(toRpcCompactionStartEvent(event));
        return;
      case "compaction_end":
        this.sendTranscriptSnapshot(this.buildCurrentTranscriptPage());
        this.sendEvent(toRpcCompactionEndEvent(event));
        this.queueSessionStatsEvent(sessionPath);
        return;
      default:
        return;
    }
  }

  private disposeSelectedSession(): void {
    this.selectedSessionUnsubscribe?.();
    this.selectedSessionUnsubscribe = undefined;
    this.selectedSession?.dispose();
    this.selectedSession = null;
    this.pendingSessionManager = null;
  }

  /**
   * Auto-create a new detached session when no session is selected.
   * This avoids calling pi.sendUserMessage() which would trigger
   * a TUI switch away from the bridge's custom terminal view.
   */
  private autoCreateSession(): void {
    const { ctx } = this.context;
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
    this.pendingSessionManager = sessionManager;
  }

  private async ensureSelectedSession(options?: {
    skipInitialSnapshot?: boolean;
  }): Promise<AgentSession> {
    const sessionPath = this.selectedSessionPath;
    if (!sessionPath) {
      throw new Error("Selected session file not found");
    }

    if (this.selectedSession?.sessionFile === sessionPath) {
      return this.selectedSession;
    }

    if (!fs.existsSync(sessionPath) && !this.pendingSessionManager) {
      throw new Error("Selected session file not found");
    }

    this.disposeSelectedSession();

    const sessionManager =
      this.pendingSessionManager ?? openSessionManager(sessionPath);
    this.pendingSessionManager = null;
    const created = await createAgentSession({
      cwd: sessionManager.getCwd() || this.context.ctx.cwd,
      sessionManager,
    });

    await created.session.bindExtensions({
      uiContext: this.createExtensionUIContext(),
      onError: error => {
        console.error(
          `WsRpcAdapter[${this.client.id}]: Detached session extension error:`,
          error,
        );
      },
      shutdownHandler: () => {},
    });

    this.selectedSession = created.session;
    this.selectedSessionUnsubscribe = created.session.subscribe(event => {
      this.handleSelectedSessionEvent(event);
    });

    if (!options?.skipInitialSnapshot) {
      this.sendTranscriptSnapshot(
        buildTranscriptPage(
          flattenMessagesForTranscript(
            created.session.sessionManager.getBranch(),
          ),
          created.session.sessionFile ?? null,
        ),
      );
    }

    return created.session;
  }

  private buildActiveState(): RpcSessionState {
    if (this.selectedSession) {
      return {
        model:
          this.selectedSession.model ??
          findLatestModelInfo(
            this.selectedSession.sessionManager.getBranch(),
          ) ??
          undefined,
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
        messageCount:
          this.selectedSession.sessionManager.getEntries()?.length ?? 0,
        pendingMessageCount: this.selectedSession.pendingMessageCount,
      };
    }

    if (
      this.selectedSessionPath &&
      (fs.existsSync(this.selectedSessionPath) || this.pendingSessionManager)
    ) {
      const sm =
        this.pendingSessionManager ??
        openSessionManager(this.selectedSessionPath);
      return buildStateFromStoredSession(sm);
    }

    const { pi, ctx } = this.context;
    const sessionFile = ctx.sessionManager.getSessionFile();
    return {
      model: ctx.model,
      thinkingLevel: pi.getThinkingLevel(),
      isStreaming: !ctx.isIdle(),
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      sessionFile,
      sessionId: ctx.sessionManager.getSessionId(),
      sessionName: sessionDisplayName(
        {
          getSessionName: () => undefined,
          getEntries: () => ctx.sessionManager.getEntries() ?? [],
          getSessionId: () => ctx.sessionManager.getSessionId(),
        },
        sessionFile,
      ),
      autoCompactionEnabled: false,
      messageCount: ctx.sessionManager.getEntries()?.length ?? 0,
      pendingMessageCount: ctx.hasPendingMessages() ? 1 : 0,
    };
  }

  private toRpcSessionStats(stats: {
    contextUsage?: {
      tokens: number | null;
      contextWindow: number;
      percent: number | null;
    };
    totalMessages: number;
    cost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
  }): RpcSessionStats {
    return {
      tokens: stats.contextUsage?.tokens ?? null,
      contextWindow: stats.contextUsage?.contextWindow ?? 0,
      percent: stats.contextUsage?.percent ?? null,
      messageCount: stats.totalMessages,
      cost: stats.cost,
      inputTokens: stats.tokens.input,
      outputTokens: stats.tokens.output,
      cacheReadTokens: stats.tokens.cacheRead,
      cacheWriteTokens: stats.tokens.cacheWrite,
    };
  }

  private async lookupContextWindow(
    provider: string | undefined,
    modelId: string | undefined,
  ): Promise<number> {
    if (!provider || !modelId) return 0;

    try {
      const models = this.context.ctx.modelRegistry.getAvailable();
      const matched = models.find(
        model => model.provider === provider && model.id === modelId,
      );
      return (
        (matched as { contextWindow?: number } | undefined)?.contextWindow ?? 0
      );
    } catch {
      return 0;
    }
  }

  private async buildSessionStats(
    targetPath?: string | null,
  ): Promise<RpcSessionStats> {
    const { ctx } = this.context;
    const selectedSessionPath = this.selectedSessionPath;
    const liveSessionPath = ctx.sessionManager.getSessionFile();
    const resolvedTargetPath =
      targetPath === undefined
        ? (selectedSessionPath ?? liveSessionPath ?? null)
        : targetPath;

    if (
      this.selectedSession &&
      (!resolvedTargetPath ||
        resolvedTargetPath === this.selectedSession.sessionFile ||
        resolvedTargetPath === selectedSessionPath)
    ) {
      return this.toRpcSessionStats(this.selectedSession.getSessionStats());
    }

    if (resolvedTargetPath && resolvedTargetPath !== liveSessionPath) {
      try {
        const storedSessionManager =
          this.pendingSessionManager?.getSessionFile() === resolvedTargetPath
            ? this.pendingSessionManager
            : fs.existsSync(resolvedTargetPath)
              ? openSessionManager(resolvedTargetPath)
              : null;

        if (storedSessionManager) {
          const branch = storedSessionManager.getBranch();
          const summary = summarizeTokenUsage(
            branch,
            storedSessionManager.getEntries(),
          );

          let tokens: number | null = null;
          let contextWindow = 0;
          let percent: number | null = null;
          if (summary.lastAssistantUsage) {
            const usage = summary.lastAssistantUsage;
            tokens =
              (usage.input ?? 0) +
              (usage.cacheRead ?? 0) +
              (usage.cacheWrite ?? 0);
          }
          if (tokens != null) {
            contextWindow = await this.lookupContextWindow(
              summary.lastModel?.provider,
              summary.lastModel?.modelId,
            );
            if (contextWindow > 0) {
              percent = Math.round((tokens / contextWindow) * 100 * 10) / 10;
            }
          }

          return {
            tokens,
            contextWindow,
            percent,
            messageCount: summary.messageCount,
            cost: summary.totalCost,
            inputTokens: summary.inputTokens,
            outputTokens: summary.outputTokens,
            cacheReadTokens: summary.cacheReadTokens,
            cacheWriteTokens: summary.cacheWriteTokens,
          };
        }
      } catch {
        // Fall through to live session stats.
      }
    }

    const usage = ctx.getContextUsage();
    const branch = ctx.sessionManager.getBranch();
    const summary = summarizeTokenUsage(
      branch,
      ctx.sessionManager.getEntries(),
    );

    let tokens: number | null = usage?.tokens ?? null;
    let contextWindow = usage?.contextWindow ?? 0;
    let percent: number | null = usage?.percent ?? null;

    if (tokens == null && summary.lastAssistantUsage) {
      tokens =
        (summary.lastAssistantUsage.input ?? 0) +
        (summary.lastAssistantUsage.cacheRead ?? 0) +
        (summary.lastAssistantUsage.cacheWrite ?? 0);
    }
    if (contextWindow === 0 && tokens != null) {
      contextWindow = await this.lookupContextWindow(
        summary.lastModel?.provider,
        summary.lastModel?.modelId,
      );
    }
    if (percent == null && tokens != null && contextWindow > 0) {
      percent = Math.round((tokens / contextWindow) * 100 * 10) / 10;
    }

    return {
      tokens,
      contextWindow,
      percent,
      messageCount: summary.messageCount,
      cost: summary.totalCost,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cacheReadTokens: summary.cacheReadTokens,
      cacheWriteTokens: summary.cacheWriteTokens,
    };
  }

  private queueSessionStatsEvent(sessionPath: string | null): void {
    this.pendingSessionStatsPath = sessionPath;
    if (this.sessionStatsPushInFlight || this.disposed) return;
    void this.flushSessionStatsEventQueue();
  }

  private async flushSessionStatsEventQueue(): Promise<void> {
    const sessionPath = this.pendingSessionStatsPath;
    if (sessionPath === undefined || this.disposed) return;

    this.pendingSessionStatsPath = undefined;
    this.sessionStatsPushInFlight = true;

    try {
      const stats = await this.buildSessionStats(sessionPath);
      if (this.disposed) return;

      const payload: RpcSessionStatsEvent = {
        type: "session_stats",
        sessionPath: sessionPath ?? undefined,
        stats,
      };
      this.sendEvent(payload);
    } catch {
      // Ignore transient push failures. Explicit stats RPC reads still work.
    } finally {
      this.sessionStatsPushInFlight = false;
      if (this.pendingSessionStatsPath !== undefined && !this.disposed) {
        void this.flushSessionStatsEventQueue();
      }
    }
  }

  private buildSwitchSessionResponse(
    correlationId: string,
    sessionManager: SessionManager,
    sessionPath: string,
    transcriptLimit?: number,
  ): RpcResponse {
    const transcript = buildTranscriptPage(
      flattenMessagesForTranscript(sessionManager.getBranch()),
      sessionPath,
      { limit: transcriptLimit },
    );
    this.resetTranscriptSync(transcript.messages, sessionPath);

    return {
      id: correlationId,
      type: "response",
      command: "switch_session",
      success: true,
      data: {
        transcript,
        treeEntries: buildTreeEntriesFromSession(sessionManager),
        sessionId: sessionManager.getSessionId(),
        sessionName: sessionDisplayName(sessionManager, sessionPath),
        sessionPath,
        cancelled: false,
      },
    };
  }

  private buildSelectTreeEntryResponse(
    correlationId: string,
    sessionManager: SessionManager,
    sessionPath: string,
    targetEntryId: string,
  ): RpcResponse {
    const transcript = buildTranscriptPage(
      buildExactSelectionTranscriptMessages(
        sessionManager.getBranch(),
        targetEntryId,
      ),
      sessionPath,
    );
    this.resetTranscriptSync(transcript.messages, sessionPath);

    return {
      id: correlationId,
      type: "response",
      command: "select_tree_entry",
      success: true,
      data: {
        transcript,
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

      if (
        response.success &&
        (command.type === "get_state" ||
          command.type === "switch_session" ||
          command.type === "new_session" ||
          command.type === "select_tree_entry")
      ) {
        this.queueSessionStatsEvent(this.currentTranscriptSessionPath());
      }
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
        const images = normalizeRpcImages(command.images);

        // Auto-create a detached session when no session is selected.
        // Without this, the fallback calls pi.sendUserMessage() which
        // drives the live Pi runtime and causes a TUI switch away from
        // the bridge's custom terminal view.
        let autoCreated = false;
        let autoCreatedSm: SessionManager | null = null;
        if (!this.selectedSessionPath) {
          this.autoCreateSession();
          autoCreated = true;
          autoCreatedSm = this.pendingSessionManager;
        }

        const session = await this.ensureSelectedSession();
        const promptOptions = session.isStreaming
          ? {
              source: "rpc" as const,
              images,
              streamingBehavior: command.streamingBehavior ?? "steer",
            }
          : { source: "rpc" as const, images };

        setTimeout(() => {
          void session.prompt(command.message, promptOptions).catch(error => {
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

        // When auto-created, also push a new_session response so the
        // client can update its session path, tree, and transcript state.
        if (autoCreated && autoCreatedSm) {
          const sm = autoCreatedSm;
          const sessionFile = sm.getSessionFile();
          const transcript = buildTranscriptPage(
            flattenMessagesForTranscript(sm.getBranch()),
            sessionFile ?? null,
          );
          this.resetTranscriptSync(transcript.messages, sessionFile ?? null);
          return {
            id: correlationId,
            type: "response",
            command: "new_session",
            success: true,
            data: {
              transcript,
              treeEntries: buildTreeEntriesFromSession(sm),
              sessionId: sm.getSessionId(),
              sessionName: sessionDisplayName(sm, sessionFile),
              sessionPath: sessionFile ?? "",
              cancelled: false,
            },
          };
        }

        return {
          id: correlationId,
          type: "response",
          command: "prompt",
          success: true,
        };
      }

      case "steer": {
        const images = normalizeRpcImages(command.images);
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          void session.steer(command.message, images).catch(error => {
            console.error(
              `WsRpcAdapter[${this.client.id}]: Detached steer failed:`,
              error,
            );
          });
        } else {
          pi.sendUserMessage(buildUserMessageContent(command.message, images), {
            deliverAs: "steer",
          });
        }
        return {
          id: correlationId,
          type: "response",
          command: "steer",
          success: true,
        };
      }

      case "follow_up": {
        const images = normalizeRpcImages(command.images);
        if (this.selectedSessionPath) {
          const session = await this.ensureSelectedSession();
          void session.followUp(command.message, images).catch(error => {
            console.error(
              `WsRpcAdapter[${this.client.id}]: Detached follow_up failed:`,
              error,
            );
          });
        } else {
          pi.sendUserMessage(buildUserMessageContent(command.message, images), {
            deliverAs: "followUp",
          });
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
        const models = modelRegistry.getAvailable();
        const model = models.find(
          m => m.provider === command.provider && m.id === command.modelId,
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
          await session.setModel(model);
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
        const models = modelRegistry.getAvailable();
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
          session.setThinkingLevel(command.level as PiThinkingLevel);
        } else {
          pi.setThinkingLevel(command.level as PiThinkingLevel);
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

        return {
          id: correlationId,
          type: "response",
          command: "compact",
          success: false,
          error: "Compaction requires an active session",
        };
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
            command.limit,
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
        const currentSessionFile =
          this.selectedSessionPath ?? ctx.sessionManager.getSessionFile();
        if (!currentSessionFile || !fs.existsSync(currentSessionFile)) {
          return {
            id: correlationId,
            type: "response",
            command: "fork",
            success: false,
            error: "No session file available to fork from",
          };
        }

        const sourceSm = openSessionManager(currentSessionFile);
        const newSessionPath = sourceSm.createBranchedSession(command.entryId);
        if (!newSessionPath) {
          return {
            id: correlationId,
            type: "response",
            command: "fork",
            success: false,
            error: "Failed to create forked session",
          };
        }

        this.disposeSelectedSession();
        this.selectedSessionPath = newSessionPath;

        const forkedSm = openSessionManager(newSessionPath);
        const entry = forkedSm.getEntry(command.entryId);
        const text =
          entry && "message" in entry
            ? ((entry.message as { content?: string }).content ?? "")
            : "";

        return {
          id: correlationId,
          type: "response",
          command: "fork",
          success: true,
          data: { text, cancelled: false },
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
        this.pendingSessionManager = sessionManager;

        const transcript = buildTranscriptPage(
          flattenMessagesForTranscript(sessionManager.getBranch()),
          sessionFile ?? null,
          { limit: command.limit },
        );
        this.resetTranscriptSync(transcript.messages, sessionFile ?? null);
        return {
          id: correlationId,
          type: "response",
          command: "new_session",
          success: true,
          data: {
            transcript,
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
        const direction = command.direction === "older" ? "older" : "latest";
        const options = {
          direction,
          cursor: command.cursor,
          limit: command.limit,
        } as const;

        if (this.selectedSession) {
          const page = buildTranscriptPage(
            flattenMessagesForTranscript(
              this.selectedSession.sessionManager.getBranch(),
            ),
            this.selectedSession.sessionFile ?? null,
            options,
          );
          if (direction === "latest") {
            this.resetTranscriptSync(
              page.messages,
              this.selectedSession.sessionFile ?? null,
            );
          }
          return {
            id: correlationId,
            type: "response",
            command: "get_messages",
            success: true,
            data: { ...page, direction },
          };
        }

        if (
          this.selectedSessionPath &&
          fs.existsSync(this.selectedSessionPath)
        ) {
          const sessionManager = openSessionManager(this.selectedSessionPath);
          const page = buildTranscriptPage(
            flattenMessagesForTranscript(sessionManager.getBranch()),
            this.selectedSessionPath,
            options,
          );
          if (direction === "latest") {
            this.resetTranscriptSync(page.messages, this.selectedSessionPath);
          }
          return {
            id: correlationId,
            type: "response",
            command: "get_messages",
            success: true,
            data: { ...page, direction },
          };
        }

        const page = buildTranscriptPage(
          flattenMessagesForTranscript(ctx.sessionManager.getBranch()),
          ctx.sessionManager.getSessionFile() ?? null,
          options,
        );
        if (direction === "latest") {
          this.resetTranscriptSync(
            page.messages,
            ctx.sessionManager.getSessionFile() ?? null,
          );
        }
        return {
          id: correlationId,
          type: "response",
          command: "get_messages",
          success: true,
          data: { ...page, direction },
        };
      }

      // =================================================================
      // Commands (use pi.getCommands)
      // =================================================================

      case "get_commands": {
        const commands = pi.getCommands();
        const rpcCommands: RpcSlashCommand[] = commands.map(cmd => ({
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
      // Select Tree Entry (exact sidebar selection)
      // =================================================================

      case "select_tree_entry": {
        let session: AgentSession;

        if (this.selectedSessionPath) {
          session = await this.ensureSelectedSession();
        } else {
          const liveSessionFile = ctx.sessionManager.getSessionFile();
          if (!liveSessionFile || !fs.existsSync(liveSessionFile)) {
            return {
              id: correlationId,
              type: "response" as const,
              command: "select_tree_entry" as const,
              success: false as const,
              error: "No session file available",
            };
          }

          this.disposeSelectedSession();
          this.selectedSessionPath = liveSessionFile;
          session = await this.ensureSelectedSession({
            skipInitialSnapshot: true,
          });
        }

        const targetEntry = session.sessionManager.getEntry(command.entryId);
        if (!targetEntry) {
          return {
            id: correlationId,
            type: "response" as const,
            command: "select_tree_entry" as const,
            success: false as const,
            error: "Tree entry not found",
          };
        }

        session.sessionManager.branch(command.entryId);
        const sessionPath =
          session.sessionFile ??
          session.sessionManager.getSessionFile() ??
          this.selectedSessionPath;
        if (!sessionPath) {
          return {
            id: correlationId,
            type: "response" as const,
            command: "select_tree_entry" as const,
            success: false as const,
            error: "No session file available",
          };
        }

        return this.buildSelectTreeEntryResponse(
          correlationId,
          session.sessionManager,
          sessionPath,
          command.entryId,
        );
      }

      // =================================================================
      // Navigate Tree (use ctx.navigateTree)
      // =================================================================

      case "navigate_tree": {
        let session: AgentSession;

        if (this.selectedSessionPath) {
          session = await this.ensureSelectedSession();
        } else {
          const liveSessionFile = ctx.sessionManager.getSessionFile();
          if (!liveSessionFile || !fs.existsSync(liveSessionFile)) {
            return {
              id: correlationId,
              type: "response" as const,
              command: "navigate_tree" as const,
              success: false as const,
              error: "No session file available",
            };
          }

          this.disposeSelectedSession();
          this.selectedSessionPath = liveSessionFile;
          session = await this.ensureSelectedSession({
            skipInitialSnapshot: true,
          });
        }

        const result = await session.navigateTree(command.entryId, {
          summarize: command.summarize,
          customInstructions: command.customInstructions,
          replaceInstructions: command.replaceInstructions,
          label: command.label,
        });

        this.sendTranscriptSnapshot(
          buildTranscriptPage(
            flattenMessagesForTranscript(session.sessionManager.getBranch()),
            session.sessionFile ?? null,
          ),
        );
        this.queueSessionStatsEvent(session.sessionFile ?? null);

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
          const seenSessionPaths = new Set<string>();
          const currentSessionFile =
            this.selectedSessionPath ?? ctx.sessionManager.getSessionFile();
          const sessionDir = currentSessionFile
            ? path.dirname(currentSessionFile)
            : undefined;

          const appendSession = (
            sessionManager: SessionManager,
            sessionPath?: string,
          ) => {
            if (!sessionPath || seenSessionPaths.has(sessionPath)) return;
            const header = sessionManager.getHeader();
            if (!header) return;
            seenSessionPaths.add(sessionPath);
            sessions.push({
              id: header.id,
              name: sessionDisplayName(sessionManager, sessionPath),
              path: sessionPath,
              timestamp: header.timestamp,
            });
          };

          // Include a newly created detached session before it is visible on disk.
          if (this.pendingSessionManager) {
            appendSession(
              this.pendingSessionManager,
              this.pendingSessionManager.getSessionFile(),
            );
          }

          if (sessionDir && fs.existsSync(sessionDir)) {
            const files = fs
              .readdirSync(sessionDir)
              .filter((f: string) => f.endsWith(".jsonl"))
              .sort()
              .reverse(); // newest first

            for (const file of files) {
              const filePath = path.join(sessionDir, file);
              try {
                appendSession(openSessionManager(filePath), filePath);
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

      case "list_workspace_entries": {
        if (!this.workspaceEntriesCache) {
          this.workspaceEntriesCache = listWorkspaceEntries(ctx.cwd);
        }

        return {
          id: correlationId,
          type: "response" as const,
          command: "list_workspace_entries" as const,
          success: true as const,
          data: { entries: this.workspaceEntriesCache },
        };
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
  createExtensionUIContext(): ExtensionUIContext {
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
          r =>
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
          r =>
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
          r =>
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
          r =>
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

      setWidget: (key, content, options) => {
        if (typeof content === "function") {
          return;
        }

        const id = crypto.randomUUID();
        const envelope: ServerMessage = {
          type: "extension_ui_request",
          payload: {
            type: "extension_ui_request",
            id,
            method: "setWidget",
            widgetKey: key,
            widgetLines: content,
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
      custom: async <T>() => undefined as T, // Not supported
      pasteToEditor: (text: string) => {
        setEditorText(text);
      },
      setEditorComponent: () => {}, // Not supported
      theme: {} as ExtensionUIContext["theme"], // Not available
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
