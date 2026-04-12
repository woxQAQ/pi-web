<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import type { TranscriptEntry } from "../composables/useBridgeClient";
import { contentBlocks, isToolResultMessage, messageContent } from "../utils/transcript";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import ToolCard from "./ToolCard.vue";

const props = defineProps<{
	messages: readonly TranscriptEntry[];
	isStreaming: boolean;
}>();

const container = ref<HTMLDivElement | null>(null);

let wasDisconnected = false;
let savedScrollTop = 0;
let savedScrollHeight = 0;

function preserveScroll() {
	if (!container.value) return;
	savedScrollTop = container.value.scrollTop;
	savedScrollHeight = container.value.scrollHeight;
	wasDisconnected = true;
}

function restoreScroll() {
	if (!container.value || !wasDisconnected) return;
	const delta = container.value.scrollHeight - savedScrollHeight;
	container.value.scrollTop = savedScrollTop + delta;
	wasDisconnected = false;
}

function roleClass(role: string): "user" | "assistant" | "tool" {
	if (role === "user") return "user";
	if (role === "assistant") return "assistant";
	return "tool";
}

function roleLabel(role: string): string {
	if (role === "toolResult") return "Tool Result";
	if (role === "tool") return "Tool";
	return role;
}

const expandedToolBlocks = ref(new Set<string>());
const expandedThinking = ref(new Set<string>());

function toolBlockKey(msgId: string | undefined, blockIdx: number): string {
	return `${msgId ?? ""}-${blockIdx}`;
}

function toggleToolBlock(msgId: string | undefined, blockIdx: number) {
	const key = toolBlockKey(msgId, blockIdx);
	const next = new Set(expandedToolBlocks.value);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	expandedToolBlocks.value = next;
}

function toggleThinking(msgId: string | undefined, blockIdx: number) {
	const key = toolBlockKey(msgId, blockIdx);
	const next = new Set(expandedThinking.value);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	expandedThinking.value = next;
}

function isToolBlockExpanded(msgId: string | undefined, blockIdx: number): boolean {
	return expandedToolBlocks.value.has(toolBlockKey(msgId, blockIdx));
}

function isThinkingExpanded(msgId: string | undefined, blockIdx: number): boolean {
	return expandedThinking.value.has(toolBlockKey(msgId, blockIdx));
}

function previewText(text: string, maxLines: number = 8): string {
	const normalized = text.replace(/\r/g, "").trim();
	if (!normalized) return "";
	const lines = normalized.split("\n");
	if (lines.length <= maxLines) return normalized;
	const remaining = lines.length - maxLines;
	return `${lines.slice(0, maxLines).join("\n")}\n... ${remaining} more line${remaining === 1 ? "" : "s"}`;
}

watch(
	() => props.messages.length,
	async () => {
		if (!wasDisconnected) {
			await nextTick();
			if (container.value) {
				container.value.scrollTop = container.value.scrollHeight;
			}
			return;
		}
		await nextTick();
		restoreScroll();
	},
);

watch(
	() => props.isStreaming,
	async (streaming) => {
		if (streaming) {
			await nextTick();
			if (container.value) {
				container.value.scrollTop = container.value.scrollHeight;
			}
		}
	},
);

watch(
	() => props.messages,
	() => {
		expandedToolBlocks.value = new Set();
		expandedThinking.value = new Set();
	},
	{ deep: false },
);

defineExpose({ preserveScroll });
</script>

<template>
	<div ref="container" class="chat-transcript">
		<div v-if="messages.length === 0" class="empty-state">
			<p class="empty-title">Start a conversation</p>
			<p class="empty-subtitle">Use / to open commands, then keep the session moving.</p>
			<div class="empty-hints">
				<span class="hint-chip">/ commands</span>
				<span class="hint-chip">Enter send</span>
			</div>
		</div>
		<template v-for="(msg, index) in messages" :key="msg.id ?? index">
			<div v-if="isToolResultMessage(msg)" class="message-row tool">
				<div class="message-meta">
					<span class="message-role">{{ roleLabel(msg.role) }}</span>
				</div>
				<div class="message-content tool-row">
					<div class="tool-result-card">
						<div class="tool-result-card-header">
							<span class="tool-result-card-label">{{ roleLabel(msg.role) }}</span>
							<button
								type="button"
								class="tool-result-card-toggle"
								@click="toggleToolBlock(msg.id, -1)"
								:title="isToolBlockExpanded(msg.id, -1) ? 'Collapse' : 'Expand'"
							>
								{{ isToolBlockExpanded(msg.id, -1) ? "Hide" : "Details" }}
							</button>
						</div>
						<pre class="tool-result-card-preview">{{ previewText(messageContent(msg), 6) }}</pre>
						<pre v-if="isToolBlockExpanded(msg.id, -1)" class="tool-result-card-details">{{ messageContent(msg) }}</pre>
					</div>
				</div>
			</div>

			<div v-else class="message-row" :class="roleClass(msg.role)">
				<div class="message-content" :class="roleClass(msg.role)">
					<template v-for="(block, bIdx) in contentBlocks(msg)" :key="bIdx">
						<div v-if="block.kind === 'thinking'" class="thinking-block">
							<button class="thinking-toggle" @click="toggleThinking(msg.id, bIdx)">
								<span class="toggle-icon">{{ isThinkingExpanded(msg.id, bIdx) ? '-' : '+' }}</span>
								Thinking
							</button>
							<pre v-if="isThinkingExpanded(msg.id, bIdx)" class="thinking-content">{{ block.text }}</pre>
						</div>

						<ToolCard
							v-else-if="block.kind === 'tool'"
							class="tool-card-block"
							:block="block"
							:expanded="isToolBlockExpanded(msg.id, bIdx)"
							@toggle="toggleToolBlock(msg.id, bIdx)"
						/>

						<MarkdownRenderer v-else-if="block.kind === 'text' && block.text" :content="block.text" />
					</template>
				</div>
			</div>
		</template>

		<div v-if="isStreaming" class="streaming-indicator">
			<span class="dot"></span>
			<span class="dot"></span>
			<span class="dot"></span>
		</div>
	</div>
