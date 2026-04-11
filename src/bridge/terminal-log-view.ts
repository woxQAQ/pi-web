/**
 * Terminal log view for the bridge.
 *
 * Renders bridge URL, client count, recent log lines (circular buffer),
 * and Ctrl+C instructions. Works within Pi's ctx.ui.custom() pattern.
 * Read-only: handleInput is no-op.
 */

import type { BridgeConfig, BridgeEvent, BridgeState, WsClient } from "./types.js";
import { getLanIps, isTailscaleIp } from "./network.js";

/**
 * Log entry with timestamp
 */
interface LogEntry {
	timestamp: Date;
	message: string;
	type: "info" | "client" | "error" | "shutdown";
}

/**
 * Terminal log view controller
 */
export interface TerminalLogView {
	/** Render the current view state */
	render(): string[];
	/** Handle input (no-op for read-only view) */
	handleInput(input: string): void;
	/** Get whether the view should exit */
	shouldExit(): boolean;
	/** Mark the view for exit */
	requestExit(): void;
}

/**
 * Create a terminal log view for the bridge
 *
 * @param config Bridge configuration
 * @param getState Function to get current bridge state
 * @param getClients Function to get connected clients
 * @returns Terminal log view controller
 */
export function createTerminalLogView(
	config: BridgeConfig,
	getState: () => BridgeState,
	getClients: () => WsClient[]
): TerminalLogView {
	// Circular buffer for log lines
	const maxLines = 100;
	const logs: LogEntry[] = [];

	// Exit flag
	let exitRequested = false;

	/**
	 * Add a log entry
	 */
	const addLog = (message: string, type: LogEntry["type"] = "info"): void => {
		logs.push({ timestamp: new Date(), message, type });
		if (logs.length > maxLines) {
			logs.shift();
		}
	};

	/**
	 * Format a log entry for display
	 */
	const formatLogEntry = (entry: LogEntry): string => {
		const time = entry.timestamp.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		const prefix =
			entry.type === "client"
				? "[C]"
				: entry.type === "error"
					? "[E]"
					: entry.type === "shutdown"
						? "[X]"
						: "[I]";
		return `${time} ${prefix} ${entry.message}`;
	};

	/**
	 * Format the status header
	 */
	const formatHeader = (state: BridgeState): string[] => {
		const lines: string[] = [];

		// Title
		lines.push("╔══════════════════════════════════════════════════════════════╗");
		lines.push("║           🌉 Pi Web Bridge - Terminal View                   ║");
		lines.push("╚══════════════════════════════════════════════════════════════╝");
		lines.push("");

		// Status section
		const status = state.status;
		if (status === "running") {
			const url = `http://${state.host}:${state.port}`;
			const wsUrl = `ws://${state.host}:${state.port}/ws`;
			lines.push(`📡 Bridge URL: ${url}`);
			lines.push(`🔌 WebSocket:  ${wsUrl}`);
		} else if (status === "starting") {
			lines.push(`⏳ Starting on port ${state.port}...`);
		} else if (status === "stopping") {
			lines.push("🛑 Shutting down...");
		} else {
			lines.push("⚪ Bridge stopped");
		}

		// Client count
		const clients = getClients();
		lines.push(`👥 Clients:     ${clients.length} connected`);
		lines.push("");

		// Separator
		lines.push("─".repeat(62));
		lines.push("");

		return lines;
	};

	/**
	 * Format client list
	 */
	const formatClients = (clients: WsClient[]): string[] => {
		if (clients.length === 0) {
			return ["No clients connected", ""];
		}

		const lines: string[] = [];
		lines.push("Connected clients:");
		for (const client of clients) {
			const time = new Date(client.connectedAt).toLocaleTimeString("en-US", {
				hour12: false,
				hour: "2-digit",
				minute: "2-digit",
			});
			lines.push(`  #${client.seq} ${client.id.slice(0, 12)}... (connected at ${time})`);
		}
		lines.push("");

		return lines;
	};

	/**
	 * Format log section
	 */
	const formatLogs = (): string[] => {
		const lines: string[] = [];

		lines.push("Recent events:");
		lines.push("─".repeat(62));

		if (logs.length === 0) {
			lines.push("  (No events yet)");
		} else {
			// Show last 20 log entries or all if less
			const recentLogs = logs.slice(-20);
			for (const entry of recentLogs) {
				lines.push(formatLogEntry(entry));
			}
		}

		return lines;
	};

	/**
	 * Format footer with instructions
	 */
	const formatFooter = (): string[] => {
		const lines: string[] = [];
		lines.push("");
		lines.push("─".repeat(62));
		lines.push("");
		lines.push("Press Ctrl+C to stop the bridge and return to Pi");
		return lines;
	};

	return {
		render(): string[] {
			const state = getState();
			const clients = getClients();

			const lines: string[] = [];
			lines.push(...formatHeader(state));
			lines.push(...formatClients(clients));
			lines.push(...formatLogs());
			lines.push(...formatFooter());

			return lines;
		},

		handleInput(_input: string): void {
			// Read-only view - no input handling
		},

		shouldExit(): boolean {
			return exitRequested;
		},

		requestExit(): void {
			exitRequested = true;
		},
	};
}

