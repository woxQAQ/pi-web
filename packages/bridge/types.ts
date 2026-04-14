/**
 * Bridge type definitions for the Pi Web Bridge extension.
 *
 * Defines RPC protocol types (mirrored from the coding-agent's internal
 * rpc-types module, which is not exported from the npm package) and
 * bridge-specific types for server configuration, runtime state, and
 * WebSocket client tracking.
 *
 * External complex types (AgentMessage, Model, ThinkingLevel, etc.) are
 * represented as `unknown` because the bridge is a pass-through — it never
 * inspects or constructs these values, only forwards them between the
 * Pi extension API and WebSocket clients.
 */

// ============================================================================
// RPC Commands (client → server)
// ============================================================================

export interface RpcImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface RpcWorkspaceEntry {
  path: string;
  kind: "file" | "directory";
}

/** Map of RPC command types to their specific payload shapes. */
export interface RpcCommandMap {
  /** Prompting */
  prompt: {
    message: string;
    images?: RpcImageContent[];
    streamingBehavior?: "steer" | "followUp";
  };
  steer: {
    message: string;
    images?: RpcImageContent[];
  };
  follow_up: {
    message: string;
    images?: RpcImageContent[];
  };
  abort: unknown;
  new_session: { parentSession?: string };

  /** State */
  get_state: unknown;

  /** Model */
  set_model: { provider: string; modelId: string };
  cycle_model: unknown;
  get_available_models: unknown;

  /** Thinking */
  set_thinking_level: { level: unknown };
  cycle_thinking_level: unknown;

  /** Queue modes */
  set_steering_mode: { mode: "all" | "one-at-a-time" };
  set_follow_up_mode: { mode: "all" | "one-at-a-time" };

  /** Compaction */
  compact: { customInstructions?: string };
  set_auto_compaction: { enabled: boolean };

  /** Retry */
  set_auto_retry: { enabled: boolean };
  abort_retry: unknown;

  /** Bash */
  bash: { command: string };
  abort_bash: unknown;

  /** Session */
  get_session_stats: { sessionPath?: string };
  export_html: { outputPath?: string };
  switch_session: { sessionPath: string };
  navigate_tree: {
    entryId: string;
    summarize?: boolean;
    customInstructions?: string;
    replaceInstructions?: boolean;
    label?: string;
  };
  fork: { entryId: string };
  get_fork_messages: unknown;
  get_last_assistant_text: unknown;
  set_session_name: { name: string };

  /** Messages / Commands */
  get_messages: unknown;
  get_commands: unknown;

  /** Discovery */
  list_sessions: unknown;
  list_tree_entries: { sessionPath?: string };
  list_workspace_entries: unknown;

  /** Plugin state persistence */
  get_plugin_state: { key: string };
  set_plugin_state: { key: string; value: unknown };
}

/** All RPC command types that a browser client can send. */
export type RpcCommand = {
  [K in keyof RpcCommandMap]: { id?: string; type: K } & RpcCommandMap[K];
}[keyof RpcCommandMap];

/** Helper type to extract the `type` discriminant. */
export type RpcCommandType = keyof RpcCommandMap;

/** Extract payload fields for a specific command type. */
export type RpcCommandPayload<T extends RpcCommandType> = Omit<
  Extract<RpcCommand, { type: T }>,
  "id" | "type"
>;

// ============================================================================
// RPC State
// ============================================================================

export interface RpcSessionState {
  model?: unknown;
  thinkingLevel: unknown;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
}

/** A command available for invocation via prompt. */
export interface RpcSlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
}

export type RpcTreeTrackColumn = "blank" | "line" | "branch" | "branch-last";

export interface RpcTreeEntry {
  id: string;
  label?: string;
  type: string;
  timestamp?: string;
  parentId?: string | null;
  depth?: number;
  trackColumns?: RpcTreeTrackColumn[];
  isActive?: boolean;
  isOnActivePath?: boolean;
}

// ============================================================================
// RPC Responses (server → client)
// ============================================================================

/** Map of RPC command types to their success response data shapes. */
export interface RpcResponseMap {
  prompt: void;
  steer: void;
  follow_up: void;
  abort: void;
  new_session: {
    messages: unknown[];
    treeEntries: RpcTreeEntry[];
    sessionId: string;
    sessionName: string;
    sessionPath: string;
    cancelled: boolean;
  };
  get_state: RpcSessionState;
  set_model: unknown;
  cycle_model: unknown;
  get_available_models: { models: unknown[] };
  set_thinking_level: void;
  cycle_thinking_level: unknown;
  set_steering_mode: void;
  set_follow_up_mode: void;
  compact: unknown;
  set_auto_compaction: void;
  set_auto_retry: void;
  abort_retry: void;
  bash: unknown;
  abort_bash: void;
  get_session_stats: unknown;
  export_html: { path: string };
  switch_session: {
    messages: unknown[];
    treeEntries: RpcTreeEntry[];
    sessionId: string;
    sessionName: string;
    sessionPath: string;
    cancelled: boolean;
  };
  navigate_tree: { cancelled: boolean };
  fork: { text: string; cancelled: boolean };
  get_fork_messages: { messages: Array<{ entryId: string; text: string }> };
  get_last_assistant_text: { text: string | null };
  set_session_name: void;
  get_messages: { messages: unknown[] };
  get_commands: { commands: RpcSlashCommand[] };
  list_sessions: {
    sessions: Array<{ id: string; name: string; path: string }>;
  };
  list_tree_entries: { entries: RpcTreeEntry[]; sessionPath?: string };
  list_workspace_entries: { entries: RpcWorkspaceEntry[] };
  get_plugin_state: { value: unknown };
  set_plugin_state: void;
}

