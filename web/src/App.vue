<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useBridgeClient } from "./composables/useBridgeClient";
import ChatTranscript from "./components/ChatTranscript.vue";
import SessionRail from "./components/SessionRail.vue";
import TreeRail from "./components/TreeRail.vue";
import ComposerBar from "./components/ComposerBar.vue";
import ExtensionDialog from "./components/ExtensionDialog.vue";
import CompatWarning from "./components/CompatWarning.vue";
import ReconnectBanner from "./components/ReconnectBanner.vue";

type ThemeMode = "dark" | "light";

const {
	connectionStatus,
	transcript,
	sessionState,
	sessions,
	treeEntries,
	commands,
	isStreaming,
	isReconnecting,
	reconnectCount,
	lastDisconnectReason,
	connectionError,
	sendPrompt,
	sendCommand,
	pendingExtensionRequest,
	notifications,
	statusEntries,
	respondToUIRequest,
	dismissNotification,
} = useBridgeClient();

const activeSessionId = computed(() => sessionState.value?.sessionId ?? null);
const activeSessionLabel = computed(() => {
	const active = sessions.value.find((session) => session.id === activeSessionId.value);
	return active?.name ?? sessionState.value?.sessionId ?? "No active session";
});
const networkUrl = computed(() => {
	if (typeof window === "undefined") return "";
	const h = window.location.host;
	if (h.startsWith("localhost") || h.startsWith("127.")) return "";
	return h;
});
const sidebarOpen = ref(false);
const chatTranscriptRef = ref<InstanceType<typeof ChatTranscript> | null>(null);

