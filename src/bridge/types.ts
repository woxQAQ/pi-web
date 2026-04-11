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

/** All RPC command types that a browser client can send. */
export type RpcCommand =
	// Prompting
	| { id?: string; type: "prompt"; message: string; images?: unknown[]; streamingBehavior?: "steer" | "followUp" }
	| { id?: string; type: "steer"; message: string; images?: unknown[] }
	| { id?: string; type: "follow_up"; message: string; images?: unknown[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "new_session"; parentSession?: string }
	// State
	| { id?: string; type: "get_state" }
	// Model
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }
	// Thinking
	| { id?: string; type: "set_thinking_level"; level: unknown }
	| { id?: string; type: "cycle_thinking_level" }
	// Queue modes
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
	// Compaction
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }
	// Retry
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }
	// Bash
	| { id?: string; type: "bash"; command: string }
	| { id?: string; type: "abort_bash" }
	// Session
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "navigate_tree"; entryId: string; summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string }
	| { id?: string; type: "fork"; entryId: string }
	| { id?: string; type: "get_fork_messages" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string }
	// Messages / Commands
	| { id?: string; type: "get_messages" }
	| { id?: string; type: "get_commands" }
	// Discovery
	| { id?: string; type: "list_sessions" }
	| { id?: string; type: "list_tree_entries" };

/** Helper type to extract the `type` discriminant. */
export type RpcCommandType = RpcCommand["type"];

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

// ============================================================================
// RPC Responses (server → client)
// ============================================================================

/** Structured responses sent back to the browser client after command dispatch. */
export type RpcResponse =
	// Success responses — each maps to a command type
	| { id?: string; type: "response"; command: "prompt"; success: true }
	| { id?: string; type: "response"; command: "steer"; success: true }
	| { id?: string; type: "response"; command: "follow_up"; success: true }
	| { id?: string; type: "response"; command: "abort"; success: true }
	| { id?: string; type: "response"; command: "new_session"; success: true; data: { cancelled: boolean } }
	| { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }
	| { id?: string; type: "response"; command: "set_model"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "cycle_model"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "get_available_models"; success: true; data: { models: unknown[] } }
	| { id?: string; type: "response"; command: "set_thinking_level"; success: true }
	| { id?: string; type: "response"; command: "cycle_thinking_level"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "set_steering_mode"; success: true }
	| { id?: string; type: "response"; command: "set_follow_up_mode"; success: true }
	| { id?: string; type: "response"; command: "compact"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "set_auto_compaction"; success: true }
	| { id?: string; type: "response"; command: "set_auto_retry"; success: true }
	| { id?: string; type: "response"; command: "abort_retry"; success: true }
	| { id?: string; type: "response"; command: "bash"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "abort_bash"; success: true }
	| { id?: string; type: "response"; command: "get_session_stats"; success: true; data: unknown }
	| { id?: string; type: "response"; command: "export_html"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "switch_session"; success: true; data: { cancelled: boolean } }
	| { id?: string; type: "response"; command: "fork"; success: true; data: { text: string; cancelled: boolean } }
	| { id?: string; type: "response"; command: "get_fork_messages"; success: true; data: { messages: Array<{ entryId: string; text: string }> }
	}
	| { id?: string; type: "response"; command: "get_last_assistant_text"; success: true; data: { text: string | null } }
	| { id?: string; type: "response"; command: "set_session_name"; success: true }
	| { id?: string; type: "response"; command: "navigate_tree"; success: true; data: { cancelled: boolean } }
	| { id?: string; type: "response"; command: "get_messages"; success: true; data: { messages: unknown[] } }
	| { id?: string; type: "response"; command: "get_commands"; success: true; data: { commands: RpcSlashCommand[] } }
	// Discovery responses
	| { id?: string; type: "response"; command: "list_sessions"; success: true; data: { sessions: Array<{ id: string; name: string; path: string }> } }
	| { id?: string; type: "response"; command: "list_tree_entries"; success: true; data: { entries: Array<{ id: string; label?: string; type: string; timestamp?: string }> } }
	// Error — any command can fail
	| { id?: string; type: "response"; command: string; success: false; error: string };

// ============================================================================
// Extension UI (routed over WebSocket)
// ============================================================================

/** UI request forwarded from Pi to a specific browser client. */
export type RpcExtensionUIRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
	| { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
	| { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText: string | undefined }
	| { type: "extension_ui_request"; id: string; method: "setWidget"; widgetKey: string; widgetLines: string[] | undefined; widgetPlacement?: "aboveEditor" | "belowEditor" }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

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
	/** Preferred port; 0 means OS-assigned. Default: 0 */
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
	port: 0,
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
	| { type: "command_received"; client: WsClient; commandType: string; correlationId?: string }
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
