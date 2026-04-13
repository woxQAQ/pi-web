<script setup lang="ts">
import { X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { TreeEntry } from "../composables/useBridgeClient";

const props = defineProps<{
	entries: readonly TreeEntry[];
	open: boolean;
	sessionLabel: string;
	isHistoricalView: boolean;
}>();

const emit = defineEmits<{
	close: [];
	navigate: [entryId: string];
}>();

const query = ref("");

watch(
	() => props.open,
	(isOpen) => {
		if (!isOpen) {
			query.value = "";
		}
	},
);

const canNavigate = computed(() => !props.isHistoricalView);
const activePathCount = computed(() => props.entries.filter((entry) => entry.isOnActivePath).length);
const filteredEntries = computed(() => {
	const normalizedQuery = query.value.trim().toLowerCase();
	if (!normalizedQuery) return props.entries;
	return props.entries.filter((entry) => {
		const haystack = `${entry.label ?? ""} ${entry.type}`.toLowerCase();
		return haystack.includes(normalizedQuery);
	});
});

function entryLabel(entry: TreeEntry): string {
	return entry.label ?? entry.type ?? entry.id;
}

function entryRole(entry: TreeEntry): string {
	const label = entryLabel(entry).toLowerCase();
	if (label.startsWith("user:")) return "user";
	if (label.startsWith("assistant:")) return "assistant";
	if (label.startsWith("[tool:")) return "tool";
	return entry.type;
}

function isUserEntry(entry: TreeEntry): boolean {
	return entryRole(entry) === "user";
}

function isAssistantEntry(entry: TreeEntry): boolean {
	return entryRole(entry) === "assistant";
}

function handleNavigate(entryId: string) {
	if (!canNavigate.value) return;
	emit("navigate", entryId);
}
</script>

<template>
	<div v-if="open" class="tree-panel-shell">
		<div class="tree-panel-backdrop" @click="emit('close')"></div>
		<aside class="tree-panel" role="dialog" aria-modal="true" aria-label="Session tree">
			<header class="panel-header">
				<div class="panel-heading">
					<p class="panel-kicker">Session tree</p>
					<h2 class="panel-title">{{ sessionLabel }}</h2>
				</div>
				<button class="close-button" type="button" aria-label="Close tree" @click="emit('close')">
					<X aria-hidden="true" />
				</button>
			</header>

			<div class="panel-toolbar">
				<div class="panel-status-line">
					<span class="status-token">{{ entries.length }} nodes</span>
					<span class="status-token">{{ activePathCount }} on path</span>
					<span v-if="isHistoricalView" class="status-token warning">Read only</span>
				</div>
				<input v-model="query" class="search-input" type="search" placeholder="Search tree" />
			</div>

			<p v-if="isHistoricalView" class="panel-note">
				Browsing a stored session snapshot. Navigation is disabled.
			</p>

			<ol v-if="filteredEntries.length > 0" class="tree-list">
				<li v-for="entry in filteredEntries" :key="entry.id" class="tree-row">
					<button
						class="tree-item"
						:class="{
							active: entry.isActive,
							path: entry.isOnActivePath,
							readonly: !canNavigate,
							'user-message': isUserEntry(entry),
							'assistant-message': isAssistantEntry(entry),
						}"
						type="button"
						:disabled="!canNavigate"
						:title="entryLabel(entry)"
						@click="handleNavigate(entry.id)"
					>
						<span class="tree-guides" aria-hidden="true">
							<span
								v-for="(column, index) in entry.trackColumns ?? []"
								:key="`${entry.id}-${index}`"
								class="track-column"
								:class="column"
							></span>
						</span>
						<span class="tree-node"></span>
						<span class="tree-line">
							<span class="tree-role">{{ entryRole(entry) }}</span>
							<span class="tree-label">{{ entryLabel(entry) }}</span>
						</span>
						<span v-if="entry.isActive" class="tree-state">current</span>
					</button>
				</li>
			</ol>
			<div v-else class="empty-state">
				<p class="empty-title">No matching tree entries</p>
				<p class="empty-copy">Try a different search term.</p>
			</div>
		</aside>
	</div>
</template>

<style scoped>
.tree-panel-shell {
	position: fixed;
	inset: 0;
	z-index: 1200;
}

.tree-panel-backdrop {
	position: absolute;
	inset: 0;
	background: rgba(3, 3, 3, 0.56);
	backdrop-filter: blur(6px);
}

.tree-panel {
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	width: clamp(560px, 54vw, 760px);
	display: flex;
	flex-direction: column;
	background: linear-gradient(180deg, var(--bg-elevated), color-mix(in srgb, var(--panel) 92%, black));
	border-left: 1px solid var(--border);
	box-shadow: var(--shadow);
}

.panel-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	padding: 16px 18px 10px;
	border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.panel-heading {
	min-width: 0;
}

