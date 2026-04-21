<script setup lang="ts">
import { CornerDownLeft, ImagePlus, Square, X } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { ConnectionStatus } from "../composables/useBridgeClient";
import type {
  RpcImageContent,
  RpcSlashCommand,
  RpcThinkingLevel,
  RpcWorkspaceEntry,
} from "../shared-types";
import {
  COMPOSER_ATTACHMENT_ACCEPT,
  createComposerAttachments,
  extractSupportedImageFiles,
  formatAttachmentSize,
  toRpcImageContent,
  type ComposerAttachment,
} from "../utils/attachments";
import type { RpcModelInfo } from "../utils/models";
import {
  applySlashCommandCompletion,
  getSlashCommandContext,
  mergeSlashCommandOptions,
  parseCompactSlashCommand,
} from "../utils/slashCommands";
import { getNextThinkingLevel } from "../utils/thinkingLevels";
import {
  applyWorkspaceMentionCompletion,
  getWorkspaceMentionContext,
  getWorkspaceMentionSuggestions,
  type WorkspaceMentionSuggestion,
} from "../utils/workspaceMentions";
import CommandPalette from "./CommandPalette.vue";
import ModelDropdown from "./ModelDropdown.vue";
import ThinkingLevelDropdown from "./ThinkingLevelDropdown.vue";
import WorkspaceMentionPalette from "./WorkspaceMentionPalette.vue";

const props = defineProps<{
  connectionStatus: ConnectionStatus;
  isStreaming: boolean;
  commands: RpcSlashCommand[];
  workspaceEntries: RpcWorkspaceEntry[];
  workspaceEntriesLoading: boolean;
  ensureWorkspaceEntries: () => Promise<RpcWorkspaceEntry[]>;
  models: RpcModelInfo[];
  selectedModel: RpcModelInfo | null;
  thinkingLevel: RpcThinkingLevel | null;
  autoCompactionEnabled: boolean;
  prefillText: string | null;
  revision: {
    entryId: string;
    text: string;
    preview: string;
    hasImages: boolean;
  } | null;
  pendingMessageCount: number;
  editQueuedPayload: { text: string; images: RpcImageContent[] } | null;
}>();

const emit = defineEmits<{
  submit: [
    payload: {
      message: string;
      images: RpcImageContent[];
      revisionEntryId?: string;
      steer?: boolean;
    },
  ];
  abort: [];
  cancelRevision: [];
  selectModel: [model: RpcModelInfo];
  selectThinkingLevel: [level: RpcThinkingLevel];
  toggleAutoCompaction: [enabled: boolean];
}>();

const MAX_TEXTAREA_HEIGHT = 160;
const TEXTAREA_HEIGHT_BUFFER = 4;

const inputText = ref("");
const composerRootRef = ref<HTMLDivElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const isDisabled = computed(() => props.connectionStatus !== "connected");
const commandPaletteRef = ref<InstanceType<typeof CommandPalette> | null>(null);
const mentionPaletteRef = ref<InstanceType<
  typeof WorkspaceMentionPalette
> | null>(null);
const attachments = ref<ComposerAttachment[]>([]);
const isDragActive = ref(false);
const attachmentNotice = ref<string | null>(null);
const cursorOffset = ref(0);
const dismissedCommandKey = ref<string | null>(null);
const dismissedMentionKey = ref<string | null>(null);
const isComposing = ref(false);

