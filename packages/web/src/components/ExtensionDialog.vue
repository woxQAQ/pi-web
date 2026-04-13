<script setup lang="ts">
import { X } from "lucide-vue-next";
import { ref, watch } from "vue";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "../shared-types";

const props = defineProps<{
	request: RpcExtensionUIRequest | null;
}>();

const emit = defineEmits<{
	respond: [payload: RpcExtensionUIResponse];
}>();

const inputValue = ref("");
const editorValue = ref("");
const selectedIndex = ref(-1);

function handleSelect(option: string) {
	if (!props.request) return;
	emit("respond", {
		type: "extension_ui_response",
		id: props.request.id,
		value: option,
	});
}

function handleConfirm(confirmed: boolean) {
	if (!props.request) return;
	emit("respond", {
		type: "extension_ui_response",
		id: props.request.id,
		confirmed,
	});
}

function handleInputSubmit() {
	if (!props.request) return;
	emit("respond", {
		type: "extension_ui_response",
		id: props.request.id,
		value: inputValue.value,
	});
	inputValue.value = "";
}

function handleEditorSubmit() {
	if (!props.request) return;
	emit("respond", {
		type: "extension_ui_response",
		id: props.request.id,
		value: editorValue.value,
	});
	editorValue.value = "";
}

function handleCancel() {
	if (!props.request) return;
	emit("respond", {
		type: "extension_ui_response",
		id: props.request.id,
		cancelled: true,
	});
	inputValue.value = "";
	editorValue.value = "";
}

function initFromRequest() {
	if (!props.request) return;
	if (props.request.method === "input") {
		inputValue.value = "";
	}
	if (props.request.method === "editor" && props.request.prefill) {
		editorValue.value = props.request.prefill;
	} else {
		editorValue.value = "";
	}
	selectedIndex.value = -1;
}

watch(() => props.request, initFromRequest, { immediate: true });
</script>

<template>
	<Teleport to="body">
		<div v-if="request" class="dialog-overlay" @click.self="handleCancel">
			<div class="dialog-panel">
				<div class="dialog-header">
					<div>
						<div class="dialog-kicker">Extension request</div>
						<h3 class="dialog-title">{{ request.title }}</h3>
					</div>
					<button class="dialog-close" aria-label="Cancel" @click="handleCancel">
						<X aria-hidden="true" />
					</button>
				</div>

				<div v-if="request.method === 'select'" class="dialog-body">
					<ul class="select-list">
						<li
							v-for="(option, i) in request.options"
							:key="i"
							class="select-item"
							:class="{ selected: selectedIndex === i }"
							@click="handleSelect(option)"
							@mouseenter="selectedIndex = i"
							@mouseleave="selectedIndex = -1"
						>
							{{ option }}
						</li>
					</ul>
				</div>

				<div v-else-if="request.method === 'confirm'" class="dialog-body">
					<p class="confirm-message">{{ request.message }}</p>
					<div class="dialog-actions">
						<button class="btn btn-cancel" @click="handleConfirm(false)">Cancel</button>
						<button class="btn btn-primary" @click="handleConfirm(true)">Confirm</button>
					</div>
				</div>

				<div v-else-if="request.method === 'input'" class="dialog-body">
					<input
						v-model="inputValue"
						class="dialog-input"
						:placeholder="request.placeholder ?? 'Enter a value...'"
						@keydown.enter="handleInputSubmit"
					/>
					<div class="dialog-actions">
						<button class="btn btn-cancel" @click="handleCancel">Cancel</button>
						<button class="btn btn-primary" @click="handleInputSubmit">Submit</button>
					</div>
				</div>

				<div v-else-if="request.method === 'editor'" class="dialog-body">
					<textarea
						v-model="editorValue"
						class="dialog-textarea"
						rows="10"
						@keydown.ctrl.enter="handleEditorSubmit"
						@keydown.meta.enter="handleEditorSubmit"
					></textarea>
					<div class="dialog-hint">Ctrl+Enter to submit</div>
					<div class="dialog-actions">
						<button class="btn btn-cancel" @click="handleCancel">Cancel</button>
						<button class="btn btn-primary" @click="handleEditorSubmit">Submit</button>
					</div>
				</div>

				<div v-if="request.method === 'select'" class="dialog-actions select-actions">
					<button class="btn btn-cancel" @click="handleCancel">Cancel</button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.dialog-overlay {
	position: fixed;
	inset: 0;
	z-index: 1000;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--overlay);
	backdrop-filter: blur(6px);
}