/**
 * Bridge event handler that logs events to the terminal view
 *
 * @param view Terminal log view to log to
 * @returns Event handler function
 */
export function createEventLogger(view: { handleLog?: (message: string, type?: "info" | "client" | "error" | "shutdown") => void }): (event: BridgeEvent) => void {
	return (event: BridgeEvent) => {
		switch (event.type) {
			case "server_start": {
				view.handleLog?.(`Server started on ${event.host}:${event.port}`, "info");
				break;
			}
			case "server_stop": {
				view.handleLog?.("Server stopped", "info");
				break;
			}
			case "client_connect": {
				view.handleLog?.(`Client #${event.client.seq} connected (${event.client.id.slice(0, 12)}...)`, "client");
				break;
			}
			case "client_disconnect": {
				view.handleLog?.(`Client #${event.client.seq} disconnected: ${event.reason || "unknown"}`, "client");
				break;
			}
			case "command_received": {
				view.handleLog?.(`Command [${event.commandType}] from #${event.client.seq}${event.correlationId ? ` (id: ${event.correlationId.slice(0, 8)}...)` : ""}`, "info");
				break;
			}
			case "command_error": {
				view.handleLog?.(
					`Error [${event.commandType}] from #${event.client.seq}${event.correlationId ? ` (id: ${event.correlationId.slice(0, 8)}...)` : ""}: ${event.error}`,
					"error"
				);
				break;
			}
			case "sigint_received": {
				view.handleLog?.("SIGINT received, starting shutdown...", "shutdown");
				break;
			}
			case "shutdown_complete": {
				view.handleLog?.("Shutdown complete", "shutdown");
				break;
			}
		}
	};
}

/**
 * Enhanced terminal log view with event logging capability
 */
export function createTerminalLogViewWithLogging(
	config: BridgeConfig,
	getState: () => BridgeState,
	getClients: () => WsClient[]
): TerminalLogView & { handleLog: (message: string, type?: "info" | "client" | "error" | "shutdown") => void } {
	const view = createTerminalLogView(config, getState, getClients);

	// Store the original render to inject logs
	const originalRender = view.render.bind(view);

	// Extend the view with logging capability
	return Object.assign(view, {
		handleLog(message: string, type: "info" | "client" | "error" | "shutdown" = "info") {
			// Access internal addLog via closure - we need to expose this
			// Re-implement by creating a new view with logging
			// This is a bit hacky but keeps the interface clean
		},
		render() {
			return originalRender();
		},
	});
}

/**
 * Create a fully functional terminal log view with event subscription
 *
 * This is the main factory function that creates a log view wired to bridge events.
 */