</template>

<style scoped>
.chat-transcript {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 24px 32px 12px;
	display: flex;
	flex-direction: column;
	gap: 16px;
	background: transparent;
}

.empty-state {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	flex: 1;
	text-align: center;
	color: var(--text-muted);
}

.empty-title {
	margin: 0;
	font-size: 1.1rem;
	font-weight: 500;
	color: var(--text);
}

.empty-subtitle {
	margin: 0;
	max-width: 420px;
	font-size: 0.85rem;
	line-height: 1.6;
	color: var(--text-subtle);
}

.empty-hints {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	justify-content: center;
}

.hint-chip {
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

.message-row {
	width: 100%;
	max-width: 920px;
	margin: 0 auto;
}

.message-row.assistant,
.message-row.user {
	display: flex;
}

.message-row.user {
	justify-content: flex-end;
}

.message-row.tool {
	display: grid;
	grid-template-columns: 96px minmax(0, 1fr);
	gap: 16px;
}

.message-meta {
	padding-top: 2px;
}

.message-role {
	display: inline-block;
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	font-size: 0.64rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--text-subtle);
}

.message-content {
	min-width: 0;
	font-size: 0.9rem;
	line-height: 1.7;
	color: var(--text);
	word-break: break-word;
}

.message-content.assistant,
.message-content.tool {
	width: 100%;
	padding-left: 14px;
}

.message-content.user {
	width: fit-content;
	max-width: min(720px, 100%);
	margin-left: auto;
	padding: 12px 16px;
	border: 1px solid var(--border);
	border-radius: 18px 18px 8px 18px;
	background: var(--panel-2);
}

.markdown-body + .markdown-body,
.markdown-body + .thinking-block,
.markdown-body + .tool-card-block,
.thinking-block + .markdown-body,
.tool-card-block + .markdown-body,
.tool-card-block + .thinking-block,
.thinking-block + .tool-card-block {
	margin-top: 12px;
}

.thinking-block {
	padding-left: 10px;
}

.thinking-toggle {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 0;
	background: none;
	border: none;
	color: var(--text-muted);
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	font-size: 0.7rem;
	cursor: pointer;
}

.thinking-toggle:hover {
	color: var(--text);
}

.thinking-content {
	margin: 8px 0 0;
	padding: 10px 0 0;
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	font-size: 0.74rem;
	line-height: 1.55;
	color: var(--text-muted);
	max-height: 300px;
	overflow-y: auto;
	white-space: pre-wrap;
	word-break: break-word;
}

.tool-row {
	padding-left: 10px;
}

.tool-result-card {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px 14px;
	border: 1px solid var(--border);
	border-left: 2px solid var(--border-strong);
	border-radius: 12px;
	background: var(--tool-card-bg);
}

.tool-result-card-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.tool-result-card-label,
.tool-result-card-toggle {
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
}

.tool-result-card-label {
	font-size: 0.66rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--text-subtle);
}

.tool-result-card-toggle {
	padding: 5px 9px;
	border: 1px solid var(--border);
	border-radius: 999px;
	background: color-mix(in srgb, var(--tool-card-bg) 72%, transparent);
	font-size: 0.66rem;
	color: var(--text-subtle);
	cursor: pointer;
}

.tool-result-card-toggle:hover {
	border-color: var(--border-strong);
	color: var(--text-muted);
}

.tool-result-card-preview,
.tool-result-card-details {
	margin: 0;
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	font-size: 0.72rem;
	line-height: 1.6;
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--text-muted);
}

.tool-result-card-details {
	padding-top: 10px;
	border-top: 1px solid var(--border);
}

.toggle-icon {
	width: 12px;
	text-align: center;
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	font-size: 0.68rem;
}

.streaming-indicator {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0 0 8px 14px;
	width: min(920px, calc(100% - 64px));
	margin: 0 auto;
}

.streaming-indicator .dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--text-muted);
	animation: blink 1.2s infinite;
}

.streaming-indicator .dot:nth-child(2) {
	animation-delay: 0.2s;
}

.streaming-indicator .dot:nth-child(3) {
	animation-delay: 0.4s;
}

@keyframes blink {
	0%,
	80%,
	100% {
		opacity: 0.2;
	}
	40% {
		opacity: 1;
	}
}

@media (max-width: 900px) {
	.chat-transcript {
		padding: 16px 16px 10px;
	}

	.message-row.tool {
		grid-template-columns: 1fr;
		gap: 8px;
	}

	.message-content.assistant,
	.message-content.tool,
	.message-content.user,
	.tool-row {
		margin-left: 0;
		max-width: 100%;
	}

	.streaming-indicator {
		width: calc(100% - 32px);
	}
}
</style>