type RpcResponseData<T> = [T] extends [void] ? unknown : { data: T };

/** Structured responses sent back to the browser client after command dispatch. */
export type RpcResponse =
  | {
      [K in keyof RpcResponseMap]: {
        id?: string;
        type: "response";
        command: K;
        success: true;
      } & RpcResponseData<RpcResponseMap[K]>;
    }[keyof RpcResponseMap]
  | {
      id?: string;
      type: "response";
      command: string;
      success: false;
      error: string;
    };

// ============================================================================
// Extension UI (routed over WebSocket)
// ============================================================================

/** UI request forwarded from Pi to a specific browser client. */
export type RpcExtensionUIRequest =
  | {
      type: "extension_ui_request";
      id: string;
      method: "select";
      title: string;
      options: string[];
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "editor";
      title: string;
      prefill?: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "notify";
      message: string;
      notifyType?: "info" | "warning" | "error";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setStatus";
      statusKey: string;
      statusText: string | undefined;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setWidget";
      widgetKey: string;
      widgetLines: string[] | undefined;
      widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setTitle";
      title: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "set_editor_text";
      text: string;
    };

/** Response from the browser client resolving a UI request. */
export type RpcExtensionUIResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

// ============================================================================
// Bridge Configuration
// ============================================================================

/** Configuration for the bridge server, sourced from extension config or defaults. */
export interface BridgeConfig {
  /** Host to bind the HTTP/WebSocket server to. Default: "localhost" */
  readonly host: string;
  /** Preferred port; 0 means OS-assigned. Default: 8080 */
  readonly port: number;
  /** Upper bound for port-range fallback when the preferred port is in use. Default: 0 (no fallback) */
  readonly portMax: number;
  /** Directory containing static files to serve (for the web UI bundle). Default: undefined (404) */
  readonly staticDir?: string;
  /** Timeout in ms for extension UI dialog requests routed to WS clients. Default: 60_000 */
  readonly uiRequestTimeout: number;
  /** Maximum number of WS frames to buffer per client before dropping oldest. Default: 256 */
  readonly clientBufferSize: number;
}

/** Sensible defaults for bridge configuration. */
export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  host: "0.0.0.0",
  port: 8080,
  portMax: 0,
  uiRequestTimeout: 60_000,
  clientBufferSize: 256,
};

// ============================================================================
// Bridge Runtime State
// ============================================================================

/** The lifecycle state of the bridge server. */
export type BridgeState =
  | { status: "stopped" }
  | { status: "starting"; port: number }
  | { status: "running"; host: string; port: number }
  | { status: "stopping" };

// ============================================================================
// WebSocket Client
// ============================================================================

/** Metadata for a connected WebSocket client. */
export interface WsClient {
  /** Unique identifier assigned on connection. */
  readonly id: string;
  /** Monotonic connection sequence number (1-based). */
  readonly seq: number;
  /** ISO-8601 timestamp of when the client connected. */
  readonly connectedAt: string;
}

// ============================================================================
// Bridge Events (internal event bus)
// ============================================================================

/** Events emitted by the bridge runtime for terminal log view and internal wiring. */
export type BridgeEvent =
  | { type: "server_start"; host: string; port: number }
  | { type: "server_stop" }
  | { type: "client_connect"; client: WsClient }
  | { type: "client_disconnect"; client: WsClient; reason?: string }
  | {
      type: "command_received";
      client: WsClient;
      commandType: string;
      correlationId?: string;
    }
  | {
      type: "command_error";
      client: WsClient;
      commandType: string;
      correlationId?: string;
      error: string;
    }
  | { type: "auth_rejected"; clientIp: string; protocol: "http" | "ws" }
  | { type: "sigint_received" }
  | { type: "shutdown_complete" };

// ============================================================================
// Wire Protocol (JSON over WebSocket)
// ============================================================================

/** Envelope for messages sent from server → browser client. */
export type ServerMessage =
  | { type: "event"; payload: unknown }
  | { type: "extension_ui_request"; payload: RpcExtensionUIRequest }
  | { type: "response"; payload: RpcResponse };

/** Envelope for messages sent from browser client → server. */
export type ClientMessage =
  | { type: "command"; payload: RpcCommand }
  | { type: "extension_ui_response"; payload: RpcExtensionUIResponse };