const commandContext = computed(() =>
  getSlashCommandContext(inputText.value, cursorOffset.value),
);
const availableSlashCommands = computed(() =>
  // Temporarily keep the web slash-command palette limited to /compact.
  mergeSlashCommandOptions([]),
);
const filteredSlashCommands = computed(() => {
  if (!commandContext.value) return [];
  const query = commandContext.value.query.toLowerCase();
  if (!query) return availableSlashCommands.value;
  return availableSlashCommands.value.filter(
    command =>
      command.name.toLowerCase().includes(query) ||
      (command.description ?? "").toLowerCase().includes(query),
  );
});
const mentionContext = computed(() =>
  getWorkspaceMentionContext(inputText.value, cursorOffset.value),
);
const mentionSuggestions = computed(() => {
  if (!mentionContext.value) return [];
  return getWorkspaceMentionSuggestions(
    props.workspaceEntries,
    mentionContext.value,
  );
});
const showCommandPalette = computed(() => {
  if (isDisabled.value || !commandContext.value) return false;
  return dismissedCommandKey.value !== getCommandKey(commandContext.value);
});
const showMentionPalette = computed(() => {
  if (showCommandPalette.value || !mentionContext.value) return false;
  if (dismissedMentionKey.value === getMentionKey(mentionContext.value)) {
    return false;
  }
  if (props.workspaceEntriesLoading) return true;
  return true;
});
const currentModelText = computed(() => {
  if (!props.selectedModel)
    return props.models.length > 0 ? "choose model" : "no models";
  return `${props.selectedModel.provider}/${props.selectedModel.id}`;
});
const normalizedInputText = computed(() =>
  normalizeSubmittedText(inputText.value),
);
const hasAttachments = computed(() => attachments.value.length > 0);
const canSubmit = computed(
  () =>
    !isDisabled.value &&
    (normalizedInputText.value.length > 0 || hasAttachments.value),
);
const canAbort = computed(() => !isDisabled.value && props.isStreaming);
const showStopButton = computed(() => props.isStreaming && !canSubmit.value);
const hasPendingMessages = computed(() => props.pendingMessageCount > 0);
const attachmentSummary = computed(() => {
  if (attachmentNotice.value) return attachmentNotice.value;
  if (!attachments.value.length) return "";
  if (attachments.value.length === 1) return "1 image attached";
  return `${attachments.value.length} images attached`;
});

const revisionBackup = ref<{
  text: string;
  attachments: ComposerAttachment[];
} | null>(null);

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

function getCommandKey(
  command: ReturnType<typeof getSlashCommandContext> | null,
): string | null {
  if (!command) return null;
  return `${command.start}:${command.query}`;
}

function getMentionKey(
  mention: ReturnType<typeof getWorkspaceMentionContext> | null,
): string | null {
  if (!mention) return null;
  return `${mention.start}:${mention.prefix}`;
}

function syncCursorFromTextarea() {
  const el = textareaRef.value;
  cursorOffset.value = el?.selectionStart ?? inputText.value.length;
}

function resizeTextarea() {
  nextTick(() => {
    const el = textareaRef.value;
    if (!el) return;
    el.style.height = "auto";

    const styles = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 0;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const minHeight = Math.ceil(
      lineHeight + paddingTop + paddingBottom + TEXTAREA_HEIGHT_BUFFER,
    );
    const nextHeight = Math.min(
      Math.max(el.scrollHeight + TEXTAREA_HEIGHT_BUFFER, minHeight),
      MAX_TEXTAREA_HEIGHT,
    );

    // Keep a small safety margin so descenders like "g" do not get clipped.
    el.style.height = `${nextHeight}px`;
    el.style.overflowY =
      el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  });
}

function shouldRevealComposer(): boolean {
  if (typeof window === "undefined") return false;
  const el = composerRootRef.value;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const viewportHeight = window.innerHeight || 0;
  const margin = 24;
  return rect.top < margin || rect.bottom > viewportHeight - margin;
}

function focusComposer(options?: { reveal?: boolean }) {
  nextTick(() => {
    if (options?.reveal && shouldRevealComposer()) {
      composerRootRef.value?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }

    const el = textareaRef.value;
    if (!el) return;
    el.focus();
    const cursor = inputText.value.length;
    el.setSelectionRange(cursor, cursor);
    cursorOffset.value = cursor;
    resizeTextarea();
  });
}

function applyExternalText(
  text: string,
  options?: { clearAttachments?: boolean },
) {
  inputText.value = text;
  if (options?.clearAttachments) {
    clearAttachments();
  }
  clearAttachmentNotice();
  dismissedCommandKey.value = null;
  dismissedMentionKey.value = null;
  focusComposer({ reveal: true });
}

watch(inputText, () => {
  resizeTextarea();
  nextTick(() => {
    syncCursorFromTextarea();
  });
});

watch(commandContext, (command, previousCommand) => {
  const commandKey = getCommandKey(command);
  if (commandKey && commandKey !== getCommandKey(previousCommand)) {
    dismissedCommandKey.value = null;
  }
});

watch(mentionContext, (mention, previousMention) => {
  const mentionKey = getMentionKey(mention);
  if (mentionKey && mentionKey !== getMentionKey(previousMention)) {
    dismissedMentionKey.value = null;
  }

  if (mention) {
    void props.ensureWorkspaceEntries();
  }
});

watch(
  () => props.prefillText,
  text => {
    if (typeof text !== "string") return;
    applyExternalText(text);
  },
);

