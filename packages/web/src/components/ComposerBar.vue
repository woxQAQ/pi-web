<script setup lang="ts">
import { CornerDownLeft, ImagePlus, Square, X } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { ConnectionStatus } from "../composables/useBridgeClient";
import type { RpcImageContent, RpcSlashCommand } from "../shared-types";
import {
  COMPOSER_ATTACHMENT_ACCEPT,
  createComposerAttachments,
  extractSupportedImageFiles,
  formatAttachmentSize,
  toRpcImageContent,
  type ComposerAttachment,
} from "../utils/attachments";
import type { RpcModelInfo } from "../utils/models";
import CommandPalette from "./CommandPalette.vue";
import ModelDropdown from "./ModelDropdown.vue";

const THINKING_LEVEL_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
] as const;

const props = defineProps<{
  connectionStatus: ConnectionStatus;
  isStreaming: boolean;
  commands: RpcSlashCommand[];
  models: RpcModelInfo[];
  selectedModel: RpcModelInfo | null;
  thinkingLevel: string | null;
}>();

const emit = defineEmits<{
  submit: [payload: { message: string; images: RpcImageContent[] }];
  abort: [];
  selectModel: [model: RpcModelInfo];
  selectThinkingLevel: [level: string];
}>();

const MAX_TEXTAREA_HEIGHT = 160;

const inputText = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const isDisabled = computed(() => props.connectionStatus !== "connected");
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null);
const attachments = ref<ComposerAttachment[]>([]);
const isDragActive = ref(false);
const attachmentNotice = ref<string | null>(null);

const showPalette = ref(false);
const filterText = computed(() => {
  if (!showPalette.value) return "";
  return inputText.value.slice(1);
});
const currentModelText = computed(() => {
  if (!props.selectedModel)
    return props.models.length > 0 ? "choose model" : "no models";
  return `${props.selectedModel.provider}/${props.selectedModel.id}`;
});
const selectedThinkingLevel = computed(() => {
  if (props.thinkingLevel === "normal") return "medium";
  return props.thinkingLevel ?? "off";
});
const selectedThinkingLabel = computed(
  () =>
    THINKING_LEVEL_OPTIONS.find(
      (option) => option.value === selectedThinkingLevel.value,
    )?.label ?? "Off",
);
const thinkingSelectWidth = computed(
  () => `calc(${selectedThinkingLabel.value.length + 1.5}ch + 84px)`,
);
const normalizedInputText = computed(() =>
  normalizeSubmittedText(inputText.value),
);
const showStopButton = computed(() => props.isStreaming);
const hasAttachments = computed(() => attachments.value.length > 0);
const canSubmit = computed(
  () =>
    !isDisabled.value &&
    (normalizedInputText.value.length > 0 || hasAttachments.value),
);
const canAbort = computed(() => !isDisabled.value && props.isStreaming);
const attachmentSummary = computed(() => {
  if (attachmentNotice.value) return attachmentNotice.value;
  if (!attachments.value.length) return "";
  if (attachments.value.length === 1) return "1 image attached";
  return `${attachments.value.length} images attached`;
});

let attachmentNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let dragDepth = 0;

function normalizeSubmittedText(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  if (lines.length === 0) return "";

  lines[0] = lines[0].trimStart();
  lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
  return lines.join("\n");
}

function resizeTextarea() {
  nextTick(() => {
    const el = textareaRef.value;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    el.style.overflowY =
      el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  });
}

watch(inputText, (val) => {
  showPalette.value = val.startsWith("/");
  resizeTextarea();
});

function clearAttachmentNotice() {
  if (attachmentNoticeTimer) {
    clearTimeout(attachmentNoticeTimer);
    attachmentNoticeTimer = null;
  }
  attachmentNotice.value = null;
}

function setAttachmentNotice(message: string | null) {
  clearAttachmentNotice();
  attachmentNotice.value = message;
  if (!message) return;
  attachmentNoticeTimer = setTimeout(() => {
    attachmentNotice.value = null;
    attachmentNoticeTimer = null;
  }, 4000);
}

