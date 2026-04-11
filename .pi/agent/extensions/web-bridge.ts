/**
 * Pi Extension Entry Point - Web Bridge
 *
 * Registers the `/web` command that starts the bridge server,
 * degrades the terminal to a read-only log view, and allows
 * browser clients to interact with Pi via WebSocket RPC.
 */

import { startBridge, type BridgeController } from "../../../src/bridge/lifecycle.js";
import { createBridgeTerminalView } from "../../../src/bridge/terminal-log-view.js";
import type { WsRpcAdapterContext } from "../../../src/bridge/ws-rpc-adapter.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeConfig } from "../../../src/bridge/types.js";

/**
 * Pi extension context provided by the agent
 */
interface PiAgentContext {
	sessionManager: {
		getBranch: () => unknown[];
		messages: unknown[];
		sessionId: string;
		sessionFile?: string;
		sessionName?: string;
	};
	model: unknown;
	modelRegistry: {
		getAvailable: () => Promise<unknown[]>;
	};
	isIdle: () => boolean;
	signal: AbortSignal | undefined;
	abort: () => void;
	compact: (options?: { onComplete?: (result: unknown) => void; onError?: (error: Error) => void }) => void;
	shutdown: () => void;
	hasPendingMessages: () => boolean;
	getContextUsage: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
	getSystemPrompt: () => string;
	waitForIdle: () => Promise<void>;
	newSession: (options?: { parentSession?: string }) => Promise<{ cancelled: boolean }>;
	fork: (entryId: string) => Promise<{ cancelled: boolean }>;
	navigateTree: (
		targetId: string,
		options?: {
			summarize?: boolean;
			customInstructions?: string;
			replaceInstructions?: boolean;
			label?: string;
		}
	) => Promise<{ cancelled: boolean }>;
	switchSession: (sessionPath: string) => Promise<{ cancelled: boolean }>;
}

/**
 * Pi extension API surface
 */
interface PiExtensionAPI {
	sendUserMessage: (
		content: string | unknown[],
		options?: { deliverAs?: "steer" | "followUp" }
	) => void;
	setModel: (model: unknown) => Promise<boolean>;
	setThinkingLevel: (level: unknown) => void;
	getThinkingLevel: () => unknown;
	setSessionName: (name: string) => void;
	getSessionName: () => string | undefined;
	getCommands: () => Array<{ name: string; description?: string; source: string }>;
	on: (event: string, handler: (event: object) => void) => void;
}

/**
 * Full extension context
 */
interface ExtensionContext {
	pi: PiExtensionAPI;
	ctx: PiAgentContext;
	ui: {
		custom: (options: {
			title: string;
			header?: string;
			footer?: string;
			render: () => string[];
			handleInput?: (input: string) => void;
			shouldExit?: () => boolean;
			done: () => void;
		}) => void;
	};
}

/**
 * Command handler for `/web`
 */
export default async function webBridgeCommand(ctx: ExtensionContext): Promise<void> {
	// Build the adapter context from extension context
	const adapterContext: WsRpcAdapterContext = {
		pi: ctx.pi,
		ctx: {
			sessionManager: ctx.ctx.sessionManager,
			model: ctx.ctx.model,
			modelRegistry: ctx.ctx.modelRegistry,
			isIdle: ctx.ctx.isIdle,
			signal: ctx.ctx.signal,
			abort: ctx.ctx.abort,
			compact: ctx.ctx.compact,
			shutdown: ctx.ctx.shutdown,
			hasPendingMessages: ctx.ctx.hasPendingMessages,
			getContextUsage: ctx.ctx.getContextUsage,
			getSystemPrompt: ctx.ctx.getSystemPrompt,
			waitForIdle: ctx.ctx.waitForIdle,
			newSession: ctx.ctx.newSession,
			fork: ctx.ctx.fork,
			navigateTree: ctx.ctx.navigateTree,
			switchSession: ctx.ctx.switchSession,
		},
	};

	// Resolve web-dist directory for static bundle serving
	const webDistDir = (() => {
		try {
			const { fileURLToPath } = await import("node:url");
			const { dirname, join } = await import("node:path");
			const thisFile = fileURLToPath(import.meta.url);
			const projectRoot = join(dirname(thisFile), "..", "..", "..");
			return join(projectRoot, "web-dist");
		} catch {
			return undefined;
		}
	})();

	const { existsSync } = await import("node:fs");
	const staticDir = webDistDir && existsSync(webDistDir) ? webDistDir : undefined;

	// Bridge configuration (could be extended to read from config file)
	// Note: DEFAULT_BRIDGE_CONFIG.host is "0.0.0.0" so the bridge is reachable from LAN.
	// Set PI_BRIDGE_HOST=localhost to restrict to local-only access.
	const config: BridgeConfig = {
		...DEFAULT_BRIDGE_CONFIG,
		// Allow environment variable override for port
		port: process.env.PI_BRIDGE_PORT ? parseInt(process.env.PI_BRIDGE_PORT, 10) : 0,
		host: process.env.PI_BRIDGE_HOST || DEFAULT_BRIDGE_CONFIG.host,
		staticDir,
	};

	let bridgeController: BridgeController | undefined;

	// Start the bridge
	try {
		bridgeController = await startBridge(config, adapterContext, () => {
			// Done callback - view should exit
			if (bridgeController) {
				terminalView.requestExit();
			}
		});
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		ctx.ui.custom({
			title: "🌉 Pi Web Bridge - Error",
			header: "Failed to start bridge server",
			render: () => [
				`Error: ${errorMsg}`,
				"",
				"Press any key to exit...",
			],
			done: () => {},
		});
		return;
	}

	// Create terminal log view subscribed to bridge events
	const terminalView = createBridgeTerminalView(
		(handler) => bridgeController!.subscribe(handler),
		() => bridgeController!.getState(),
		() => bridgeController!.getClients(),
		config,
		() => bridgeController!.getToken()
	);

	// Render the custom UI - this degrades terminal to read-only log view
	ctx.ui.custom({
		title: "🌉 Pi Web Bridge",
		render: () => terminalView.render(),
		handleInput: (input: string) => {
			// Read-only view - only handle Ctrl+C via shouldExit
			terminalView.handleInput(input);
		},
		shouldExit: () => terminalView.shouldExit(),
		done: async () => {
			// Cleanup: stop bridge and dispose view
			terminalView.dispose();
			if (bridgeController) {
				await bridgeController.stop();
			}
		},
	});
}

// Export for testing
export { webBridgeCommand };