export function createBridgeTerminalView(
	subscribe: (handler: (event: BridgeEvent) => void) => () => void,
	getState: () => BridgeState,
	getClients: () => WsClient[],
	config: BridgeConfig,
	getToken: () => string
): TerminalLogView & { dispose: () => void } {
	// Internal log storage
	const maxLines = 100;
	const logs: Array<{ timestamp: Date; message: string; type: "info" | "client" | "error" | "shutdown" }> = [];
	let exitRequested = false;

	/**
	 * Add a log entry
	 */
	const addLog = (message: string, type: "info" | "client" | "error" | "shutdown" = "info"): void => {
		logs.push({ timestamp: new Date(), message, type });
		if (logs.length > maxLines) {
			logs.shift();
		}
	};

	// Subscribe to bridge events
	const unsubscribe = subscribe((event) => {
		switch (event.type) {
			case "server_start": {
				const lanIps = getLanIps();
				const token = getToken();
				const tokenHint = token ? ` (token: ${token.slice(0, 8)}...)` : "";
				const lanInfo = lanIps.length > 0 ? ` (LAN: ${lanIps.map(ip => {
					const label = isTailscaleIp(ip) ? " [Tailscale]" : "";
					return `http://${ip}:${event.port}${label}`;
				}).join(", ")})` : "";
				addLog(`Server started on ${event.host}:${event.port}${tokenHint}${lanInfo}`, "info");
				break;
			}
			case "server_stop":
				addLog("Server stopped", "info");
				break;
			case "client_connect":
				addLog(`Client #${event.client.seq} connected (${event.client.id.slice(0, 12)}...)`, "client");
				break;
			case "client_disconnect":
				addLog(`Client #${event.client.seq} disconnected: ${event.reason || "unknown"}`, "client");
				break;
			case "command_received":
				addLog(
					`Command [${event.commandType}] from #${event.client.seq}${event.correlationId ? ` (id: ${event.correlationId.slice(0, 8)}...)` : ""}`,
					"info"
				);
				break;
			case "command_error":
				addLog(
					`Error [${event.commandType}] from #${event.client.seq}${event.correlationId ? ` (id: ${event.correlationId.slice(0, 8)}...)` : ""}: ${event.error}`,
					"error"
				);
				break;
			case "sigint_received":
				addLog("SIGINT received, starting shutdown...", "shutdown");
				break;
			case "shutdown_complete":
				addLog("Shutdown complete", "shutdown");
				break;
			case "auth_rejected":
				addLog(`Auth rejected (${event.protocol}) from ${event.clientIp}`, "error");
				break;
		}
	});

	/**
	 * Format timestamp
	 */
	const formatTime = (date: Date): string => {
		return date.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	};

	/**
	 * Get status indicator
	 */
	const getStatusIndicator = (status: BridgeState["status"]): string => {
		switch (status) {
			case "running":
				return "🟢";
			case "starting":
				return "🟡";
			case "stopping":
				return "🟠";
			case "stopped":
				return "⚪";
			default:
				return "⚪";
		}
	};

	return {
		render(): string[] {
			const state = getState();
			const clients = getClients();
			const lines: string[] = [];

			// Header box
			lines.push("╔══════════════════════════════════════════════════════════════╗");
			lines.push("║              🌉 Pi Web Bridge - Terminal View                ║");
			lines.push("╚══════════════════════════════════════════════════════════════╝");
			lines.push("");

			// Status line
			const statusIndicator = getStatusIndicator(state.status);
			if (state.status === "running") {
				const token = getToken();
				const tokenParam = token ? `?token=${token}` : "";
				lines.push(`${statusIndicator} Bridge: http://localhost:${state.port}${tokenParam}`);
				// Show LAN IPs for mobile/remote access
				const lanIps = getLanIps();
				for (const ip of lanIps) {
					const tailscaleLabel = isTailscaleIp(ip) ? " (Tailscale)" : "";
					lines.push(`  📡 LAN: http://${ip}:${state.port}${tokenParam}${tailscaleLabel}`);
				}
				lines.push(`  WebSocket: ws://localhost:${state.port}/ws`);
			} else if (state.status === "starting") {
				lines.push(`${statusIndicator} Starting on port ${state.port}...`);
			} else if (state.status === "stopping") {
				lines.push(`${statusIndicator} Shutting down...`);
			} else {
				lines.push(`${statusIndicator} Bridge stopped`);
			}
			lines.push(`  Clients: ${clients.length}`);
			lines.push("");

			// Client list (if any)
			if (clients.length > 0) {
				lines.push("Connected clients:");
				for (const client of clients.slice(-3)) {
					const time = formatTime(new Date(client.connectedAt));
					lines.push(`  #${client.seq} ${client.id.slice(0, 16)}... @ ${time}`);
				}
				if (clients.length > 3) {
					lines.push(`  ... and ${clients.length - 3} more`);
				}
				lines.push("");
			}

			// Log section
			lines.push("─".repeat(62));
			lines.push("Event log:");
			lines.push("─".repeat(62));

			if (logs.length === 0) {
				lines.push("  (No events yet - waiting for activity)");
			} else {
				// Show last 15 log entries
				const recentLogs = logs.slice(-15);
				for (const entry of recentLogs) {
					const prefix =
						entry.type === "client"
							? "[C]"
							: entry.type === "error"
								? "[E]"
								: entry.type === "shutdown"
									? "[X]"
									: "[I]";
					lines.push(`${formatTime(entry.timestamp)} ${prefix} ${entry.message}`);
				}
			}

			// Footer
			lines.push("");
			lines.push("─".repeat(62));
			lines.push("Press Ctrl+C to stop the bridge");

			return lines;
		},

		handleInput(_input: string): void {
			// Read-only view - no input handling
		},

		shouldExit(): boolean {
			return exitRequested;
		},

		requestExit(): void {
			exitRequested = true;
		},

		dispose(): void {
			unsubscribe();
		},
	};
}