watch(
  () => props.revision,
  (revision, previousRevision) => {
    if (!revision) return;
    if (!previousRevision && !revisionBackup.value) {
      revisionBackup.value = {
        text: inputText.value,
        attachments: [...attachments.value],
      };
    }
    applyExternalText(revision.text, { clearAttachments: true });
  },
);

watch(
  () => props.editQueuedPayload,
  payload => {
    if (!payload) return;
    inputText.value = payload.text;
    attachments.value = [];
    if (fileInputRef.value) {
      fileInputRef.value.value = "";
    }
    clearAttachmentNotice();
    dismissedCommandKey.value = null;
    dismissedMentionKey.value = null;
    revisionBackup.value = null;
    focusComposer({ reveal: true });
  },
);

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
    setAttachmentNotice(
      `Skipped unsupported files: ${rejectedNames.join(", ")}`,
    );
  }
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(
    attachment => attachment.id !== id,
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

function submitMessage(message: string, steer: boolean = false) {
  emit("submit", {
    message,
    images: toRpcImageContent(attachments.value),
    revisionEntryId: props.revision?.entryId,
    steer,
  });
  inputText.value = "";
  cursorOffset.value = 0;
  dismissedCommandKey.value = null;
  dismissedMentionKey.value = null;
  revisionBackup.value = null;
  clearAttachments();
  clearAttachmentNotice();
  resizeTextarea();
}

function handleSubmit(steer: boolean = false) {
  const text = normalizedInputText.value;
  if ((!text && !hasAttachments.value) || isDisabled.value) return;

  if (parseCompactSlashCommand(text) && hasAttachments.value) {
    setAttachmentNotice("/compact does not accept image attachments");
    return;
  }

  submitMessage(text, steer);
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
  const command = availableSlashCommands.value.find(
    item => item.name === commandName,
  );
  const context = commandContext.value;
  if (!command || !context) return;

  const nextState = applySlashCommandCompletion(
    inputText.value,
    context,
    command,
  );

  inputText.value = nextState.text;
  dismissedCommandKey.value = null;
  nextTick(() => {
    const el = textareaRef.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(nextState.cursor, nextState.cursor);
    cursorOffset.value = nextState.cursor;
    resizeTextarea();
  });
}

function handleCommandClose() {
  dismissedCommandKey.value = getCommandKey(commandContext.value);
}

function handleMentionSelect(item: WorkspaceMentionSuggestion) {
  const mention = mentionContext.value;
  if (!mention) return;

  const nextState = applyWorkspaceMentionCompletion(
    inputText.value,
    cursorOffset.value,
    mention,
    item,
  );

  inputText.value = nextState.text;
  dismissedMentionKey.value = null;
  nextTick(() => {
    const el = textareaRef.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(nextState.cursor, nextState.cursor);
    cursorOffset.value = nextState.cursor;
    resizeTextarea();
  });
}

function handleMentionClose() {
  dismissedMentionKey.value = getMentionKey(mentionContext.value);
}

function handleModelSelect(model: RpcModelInfo) {
  emit("selectModel", model);
}

function handleThinkingLevelSelect(level: RpcThinkingLevel) {
  emit("selectThinkingLevel", level);
}

function handleCycleThinkingLevel() {
  if (isDisabled.value) return;
  handleThinkingLevelSelect(getNextThinkingLevel(props.thinkingLevel));
}

function handleAutoCompactionChange(event: Event) {
  emit(
    "toggleAutoCompaction",
    Boolean((event.target as HTMLInputElement | null)?.checked),
  );
}

function handleCancelRevision() {
  const backup = revisionBackup.value;
  inputText.value = backup?.text ?? "";
  attachments.value = backup ? [...backup.attachments] : [];
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
  revisionBackup.value = null;
  clearAttachmentNotice();
  dismissedCommandKey.value = null;
  dismissedMentionKey.value = null;
  emit("cancelRevision");
  focusComposer();
}

function handleFilePickerOpen() {
  fileInputRef.value?.click();
}

function handleInputInteraction() {
  syncCursorFromTextarea();
  resizeTextarea();
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
    .filter(item => item.kind === "file")
    .map(item => item.getAsFile())
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

function isInputComposing(event: KeyboardEvent): boolean {
  return event.isComposing || isComposing.value || event.keyCode === 229;
}

function handleInputCompositionStart() {
  isComposing.value = true;
}

function handleInputCompositionEnd() {
  isComposing.value = false;
  handleInputInteraction();
}

function handleInputKeydown(e: KeyboardEvent) {
  const composing = isInputComposing(e);

  if (
    e.key === "Tab" &&
    e.shiftKey &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !composing
  ) {
    e.preventDefault();
    handleCycleThinkingLevel();
    return;
  }

  if (
    showCommandPalette.value &&
    commandPaletteRef.value &&
    (e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Escape" ||
      (filteredSlashCommands.value.length > 0 &&
        !composing &&
        (e.key === "Enter" || e.key === "Tab")))
  ) {
    commandPaletteRef.value.handleKeydown(e);
    return;
  }

  if (
    showMentionPalette.value &&
    mentionPaletteRef.value &&
    (e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Escape" ||
      ((props.workspaceEntriesLoading || mentionSuggestions.value.length > 0) &&
        !composing &&
        (e.key === "Enter" || e.key === "Tab")))
  ) {
    mentionPaletteRef.value.handleKeydown(e);
    return;
  }

  if (e.key === "Escape" && props.isStreaming) {
    e.preventDefault();
    handleAbort();
    return;
  }

  if (e.key === "Enter") {
    if (composing) return;
    e.preventDefault();
    handleSubmit(e.shiftKey);
  }
}

onBeforeUnmount(() => {
  clearAttachmentNotice();
});

resizeTextarea();
</script>

<template>
  <div ref="composerRootRef" class="composer-bar">
    <div class="composer-inner-wrap">
      <CommandPalette
        v-if="showCommandPalette"
        ref="commandPaletteRef"
        :commands="availableSlashCommands"
        :filter="commandContext?.query ?? ''"
        @select="handleCommandSelect"
        @close="handleCommandClose"
      />
      <WorkspaceMentionPalette
        v-else-if="showMentionPalette"
        ref="mentionPaletteRef"
        :items="mentionSuggestions"
        :loading="workspaceEntriesLoading"
        @select="handleMentionSelect"
        @close="handleMentionClose"
      />
      <div
        class="composer-dock"
        :class="{ disabled: isDisabled, 'drag-active': isDragActive }"
        @dragenter.prevent="handleDragEnter"
        @dragover.prevent="handleDragOver"
        @dragleave.prevent="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <div v-if="revision" class="revision-banner">
          <div class="revision-banner-copy">
            <span class="revision-kicker">Revising earlier message</span>
            <p class="revision-preview">{{ revision.preview }}</p>
            <p v-if="revision.hasImages" class="revision-note">
              Only the text was copied. Re-attach images if you still need them.
            </p>
          </div>
          <button
            type="button"
            class="revision-cancel-button"
            @click="handleCancelRevision"
          >
            Cancel
          </button>
        </div>

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
            @input="handleInputInteraction"
            @keyup="handleInputInteraction"
            @click="handleInputInteraction"
            @compositionstart="handleInputCompositionStart"
            @compositionend="handleInputCompositionEnd"
            @select="handleInputInteraction"
            @focus="handleInputInteraction"
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
            <ThinkingLevelDropdown
              :value="thinkingLevel"
              :disabled="isDisabled"
              @select="handleThinkingLevelSelect"
            />
            <label class="toggle-chip" :class="{ disabled: isDisabled }">
              <input
                class="toggle-chip-input"
                type="checkbox"
                :checked="autoCompactionEnabled"
                :disabled="isDisabled"
                @change="handleAutoCompactionChange"
              />
              <span class="toggle-chip-label">Auto compact</span>
            </label>
          </div>
          <div class="composer-action-cluster">
            <span v-if="attachmentSummary" class="attachment-summary">
              {{ attachmentSummary }}
            </span>
            <div
              v-if="hasPendingMessages"
              class="pending-queue-indicator"
              :title="`${pendingMessageCount} message${pendingMessageCount > 1 ? 's' : ''} queued`"
            >
              <span class="pending-pulse"></span>
              <span class="pending-label">{{ pendingMessageCount }}</span>
            </div>
            <button
              class="send-btn"
              :class="{ stop: showStopButton }"
              :disabled="showStopButton ? !canAbort : !canSubmit"
              :aria-label="showStopButton ? 'Stop response' : 'Send message'"
              @click="handlePrimaryAction"
            >
              <Square
                v-if="showStopButton"
                class="send-icon stop-icon"
                aria-hidden="true"
              />
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

.revision-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 82%, transparent);
  background: color-mix(in srgb, var(--panel-2) 88%, transparent);
}