.panel-kicker,
.status-token,
.tree-role,
.tree-state {
	font-size: 0.68rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.panel-kicker {
	margin: 0 0 4px;
	color: var(--text-subtle);
}

.panel-title {
	margin: 0;
	font-size: 0.95rem;
	line-height: 1.25;
	color: var(--text);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.close-button {
	width: 28px;
	height: 28px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border-radius: 999px;
	border: 1px solid var(--border);
	background: var(--panel);
	color: var(--text-muted);
	cursor: pointer;
	transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.close-button svg {
	width: 14px;
	height: 14px;
}

.close-button:hover {
	background: var(--panel-2);
	border-color: var(--border-strong);
	color: var(--text);
}

.panel-toolbar {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 220px;
	gap: 10px;
	align-items: center;
	padding: 10px 18px 0;
}

.panel-status-line {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.status-token {
	display: inline-flex;
	align-items: center;
	height: 22px;
	padding: 0 8px;
	border-radius: 999px;
	border: 1px solid var(--border);
	background: color-mix(in srgb, var(--panel) 86%, transparent);
	color: var(--text-subtle);
}

.status-token.warning {
	color: var(--error-text);
	border-color: var(--error-border);
	background: color-mix(in srgb, var(--error-bg) 80%, transparent);
}

.search-input {
	height: 30px;
	width: 100%;
	border-radius: 10px;
	border: 1px solid var(--border);
	background: var(--panel);
	color: var(--text);
	padding: 0 12px;
	font-size: 0.82rem;
	outline: none;
}

.search-input:focus {
	border-color: var(--border-strong);
}

.panel-note {
	margin: 8px 18px 0;
	font-size: 0.74rem;
	line-height: 1.45;
	color: var(--text-subtle);
}

.tree-list {
	list-style: none;
	margin: 10px 0 0;
	padding: 0 16px 16px 18px;
	overflow-y: auto;
	flex: 1;
}

.tree-row + .tree-row {
	margin-top: 1px;
}

.tree-item {
	width: 100%;
	display: grid;
	grid-template-columns: auto auto minmax(0, 1fr) auto;
	gap: 8px;
	align-items: center;
	min-height: 28px;
	padding: 3px 8px;
	border-radius: 8px;
	border: 1px solid transparent;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
	transition: background 0.12s ease, border-color 0.12s ease;
}

.tree-item:hover {
	background: color-mix(in srgb, var(--panel-2) 72%, transparent);
}

.tree-item.readonly {
	cursor: default;
}

.tree-item.path {
	background: color-mix(in srgb, var(--panel) 62%, transparent);
}

.tree-item.active {
	background: color-mix(in srgb, var(--panel-3) 78%, transparent);
	border-color: color-mix(in srgb, var(--border) 78%, transparent);
}

.tree-item.user-message {
	background: transparent;
}

.tree-item.user-message.path {
	background: color-mix(in srgb, var(--panel) 70%, transparent);
}

.tree-item.user-message.active {
	background: color-mix(in srgb, var(--panel-3) 82%, transparent);
}

.tree-guides {
	display: inline-flex;
	align-items: stretch;
	height: 22px;
}

.track-column {
	position: relative;
	width: 14px;
	flex-shrink: 0;
}

.track-column.line::before,
.track-column.branch::before,
.track-column.branch-last::before {
	content: "";
	position: absolute;
	left: 50%;
	width: 1px;
	background: color-mix(in srgb, var(--border) 76%, transparent);
	transform: translateX(-50%);
}

.track-column.line::before,
.track-column.branch::before {
	top: -10px;
	bottom: -10px;
}

.track-column.branch-last::before {
	top: -10px;
	height: calc(50% + 1px);
}

.track-column.branch::after,
.track-column.branch-last::after {
	content: "";
	position: absolute;
	left: 50%;
	top: 50%;
	width: 12px;
	height: 1px;
	background: color-mix(in srgb, var(--border) 76%, transparent);
}

.tree-node {
	width: 7px;
	height: 7px;
	border-radius: 999px;
	background: var(--border-strong);
	flex-shrink: 0;
}

.tree-item.path .tree-node {
	background: var(--text-muted);
}

.tree-item.active .tree-node,
.tree-item.user-message .tree-node {
	background: var(--text);
}

.tree-line {
	display: flex;
	align-items: baseline;
	gap: 8px;
	min-width: 0;
	overflow: hidden;
}

.tree-role {
	color: var(--text-subtle);
	flex-shrink: 0;
}

.tree-label {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 0.84rem;
	line-height: 1.25;
	color: var(--text-muted);
}

.tree-item.user-message .tree-role,
.tree-item.user-message .tree-label,
.tree-item.active .tree-role,
.tree-item.active .tree-label {
	color: var(--text);
}

.tree-item.user-message .tree-label {
	font-weight: 600;
}

.tree-item.assistant-message .tree-label {
	color: color-mix(in srgb, var(--text-muted) 82%, var(--text-subtle));
}

.tree-state {
	color: var(--text-subtle);
	flex-shrink: 0;
}

.empty-state {
	margin: 12px 18px 18px;
	padding: 14px;
	border-radius: 10px;
	border: 1px dashed var(--border-strong);
	background: color-mix(in srgb, var(--panel) 52%, transparent);
}

.empty-title {
	margin: 0 0 4px;
	font-size: 0.82rem;
	color: var(--text);
}

.empty-copy {
	margin: 0;
	font-size: 0.74rem;
	line-height: 1.45;
	color: var(--text-subtle);
}

@media (max-width: 900px) {
	.tree-panel {
		width: 100%;
	}

	.panel-header {
		padding-top: calc(14px + env(safe-area-inset-top));
	}

	.panel-toolbar {
		grid-template-columns: 1fr;
	}
}
</style>
