/**
 * Re-export bridge wire-protocol types for use in the Vue app.
 *
 * Uses `export type` to avoid importing runtime code from the server-side
 * bridge module. The Vue build resolves the relative path at type-check
 * time via bundler moduleResolution; Vite tree-shakes these away in the
 * production bundle.
 */
export type {
	RpcCommand,
	RpcResponse,
	RpcSessionState,
	RpcSlashCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	ClientMessage,
	ServerMessage,
} from "../../src/bridge/types";
