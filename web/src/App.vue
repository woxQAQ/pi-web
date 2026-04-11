<script setup lang="ts">
import { ref, computed } from "vue";
import { useBridgeClient } from "./composables/useBridgeClient";
import ChatTranscript from "./components/ChatTranscript.vue";
import SessionRail from "./components/SessionRail.vue";
import TreeRail from "./components/TreeRail.vue";
import ComposerBar from "./components/ComposerBar.vue";
import ExtensionDialog from "./components/ExtensionDialog.vue";
import CompatWarning from "./components/CompatWarning.vue";

const {
	connectionStatus,
	transcript,
	sessionState,
	sessions,
	treeEntries,
	isStreaming,
	sendPrompt,
	sendCommand,
	pendingExtensionRequest,
	notifications,
	statusEntries,
	respondToUIRequest,
	dismissNotification,
} = useBridgeClient();

const activeSessionId = computed(() => sessionState.value?.sessionId ?? null);
const sidebarOpen = ref(false);

// CompatWarning flag — set to true when a custom-ui command is invoked.
// Initially empty list; the infrastructure exists but doesn't trigger until
// commands are added to the list.
const compatWarningVisible = ref(false);

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

// Auto-dismiss notifications after 5 seconds
import { watch } from "vue";
watch(notifications, (current) => {
	for (const n of current) {
		if (!(n as Record<string, unknown>)._timerSet) {
			(n as Record<string, unknown>)._timerSet = true;
			setTimeout(() => dismissNotification(n.id), 5000);
		}
	}
}, { deep: true });
</script>

<template>
	<div class="app-shell">
		<!-- Header -->
		<header class="app-header">
			<button
				class="hamburger"
				aria-label="Toggle sidebar"
				@click="sidebarOpen = !sidebarOpen"
			>
				<span></span><span></span><span></span>
			</button>
			<h1 class="app-title">Pi</h1>
			<span
				class="connection-badge"
				:class="connectionStatus"
				:title="`Connection: ${connectionStatus}`"
			>
				<span class="badge-dot"></span>
				{{ connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'connecting' ? 'Connecting…' : 'Disconnected' }}
			</span>
		</header>

		<!-- Body: CSS Grid layout -->
		<div class="app-body">
			<!-- Left rail column -->
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

			<!-- Center column -->
			<main class="center-column">
				<CompatWarning :visible="compatWarningVisible" />

				<!-- Status bar (when status entries exist) -->
				<div v-if="Object.keys(statusEntries).length > 0" class="status-bar">
					<span
						v-for="(text, key) in statusEntries"
						:key="key"
						class="status-entry"
					>
						{{ text }}
					</span>
				</div>

				<ChatTranscript :messages="transcript" :is-streaming="isStreaming" />
				<ComposerBar
					:connection-status="connectionStatus"
					@submit="handlePrompt"
				/>
			</main>
		</div>

		<!-- Toast notifications overlay -->
		<div v-if="notifications.length > 0" class="toast-container">
			<div
				v-for="notif in notifications"
				:key="notif.id"
				class="toast-item"
				:class="notif.notifyType ?? 'info'"
			>
				<span class="toast-message">{{ notif.message }}</span>
				<button
					class="toast-dismiss"
					aria-label="Dismiss notification"
					@click="handleDismissNotification(notif.id)"
				>
					&times;
				</button>
			</div>
		</div>

		<!-- Extension UI dialog overlay -->
		<ExtensionDialog
			:request="pendingExtensionRequest"
			@respond="handleUIRespond"
		/>
	</div>
</template>

<style scoped>
/* ---- Shell ---- */
.app-shell {
	display: flex;
	flex-direction: column;
	height: 100vh;
	width: 100vw;
	overflow: hidden;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	background: #0f0f23;
	color: #e2e8f0;
}

/* ---- Header ---- */
.app-header {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 20px;
	border-bottom: 1px solid #2d2d44;
	flex-shrink: 0;
	background: #12122a;
	z-index: 20;
}

.hamburger {
	display: none;
	flex-direction: column;
	gap: 3px;
	padding: 6px;
	background: none;
	border: none;
	cursor: pointer;
}

.hamburger span {
	display: block;
	width: 18px;
	height: 2px;
	background: #9ca3af;
	border-radius: 1px;
}

.app-title {
	margin: 0;
	font-size: 1.2rem;
	color: #60a5fa;
	font-weight: 700;
	letter-spacing: -0.02em;
}

.connection-badge {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-left: auto;
	padding: 3px 10px;
	border-radius: 999px;
	font-size: 0.7rem;
	font-weight: 600;
	color: #9ca3af;
	background: #1a1a2e;
	border: 1px solid #2d2d44;
}

.connection-badge.connected {
	color: #22c55e;
	border-color: #166534;
}

.connection-badge.connecting {
	color: #eab308;
	border-color: #854d0e;
}

.connection-badge.disconnected {
	color: #ef4444;
	border-color: #991b1b;
}

.badge-dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: currentColor;
	flex-shrink: 0;
}

/* ---- Body ---- */
.app-body {
	display: grid;
	grid-template-columns: 220px 1fr;
	flex: 1;
	overflow: hidden;
}

/* ---- Left Rail ---- */
.left-rail {
	grid-column: 1;
	display: flex;
	flex-direction: column;
	background: #16162a;
	border-right: 1px solid #2d2d44;
	overflow: hidden;
}

.rail-divider {
	height: 1px;
	background: #2d2d44;
	flex-shrink: 0;
}

.rail-backdrop {
	display: none;
}

/* ---- Center Column ---- */
.center-column {
	grid-column: 2;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

/* ---- Status bar ---- */
.status-bar {
	display: flex;
	gap: 16px;
	padding: 4px 16px;
	border-bottom: 1px solid #2d2d44;
	background: #12122a;
	font-size: 0.7rem;
	color: #6b7280;
	flex-shrink: 0;
}

.status-entry {
	white-space: nowrap;
}

/* ---- Toast notifications ---- */
.toast-container {
	position: fixed;
	top: 60px;
	right: 20px;
	z-index: 900;
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-width: 360px;
}

.toast-item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px;
	border-radius: 8px;
	background: #1a1a2e;
	border: 1px solid #2d2d44;
	color: #e2e8f0;
	font-size: 0.85rem;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	animation: toast-in 0.2s ease;
}

.toast-item.info {
	border-left: 3px solid #3b82f6;
}

.toast-item.warning {
	border-left: 3px solid #eab308;
}

.toast-item.error {
	border-left: 3px solid #ef4444;
}

.toast-message {
	flex: 1;
}

.toast-dismiss {
	flex-shrink: 0;
	background: none;
	border: none;
	color: #6b7280;
	font-size: 1.2rem;
	cursor: pointer;
	padding: 0 2px;
	line-height: 1;
	transition: color 0.15s;
}

.toast-dismiss:hover {
	color: #e2e8f0;
}

@keyframes toast-in {
	from {
		opacity: 0;
		transform: translateX(20px);
	}
	to {
		opacity: 1;
		transform: translateX(0);
	}
}

/* ---- Responsive: narrow screens ---- */
@media (max-width: 900px) {
	.hamburger {
		display: flex;
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
		width: 260px;
		transform: translateX(-100%);
		transition: transform 0.2s ease;
		z-index: 15;
		box-shadow: none;
	}

	.left-rail.open {
		transform: translateX(0);
		box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
	}

	.rail-backdrop {
		display: block;
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
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
}
</style>