.revision-banner-copy {
  min-width: 0;
}

.revision-kicker {
  display: inline-flex;
  align-items: center;
  margin: 0 0 4px;
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.revision-preview,
.revision-note {
  margin: 0;
}

.revision-preview {
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--text);
}

.revision-note {
  margin-top: 4px;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--text-subtle);
}

.revision-cancel-button {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  color: var(--text-muted);
  font-size: 0.7rem;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    color 0.12s ease,
    background 0.12s ease;
}

.revision-cancel-button:hover {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--panel-2) 92%, transparent);
  color: var(--text);
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
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 74%, transparent);
}

.attachment-chip-preview {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  object-fit: cover;
  background: var(--panel);
  border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
}

.attachment-chip-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.attachment-chip-name,
.attachment-chip-meta {
  font-family: var(--pi-font-mono);
}

.attachment-summary {
  font-family: var(--pi-font-sans);
}

.pending-queue-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 60%, transparent);
  background: color-mix(in srgb, var(--panel-2) 80%, transparent);
  color: var(--text-subtle);
  font-size: 0.68rem;
  user-select: none;
}

.pending-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f59e0b;
  animation: pending-pulse 1.4s ease-in-out infinite;
}

.pending-label {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

@keyframes pending-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.85);
  }
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

.attachment-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  background: transparent;
  color: var(--text-subtle);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.attach-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin-top: 6px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  background: color-mix(in srgb, var(--panel) 72%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
}