async function addAttachmentsFromFiles(
  files: Iterable<File> | ArrayLike<File> | null | undefined,
) {
  if (!files) return;

  const incomingFiles = Array.from(files);
  if (!incomingFiles.length) return;

  const { attachments: nextAttachments, rejectedNames } =
    await createComposerAttachments(incomingFiles);

  if (nextAttachments.length > 0) {
    attachments.value = [...attachments.value, ...nextAttachments];
    setAttachmentNotice(null);
  }

  if (rejectedNames.length > 0) {
    setAttachmentNotice(`Skipped unsupported files: ${rejectedNames.join(", ")}`);
  }
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(
    (attachment) => attachment.id !== id,
  );
  if (attachments.value.length === 0) {
    clearAttachmentNotice();
  }
}

function clearAttachments() {
  attachments.value = [];
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
}

function submitMessage(message: string) {
  emit("submit", {
    message,
    images: toRpcImageContent(attachments.value),
  });
  inputText.value = "";
  clearAttachments();
  clearAttachmentNotice();
  showPalette.value = false;
  resizeTextarea();
}

function handleSubmit() {
  const text = normalizedInputText.value;
  if ((!text && !hasAttachments.value) || isDisabled.value) return;
  submitMessage(text);
}

function handleAbort() {
  if (!canAbort.value) return;
  emit("abort");
}

function handlePrimaryAction() {
  if (showStopButton.value) {
    handleAbort();
    return;
  }
  handleSubmit();
}

function handleCommandSelect(commandName: string) {
  submitMessage(`/${commandName}`);
}

function handlePaletteClose() {
  showPalette.value = false;
}

function handleModelSelect(model: RpcModelInfo) {
  emit("selectModel", model);
}

function handleThinkingLevelChange(event: Event) {
  const level = (event.target as HTMLSelectElement | null)?.value;
  if (!level) return;
  emit("selectThinkingLevel", level);
}

function handleFilePickerOpen() {
  fileInputRef.value?.click();
}

async function handleFileInputChange(event: Event) {
  const files = (event.target as HTMLInputElement | null)?.files;
  await addAttachmentsFromFiles(files);
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
}

function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files");
}

function extractPastedFiles(event: ClipboardEvent): File[] {
  const directFiles = extractSupportedImageFiles(event.clipboardData?.files);
  if (directFiles.length > 0) return directFiles;

  const pastedFiles = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  return extractSupportedImageFiles(pastedFiles);
}

async function handleInputPaste(event: ClipboardEvent) {
  const pastedFiles = extractPastedFiles(event);
  if (pastedFiles.length === 0) return;
  event.preventDefault();
  await addAttachmentsFromFiles(pastedFiles);
}

function handleDragEnter(event: DragEvent) {
  if (!hasFilePayload(event.dataTransfer)) return;
  dragDepth += 1;
  isDragActive.value = true;
}

function handleDragOver(event: DragEvent) {
  if (!hasFilePayload(event.dataTransfer)) return;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  isDragActive.value = true;
}

function handleDragLeave(event: DragEvent) {
  if (!hasFilePayload(event.dataTransfer)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    isDragActive.value = false;
  }
}

async function handleDrop(event: DragEvent) {
  dragDepth = 0;
  isDragActive.value = false;
  await addAttachmentsFromFiles(event.dataTransfer?.files);
}

function handleInputKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.isStreaming) {
    e.preventDefault();
    handleAbort();
    return;
  }

  if (showPalette.value && paletteRef.value) {
    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Escape" ||
      e.key === "Enter"
    ) {
      paletteRef.value.handleKeydown(e);
      return;
    }
  }

  if (e.key === "Enter" && !e.shiftKey && !showPalette.value) {
    e.preventDefault();
    handleSubmit();
  }
}

onBeforeUnmount(() => {
  clearAttachmentNotice();
});