// localStorage as instant cache to avoid flash; server as authoritative source.
const THEME_CACHE_KEY = "pi-web-theme";
function readCachedTheme(): ThemeMode {
	if (typeof window === "undefined") return "dark";
	const cached = window.localStorage.getItem(THEME_CACHE_KEY);
	if (cached === "dark" || cached === "light") return cached;
	return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
const theme = ref<ThemeMode>(readCachedTheme());
const themeLabel = computed(() => `Theme: ${theme.value === "dark" ? "Dark" : "Light"}`);

// Once connected, sync the authoritative server state.
let themeLoaded = false;
watch(connectionStatus, async (status) => {
	if (status !== "connected" || themeLoaded) return;
	themeLoaded = true;
	try {
		const res = await sendCommand({ type: "get_plugin_state", key: "theme" });
		if (res.success && (res.data as { value?: unknown }).value) {
			const saved = (res.data as { value: string }).value;
			if (saved === "dark" || saved === "light") {
				theme.value = saved;
				return;
			}
		}
	} catch {
		// Server unavailable — keep cached value
	}
});

// On change: persist to server and update localStorage cache.
watch(theme, (value) => {
	if (typeof window !== "undefined") window.localStorage.setItem(THEME_CACHE_KEY, value);
	sendCommand({ type: "set_plugin_state", key: "theme", value }).catch(() => {});
});

watch(connectionStatus, (status) => {
	if (status === "disconnected" && chatTranscriptRef.value) {
		chatTranscriptRef.value.preserveScroll();
	}
});

const compatWarningVisible = ref(false);

function toggleTheme() {
	theme.value = theme.value === "dark" ? "light" : "dark";
}

function handleSessionSelect(sessionPath: string) {
	sendCommand({ type: "switch_session", sessionPath }).catch(() => {});
}

function handleTreeNavigate(entryId: string) {
	sendCommand({ type: "navigate_tree", entryId }).catch(() => {});
}

function handlePrompt(message: string) {
	sendPrompt(message);
}

function handleUIRespond(payload: Parameters<typeof respondToUIRequest>[0]) {
	respondToUIRequest(payload);
}

function handleDismissNotification(id: string) {
	dismissNotification(id);
}

watch(
	notifications,
	(current) => {
		for (const n of current) {
			if (!(n as Record<string, unknown>)._timerSet) {
				(n as Record<string, unknown>)._timerSet = true;
				setTimeout(() => dismissNotification(n.id), 5000);
			}
		}
	},
	{ deep: true },
);
</script>

<template>
	<div class="app-shell" :data-theme="theme">
		<header class="app-header">
			<button
				class="hamburger"
				aria-label="Toggle sidebar"
				@click="sidebarOpen = !sidebarOpen"
			>
				<span></span><span></span><span></span>
			</button>
			<div class="header-brand">
				<h1 class="app-title">Pi</h1>
			</div>
			<div class="header-session">
				<span class="session-kicker">session</span>
				<span class="session-name">{{ activeSessionLabel }}</span>
			</div>
			<div class="header-status">
				<span v-if="networkUrl" class="network-url">{{ networkUrl }}</span>
				<button
					class="theme-toggle"
					type="button"
					:title="`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`"
					@click="toggleTheme"
				>
					{{ themeLabel }}
				</button>
				<span
					class="connection-indicator"
					:class="connectionStatus"
					:title="`Connection: ${connectionStatus}`"
				>
					<span class="indicator-dot"></span>
					{{ connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'connecting' ? 'Syncing...' : 'Offline' }}
				</span>
			</div>
		</header>

		<ReconnectBanner
			:visible="isReconnecting"
			:reason="lastDisconnectReason"
			:reconnect-count="reconnectCount"
		/>

		<div class="app-body">
			<aside class="left-rail" :class="{ open: sidebarOpen }">
				<SessionRail
					:sessions="sessions"
					:active-session-id="activeSessionId"
					@select="handleSessionSelect"
				/>
				<div class="rail-divider"></div>
				<TreeRail
					:entries="treeEntries"
					@navigate="handleTreeNavigate"
				/>
			</aside>
			<div class="rail-backdrop" @click="sidebarOpen = false"></div>

			<main class="center-column">
				<CompatWarning :visible="compatWarningVisible" />

				<div v-if="Object.keys(statusEntries).length > 0" class="status-bar">
					<span
						v-for="(text, key) in statusEntries"
						:key="key"
						class="status-entry"
					>
						{{ text }}
					</span>
				</div>

				<ChatTranscript ref="chatTranscriptRef" :messages="transcript" :is-streaming="isStreaming" />
				<ComposerBar
					:connection-status="connectionStatus"
					:commands="commands"
					@submit="handlePrompt"
				/>
			</main>
		</div>

		<div v-if="connectionError || notifications.length > 0" class="toast-container">
			<div v-if="connectionError" class="toast-item error" role="alert">
				<div class="toast-copy">
					<span class="toast-type">error</span>
					<span class="toast-message">{{ connectionError }}</span>
				</div>
			</div>
			<div
				v-for="notif in notifications"
				:key="notif.id"
				class="toast-item"
				:class="notif.notifyType ?? 'info'"
			>
				<div class="toast-copy">
					<span class="toast-type">{{ notif.notifyType ?? 'info' }}</span>
					<span class="toast-message">{{ notif.message }}</span>
				</div>
				<button
					class="toast-dismiss"
					aria-label="Dismiss notification"
					@click="handleDismissNotification(notif.id)"
				>
					x
				</button>
			</div>
		</div>

		<ExtensionDialog
			:request="pendingExtensionRequest"
			@respond="handleUIRespond"
		/>
	</div>
</template>

<style scoped>
.app-shell {
	--bg: #0a0a0a;
	--bg-elevated: #0f0f0f;
	--panel: #101010;
	--panel-2: #141414;
	--panel-3: #181818;
	--rail-bg: #111111;
	--border: #242424;
	--border-strong: #323232;
	--text: #f5f5f5;
	--text-muted: #b0b0b0;
	--text-subtle: #737373;
	--button-bg: #191919;
	--button-hover: #212121;
	--shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
	--overlay: rgba(0, 0, 0, 0.72);
	--backdrop: rgba(0, 0, 0, 0.45);
	--composer-fade: rgba(10, 10, 10, 0.96);
	--error-bg: rgba(127, 29, 29, 0.28);
	--error-border: rgba(248, 113, 113, 0.42);
	--error-text: #fecaca;
	display: flex;
	flex-direction: column;
	height: 100vh;
	height: 100dvh;
	width: 100vw;
	overflow: hidden;
	background: var(--bg);
	color: var(--text);
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	color-scheme: dark;
}

.app-shell[data-theme="light"] {
	--bg: #fafafa;
	--bg-elevated: #ffffff;
	--panel: #ffffff;
	--panel-2: #f5f5f5;
	--panel-3: #efefef;
	--rail-bg: #f6f6f6;
	--border: #dddddd;
	--border-strong: #c9c9c9;
	--text: #111111;
	--text-muted: #454545;
	--text-subtle: #7a7a7a;
	--button-bg: #efefef;
	--button-hover: #e6e6e6;
	--shadow: 0 18px 48px rgba(20, 20, 20, 0.08);
	--overlay: rgba(0, 0, 0, 0.22);
	--backdrop: rgba(0, 0, 0, 0.12);
	--composer-fade: rgba(250, 250, 250, 0.96);
	--error-bg: #fff1f2;
	--error-border: #fecdd3;
	--error-text: #9f1239;
	color-scheme: light;
}

.app-header {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: 16px;
	height: 48px;
	padding: 0 16px;
	border-bottom: 1px solid var(--border);
	background: var(--bg-elevated);
	flex-shrink: 0;
	z-index: 20;
}

.hamburger {
	display: none;
	flex-direction: column;
	gap: 3px;
	padding: 10px;
	margin-left: -10px;
	background: none;
	border: none;
	cursor: pointer;
}

.hamburger span {
	display: block;
	width: 16px;
	height: 1.5px;
	background: var(--text-muted);
	border-radius: 999px;
}

.header-brand {
	display: flex;
	align-items: center;
	gap: 12px;
}

.app-title {
	margin: 0;
	font-size: 0.95rem;
	line-height: 1;
	font-weight: 600;
	letter-spacing: 0.01em;
	color: var(--text);
}

.header-session {
	display: flex;
	align-items: baseline;
	gap: 10px;
	min-width: 0;
}

.session-kicker {
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	font-size: 0.68rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--text-subtle);
	white-space: nowrap;
}

