<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import type { ConnectionStatus } from "../composables/useBridgeClient";
import type { RpcSlashCommand } from "../shared-types";
import CommandPalette from "./CommandPalette.vue";

const props = defineProps<{
	connectionStatus: ConnectionStatus;
	commands: RpcSlashCommand[];
}>();

const emit = defineEmits<{
	submit: [message: string];
}>();

const inputText = ref("");
const isDisabled = computed(() => props.connectionStatus !== "connected");
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null);

const showPalette = ref(false);
const filterText = computed(() => {
	if (!showPalette.value) return "";
	// Everything after the leading "/"
	return inputText.value.slice(1);
});

// Show palette when input starts with "/" (only the slash, or slash + text)
watch(inputText, (val) => {
	if (val.startsWith("/")) {
		showPalette.value = true;
	} else {
		showPalette.value = false;
	}
});

function handleSubmit() {
	const text = inputText.value.trim();
	if (!text || isDisabled.value) return;
	emit("submit", text);
	inputText.value = "";
	showPalette.value = false;
}

function handleCommandSelect(commandName: string) {
	inputText.value = "";
	showPalette.value = false;
	emit("submit", `/${commandName}`);
}

function handlePaletteClose() {
	showPalette.value = false;
}

function handleInputKeydown(e: KeyboardEvent) {
	// When palette is open, forward navigation keys to the palette
	if (showPalette.value && paletteRef.value) {
		if (
			e.key === "ArrowDown" ||
			e.key === "ArrowUp" ||
			e.key === "Escape"
		) {
			paletteRef.value.handleKeydown(e);
			return;
		}
		if (e.key === "Enter") {
			paletteRef.value.handleKeydown(e);
			return;
		}
	}
	if (e.key === "Enter" && !showPalette.value) {
		handleSubmit();
	}
}
</script>

<template>
	<div class="composer-bar">
		<div class="composer-inner-wrap">
			<CommandPalette
				v-if="showPalette && commands.length > 0"
				ref="paletteRef"
				:commands="commands"
				:filter="filterText"
				@select="handleCommandSelect"
				@close="handlePaletteClose"
			/>
			<div class="composer-inner">
				<input
					v-model="inputText"
					class="prompt-input"
					placeholder="Send a message…"
					:disabled="isDisabled"
					@keydown="handleInputKeydown"
				/>
				<button
					class="send-btn"
					:disabled="isDisabled || !inputText.trim()"
					@click="handleSubmit"
				>
					<svg
						class="send-icon"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="22" y1="2" x2="11" y2="13"></line>
						<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
					</svg>
					<span class="send-label">Send</span>
				</button>
			</div>
		</div>
		<div v-if="isDisabled" class="composer-status">
			Disconnected — waiting for connection…
		</div>
	</div>
</template>

<style scoped>
.composer-bar {
	flex-shrink: 0;
	padding: 12px 16px;
	border-top: 1px solid #2d2d44;
	background: #12122a;
}

.composer-inner-wrap {
	position: relative;
}

.composer-inner {
	display: flex;
	gap: 8px;
	align-items: center;
}

.prompt-input {
	flex: 1;
	padding: 10px 14px;
	border-radius: 8px;
	border: 1px solid #2d2d44;
	background: #1a1a2e;
	color: #e2e8f0;
	font-size: 0.9rem;
	outline: none;
	transition: border-color 0.15s;
}

.prompt-input:focus {
	border-color: #2563eb;
}

.prompt-input:disabled {
	opacity: 0.35;
	cursor: not-allowed;
}

.prompt-input::placeholder {
	color: #4b5563;
}

.send-btn {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 10px 18px;
	border-radius: 8px;
	border: none;
	background: #2563eb;
	color: #fff;
	font-weight: 600;
	font-size: 0.85rem;
	cursor: pointer;
	transition: background 0.15s, opacity 0.15s;
}

.send-btn:hover:not(:disabled) {
	background: #1d4ed8;
}

.send-btn:disabled {
	opacity: 0.35;
	cursor: not-allowed;
}

.send-icon {
	width: 16px;
	height: 16px;
}

.send-label {
	line-height: 1;
}

.composer-status {
	margin-top: 6px;
	font-size: 0.7rem;
	color: #ef4444;
	text-align: center;
}
</style>