resizeTextarea();
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
      <div
        class="composer-dock"
        :class="{ disabled: isDisabled, 'drag-active': isDragActive }"
        @dragenter.prevent="handleDragEnter"
        @dragover.prevent="handleDragOver"
        @dragleave.prevent="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <input
          ref="fileInputRef"
          class="hidden-file-input"
          type="file"
          multiple
          :accept="COMPOSER_ATTACHMENT_ACCEPT"
          @change="handleFileInputChange"
        />

        <div v-if="attachments.length > 0" class="attachment-strip">
          <div
            v-for="attachment in attachments"
            :key="attachment.id"
            class="attachment-chip"
          >
            <img
              class="attachment-chip-preview"
              :src="attachment.previewUrl"
              :alt="attachment.name"
            />
            <div class="attachment-chip-body">
              <span class="attachment-chip-name">{{ attachment.name }}</span>
              <span class="attachment-chip-meta">
                {{ formatAttachmentSize(attachment.size) }}
              </span>
            </div>
            <button
              type="button"
              class="attachment-chip-remove"
              :aria-label="`Remove ${attachment.name}`"
              @click="removeAttachment(attachment.id)"
            >
              <X class="attachment-chip-remove-icon" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="composer-main-row">
          <button
            type="button"
            class="attach-btn"
            :class="{ active: hasAttachments }"
            :title="hasAttachments ? 'Add more images' : 'Attach images'"
            @click="handleFilePickerOpen"
          >
            <ImagePlus class="attach-icon" aria-hidden="true" />
          </button>
          <textarea
            ref="textareaRef"
            v-model="inputText"
            class="prompt-input"
            rows="1"
            :disabled="isDisabled"
            placeholder="Ask anything, or drop an image"
            @keydown="handleInputKeydown"
            @input="resizeTextarea"
            @paste="handleInputPaste"
          />
        </div>

        <div class="composer-footer-row">
          <div class="composer-status-cluster">
            <ModelDropdown
              :models="models"
              :selected-model="selectedModel"
              :label="currentModelText"
              :disabled="isDisabled"
              @select="handleModelSelect"
            />
            <label
              class="thinking-control"
              :style="{
                '--thinking-select-width': thinkingSelectWidth,
              }"
            >
              <span class="sr-only">Thinking level</span>
              <select
                class="thinking-select"
                :value="selectedThinkingLevel"
                :disabled="isDisabled"
                @change="handleThinkingLevelChange"
              >
                <option
                  v-for="option in THINKING_LEVEL_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>
          <div class="composer-action-cluster">
            <span v-if="attachmentSummary" class="attachment-summary">
              {{ attachmentSummary }}
            </span>
            <button
              class="send-btn"
              :class="{ stop: showStopButton }"
              :disabled="showStopButton ? !canAbort : !canSubmit"
              :aria-label="showStopButton ? 'Stop response' : 'Send message'"
              @click="handlePrimaryAction"
            >
              <Square v-if="showStopButton" class="send-icon stop-icon" aria-hidden="true" />
              <CornerDownLeft v-else class="send-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-bar {
  flex-shrink: 0;
  padding: 6px 24px 12px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  background: linear-gradient(to top, var(--bg), var(--composer-fade));
}

.composer-inner-wrap {
  position: relative;
  width: min(960px, 100%);
  margin: 0 auto;
}

.composer-dock {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px;
  border-radius: 18px;
  border: 1px solid var(--border);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-elevated) 92%, transparent),
    var(--panel)
  );
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.12);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.composer-dock:focus-within {
  border-color: var(--border-strong);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel) 94%, transparent),
    var(--panel-2)
  );
  box-shadow: 0 26px 56px rgba(0, 0, 0, 0.16);
}

.composer-dock.drag-active {
  border-color: color-mix(in srgb, var(--border-strong) 82%, white);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel-2) 92%, transparent),
    var(--panel)
  );
}

.composer-dock.disabled {
  opacity: 0.74;
}

.hidden-file-input {
  display: none;
}

.attachment-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 2px 0;
  scrollbar-width: thin;
}