.attachment-chip-remove:hover,
.attach-btn:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--panel-2);
  color: var(--text);
}

.attachment-chip-remove:focus-visible,
.attach-btn:focus-visible {
  outline: none;
  border-color: var(--border-strong);
  background: var(--panel-2);
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

.attach-btn.active {
  color: var(--text);
  border-color: color-mix(in srgb, var(--border-strong) 88%, transparent);
  background: color-mix(in srgb, var(--panel-2) 86%, transparent);
}

.prompt-input {
  display: block;
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  max-height: 160px;
  padding: 9px 6px 10px;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: var(--pi-font-sans);
  font-size: 0.94rem;
  font-weight: 400;
  line-height: 1.55;
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
  line-height: inherit;
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
  border-color: color-mix(
    in srgb,
    var(--error-border) 100%,
    var(--border-strong)
  );
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

.toggle-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  background: color-mix(in srgb, var(--panel) 70%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  user-select: none;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.toggle-chip:hover:not(.disabled),
.toggle-chip:focus-within {
  border-color: var(--border-strong);
  background: var(--panel-2);
  color: var(--text);
}

.toggle-chip.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toggle-chip-input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--text);
}

.toggle-chip-input:disabled {
  cursor: not-allowed;
}

.toggle-chip-label {
  font-family: var(--pi-font-sans);
  font-size: 0.66rem;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .composer-bar {
    position: sticky;
    bottom: 0;
    z-index: 10;
    padding: 10px 16px 12px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }

  .composer-inner-wrap {
    width: 100%;
  }

  .prompt-input {
    font-size: 16px;
  }

  .composer-footer-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }

  .composer-status-cluster {
    min-width: 0;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }

  .composer-status-cluster::-webkit-scrollbar {
    display: none;
  }

  .composer-action-cluster {
    flex-shrink: 0;
    justify-content: flex-end;
  }

  .attachment-summary {
    display: none;
  }
}

@media (max-width: 640px) {
  .composer-bar {
    padding: 8px 12px 10px;
    padding-bottom: max(10px, env(safe-area-inset-bottom));
  }

  .revision-banner {
    flex-direction: column;
  }

  .revision-cancel-button {
    align-self: flex-start;
  }

  .composer-dock {
    gap: 8px;
    padding: 8px 10px;
    border-radius: 16px;
  }

  .attachment-chip {
    min-width: 200px;
  }

  .composer-main-row {
    gap: 8px;
    align-items: flex-end;
  }

  .attach-btn {
    width: 30px;
    height: 30px;
    margin-top: 0;
    border-radius: 10px;
  }

  .prompt-input {
    padding: 5px 0 6px;
    line-height: 1.5;
  }

  .composer-footer-row {
    gap: 8px;
    padding-top: 8px;
  }

  .send-btn {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }
}
</style>