.dialog-panel {
	width: min(92vw, 520px);
	max-height: 80vh;
	max-height: 80dvh;
	overflow-y: auto;
	background: var(--panel);
	border: 1px solid var(--border-strong);
	border-radius: 16px;
	box-shadow: var(--shadow);
	display: flex;
	flex-direction: column;
}

.dialog-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
	padding: 18px 20px 16px;
	border-bottom: 1px solid var(--border);
	flex-shrink: 0;
}

.dialog-kicker {
	margin-bottom: 6px;
	font-size: 0.66rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--text-subtle);
}

.dialog-title {
	margin: 0;
	font-size: 1rem;
	font-weight: 600;
	color: var(--text);
}

.dialog-close {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: none;
	border: none;
	color: var(--text-subtle);
	cursor: pointer;
	line-height: 1;
	padding: 4px;
}

.dialog-close svg {
	width: 16px;
	height: 16px;
}

.dialog-close:hover {
	color: var(--text);
}

.dialog-body {
	padding: 16px 20px;
	flex: 1;
	overflow-y: auto;
}

.select-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.select-item {
	padding: 12px 14px;
	border-radius: 10px;
	cursor: pointer;
	color: var(--text);
	font-size: 0.9rem;
	transition: background 0.1s ease, border-color 0.1s ease;
	border: 1px solid var(--border);
	background: var(--panel-2);
}

.select-item:hover,
.select-item.selected {
	background: var(--panel-3);
	border-color: var(--border-strong);
}

.confirm-message {
	margin: 0 0 16px;
	color: var(--text-muted);
	font-size: 0.9rem;
	line-height: 1.6;
}

.dialog-input,
.dialog-textarea {
	width: 100%;
	padding: 12px 14px;
	border-radius: 12px;
	border: 1px solid var(--border);
	background: var(--bg-elevated);
	color: var(--text);
	font-size: 0.92rem;
	outline: none;
	box-sizing: border-box;
}

.dialog-input:focus,
.dialog-textarea:focus {
	border-color: var(--border-strong);
}

.dialog-input::placeholder {
	color: var(--text-subtle);
}

.dialog-textarea {
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	resize: vertical;
	margin-bottom: 6px;
}

.dialog-hint {
	margin-bottom: 14px;
	font-family: "SF Mono", "Monaco", "Menlo", monospace;
	font-size: 0.68rem;
	color: var(--text-subtle);
}

.dialog-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	padding: 0 20px 18px;
}

.select-actions {
	padding-top: 0;
}

.btn {
	height: 38px;
	padding: 0 16px;
	border-radius: 10px;
	border: 1px solid var(--border);
	font-size: 0.84rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.btn-primary {
	background: var(--button-bg);
	color: var(--text);
}

.btn-primary:hover {
	background: var(--button-hover);
	border-color: var(--border-strong);
}

.btn-cancel {
	background: transparent;
	color: var(--text-muted);
}

.btn-cancel:hover {
	background: var(--panel-2);
	color: var(--text);
}

@media (max-width: 900px) {
	.dialog-panel {
		width: min(95vw, 520px);
		max-height: 90vh;
		max-height: 90dvh;
	}

	.select-item,
	.btn {
		min-height: 44px;
	}

	.dialog-input,
	.dialog-textarea {
		font-size: 16px;
	}
}
</style>