.attachment-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel-2) 68%, transparent);
}

.attachment-chip-preview {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  object-fit: cover;
  background: var(--panel);
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
}

.attachment-chip-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.attachment-chip-name,
.attachment-chip-meta,
.attachment-summary {
  font-family: "SF Mono", "Monaco", "Menlo", monospace;
}

.attachment-chip-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.72rem;
  color: var(--text);
}

.attachment-chip-meta,
.attachment-summary {
  font-size: 0.64rem;
  color: var(--text-subtle);
}

.attachment-chip-remove,
.attach-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--button-bg) 88%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.attachment-chip-remove {
  width: 24px;
  height: 24px;
  border-radius: 999px;
}

.attachment-chip-remove:hover,
.attach-btn:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--button-hover);
  color: var(--text);
}

.attachment-chip-remove-icon,
.attach-icon {
  width: 14px;
  height: 14px;
}

.composer-main-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.attach-btn {
  width: 32px;
  height: 32px;
  border-radius: 12px;
  margin-top: 6px;
}

.attach-btn.active {
  color: var(--text);
  border-color: var(--border-strong);
}

.prompt-input {
  flex: 1;
  min-width: 0;
  max-height: 160px;
  padding: 10px 6px 8px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 0.94rem;
  line-height: 1.5;
  outline: none;
  resize: none;
  overflow-y: hidden;
  scrollbar-gutter: stable;
}

.prompt-input:disabled,
.attach-btn:disabled {
  cursor: not-allowed;
}

.prompt-input::placeholder {
  color: var(--text-subtle);
}

.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--text);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease,
    transform 0.15s ease;
}

.send-btn:hover:not(:disabled) {
  background: var(--button-hover);
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.send-btn.stop {
  border-color: color-mix(in srgb, var(--error-border) 92%, var(--border));
  background: color-mix(in srgb, var(--error-bg) 82%, var(--button-bg));
  color: var(--error-text);
}

.send-btn.stop:hover:not(:disabled) {
  background: color-mix(in srgb, var(--error-bg) 92%, var(--button-hover));
  border-color: color-mix(in srgb, var(--error-border) 100%, var(--border-strong));
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-icon {
  width: 15px;
  height: 15px;
}

.stop-icon {
  width: 13px;
  height: 13px;
}

.composer-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  min-width: 0;
}

.composer-status-cluster,
.composer-action-cluster {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.composer-action-cluster {
  justify-content: flex-end;
}

.thinking-control {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.thinking-control::before {
  content: "Thinking";
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  font-family: "SF Mono", "Monaco", "Menlo", monospace;
  font-size: 0.62rem;
  color: var(--text-subtle);
  pointer-events: none;
}

.thinking-select {
  width: var(--thinking-select-width, auto);
  height: 26px;
  padding: 0 20px 0 68px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  background: color-mix(in srgb, var(--panel) 70%, transparent);
  color: var(--text);
  font-family: "SF Mono", "Monaco", "Menlo", monospace;
  font-size: 0.66rem;
  outline: none;
  cursor: pointer;
  appearance: none;
}

.thinking-select:hover:not(:disabled),
.thinking-select:focus {
  border-color: var(--border-strong);
  background: var(--panel-2);
}

.thinking-select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .composer-bar {
    position: sticky;
    bottom: 0;
    z-index: 10;
    padding: 12px 16px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }

  .composer-inner-wrap {
    width: 100%;
  }

  .prompt-input {
    font-size: 16px;
  }

  .composer-footer-row {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .composer-status-cluster,
  .composer-action-cluster {
    width: 100%;
  }

  .composer-action-cluster {
    justify-content: space-between;
  }

  .thinking-select {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .composer-dock {
    gap: 8px;
    padding: 10px;
  }

  .attachment-chip {
    min-width: 220px;
  }

  .composer-main-row {
    gap: 8px;
  }

  .attach-btn {
    width: 30px;
    height: 30px;
  }

  .composer-footer-row {
    gap: 10px;
    padding-top: 8px;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