.session-name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 0.82rem;
	color: var(--text-muted);
}

.header-status {
	display: flex;
	align-items: center;
	gap: 10px;
	justify-self: end;
}

.network-url,
.connection-indicator,
.theme-toggle {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	height: 26px;
	padding: 0 10px;
	border-radius: 999px;
	border: 1px solid var(--border);
	background: var(--panel);
	font-size: 0.72rem;
	color: var(--text-subtle);
}

.network-url,
.theme-toggle {
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
}

.theme-toggle {
	cursor: pointer;
	transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.theme-toggle:hover {
	background: var(--panel-2);
	border-color: var(--border-strong);
	color: var(--text-muted);
}

.connection-indicator.connected,
.connection-indicator.connecting,
.connection-indicator.disconnected {
	color: var(--text-muted);
}

.indicator-dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: currentColor;
	flex-shrink: 0;
	opacity: 0.9;
}

.connection-indicator.disconnected .indicator-dot {
	opacity: 0.45;
}

.connection-indicator.connecting .indicator-dot {
	animation: sync-pulse 1.2s ease-in-out infinite;
}

@keyframes sync-pulse {
	0%,
	100% {
		transform: scale(0.85);
		opacity: 0.45;
	}
	50% {
		transform: scale(1);
		opacity: 1;
	}
}

.app-body {
	display: grid;
	grid-template-columns: 240px minmax(0, 1fr);
	flex: 1;
	min-height: 0;
	overflow: hidden;
}

.left-rail {
	grid-column: 1;
	display: flex;
	flex-direction: column;
	background: var(--rail-bg);
	border-right: 1px solid var(--border);
	overflow: hidden;
}

.rail-divider {
	height: 1px;
	margin: 0 10px;
	background: var(--border);
	flex-shrink: 0;
}

.rail-backdrop {
	display: none;
}

.center-column {
	grid-column: 2;
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	background: var(--bg);
}

.status-bar {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	padding: 12px 24px 0;
	flex-shrink: 0;
}

.status-entry {
	display: inline-flex;
	align-items: center;
	height: 24px;
	padding: 0 10px;
	border-radius: 999px;
	border: 1px solid var(--border);
	background: var(--panel);
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	font-size: 0.68rem;
	color: var(--text-subtle);
}

.toast-container {
	position: fixed;
	top: 56px;
	right: 16px;
	z-index: 900;
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-width: 340px;
}

.toast-item {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 12px 14px;
	border-radius: 12px;
	background: var(--panel);
	border: 1px solid var(--border-strong);
	box-shadow: var(--shadow);
	animation: toast-in 0.16s ease;
}

.toast-item.error {
	background: var(--error-bg);
	border-color: var(--error-border);
}

.toast-item.error .toast-type,
.toast-item.error .toast-message {
	color: var(--error-text);
}

.toast-copy {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
	flex: 1;
}

.toast-type {
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	font-size: 0.66rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--text-subtle);
}

.toast-message {
	font-size: 0.82rem;
	line-height: 1.45;
	color: var(--text-muted);
}

.toast-dismiss {
	flex-shrink: 0;
	background: none;
	border: none;
	color: var(--text-subtle);
	font-size: 0.95rem;
	cursor: pointer;
	padding: 0;
	line-height: 1;
}

.toast-dismiss:hover {
	color: var(--text);
}

@keyframes toast-in {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

@media (max-width: 900px) {
	.hamburger {
		display: flex;
	}

	.app-header {
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 12px;
		padding-top: env(safe-area-inset-top);
		height: calc(48px + env(safe-area-inset-top));
	}

	.session-kicker,
	.network-url,
	.theme-toggle {
		display: none;
	}

	.app-body {
		grid-template-columns: 1fr;
		position: relative;
	}

	.left-rail {
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		width: min(82vw, 300px);
		transform: translateX(-100%);
		transition: transform 0.2s ease;
		z-index: 15;
	}

	.left-rail.open {
		transform: translateX(0);
		box-shadow: var(--shadow);
	}

	.rail-backdrop {
		display: block;
		position: absolute;
		inset: 0;
		background: var(--backdrop);
		z-index: 14;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.2s;
	}

	.left-rail.open ~ .rail-backdrop {
		pointer-events: auto;
		opacity: 1;
	}

	.center-column {
		grid-column: 1;
	}

	.status-bar {
		padding: 12px 16px 0;
	}

	.toast-container {
		left: 16px;
		right: 16px;
		max-width: none;
	}
}
</style>
