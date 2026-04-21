<script setup lang="ts">
import { Pencil, Sparkle } from "lucide-vue-next";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { TranscriptEntry } from "../composables/useBridgeClient";
import { userMessageCopyText } from "../utils/messageCopy";
import {
  buildTranscriptDisplayItems,
  contentBlocks,
  errorMessageText,
  isAbortedMessage,
  isErrorMessage,
  isToolResultMessage,
  messageContent,
  type ImageContentBlock,
  type PendingTranscriptSessionEvent,
  type TranscriptDisplayItem,
  type TranscriptSessionEventDisplayItem,
} from "../utils/transcript";
import ImageLightbox from "./ImageLightbox.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import ToolCard from "./ToolCard.vue";

const props = defineProps<{
  messages: readonly TranscriptEntry[];
  hasOlder: boolean;
  initialLoading: boolean;
  pageLoading: boolean;
  pendingTranscriptConfigEvent: PendingTranscriptSessionEvent | null;
  isStreaming: boolean;
  isCompacting: boolean;
  showMessageIds: boolean;
  allowRevision: boolean;
}>();

const emit = defineEmits<{
  loadOlder: [];
  revise: [
    payload: {
      entryId: string;
      text: string;
      preview: string;
      hasImages: boolean;
    },
  ];
}>();

const container = ref<HTMLDivElement | null>(null);
const userCopySelector = "[data-user-message-index]";

let wasDisconnected = false;
let savedScrollTop = 0;
let savedScrollHeight = 0;
let topLoadArmed = true;
let pendingHistoryAnchor: { scrollTop: number; scrollHeight: number } | null =
  null;
const TREE_ENTRY_SELECTOR = "[data-tree-entry-id], [data-tree-entry-ids]";

const TOP_LOAD_THRESHOLD = 120;

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

function scrollToMessageId(messageId: string): boolean {
  const root = container.value;
  if (!root || !messageId) return false;

  const target = [
    ...root.querySelectorAll<HTMLElement>(TREE_ENTRY_SELECTOR),
  ].find(element => {
    if (element.dataset.treeEntryId === messageId) {
      return true;
    }

    return (
      element.dataset.treeEntryIds
        ?.split(/\s+/)
        .filter(Boolean)
        .includes(messageId) ?? false
    );
  });
  if (!target) return false;

  target.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

function roleClass(role: string): "user" | "assistant" | "tool" | "system" {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "system") return "system";
  return "tool";
}

function roleLabel(role: string): string {
  if (role === "toolResult") return "Tool Result";
  if (role === "tool") return "Tool";
  if (role === "system") return "System";
  return role;
}

const expandedToolBlocks = ref(new Set<string>());
const expandedThinking = ref(new Set<string>());
const displayItems = computed(() =>
  buildTranscriptDisplayItems(props.messages, {
    pendingSessionEvent: props.pendingTranscriptConfigEvent,
  }),
);
const showBusyIndicator = computed(
  () => props.isStreaming || props.isCompacting,
);
const busyIndicatorLabel = computed(() =>
  props.isCompacting && !props.isStreaming
    ? "Compacting context"
    : "Assistant is responding",
);
const lightboxImages = ref<ImageContentBlock[]>([]);
const lightboxIndex = ref(0);

function messageStableKey(msg: TranscriptEntry, index: number): string {
  return msg.transcriptKey ?? msg.id ?? `message:${index}`;
}

function displayItemKey(item: TranscriptDisplayItem, index: number): string {
  return item.kind === "message"
    ? messageStableKey(item.message, item.messageIndex)
    : item.key || `session-event:${index}`;
}

function sessionEventModelText(
  item: TranscriptSessionEventDisplayItem,
): string {
  if (!item.model) return "";
  return item.model.provider
    ? `${item.model.provider} / ${item.model.id}`
    : item.model.id;
}

function toolBlockKey(messageKey: string, blockIdx: number): string {
  return `${messageKey}-${blockIdx}`;
}

function toggleToolBlock(messageKey: string, blockIdx: number) {
  const key = toolBlockKey(messageKey, blockIdx);
  const next = new Set(expandedToolBlocks.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedToolBlocks.value = next;
}

function toggleThinking(messageKey: string, blockIdx: number) {
  const key = toolBlockKey(messageKey, blockIdx);
  const next = new Set(expandedThinking.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedThinking.value = next;
}

function isToolBlockExpanded(messageKey: string, blockIdx: number): boolean {
  return expandedToolBlocks.value.has(toolBlockKey(messageKey, blockIdx));
}

function isThinkingExpanded(messageKey: string, blockIdx: number): boolean {
  return expandedThinking.value.has(toolBlockKey(messageKey, blockIdx));
}

function previewText(text: string, maxLines: number = 8): string {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return "";
  const lines = normalized.split("\n");
  if (lines.length <= maxLines) return normalized;
  const remaining = lines.length - maxLines;
  return `${lines.slice(0, maxLines).join("\n")}\n... ${remaining} more line${remaining === 1 ? "" : "s"}`;
}

function toolResultText(msg: TranscriptEntry): string {
  return contentBlocks(msg)
    .flatMap(block => (block.kind === "text" ? [block.text] : []))
    .join("\n");
}

function toolResultPreview(msg: TranscriptEntry): string {
  return previewText(toolResultText(msg), 6);
}

function toolResultCanExpand(msg: TranscriptEntry): boolean {
  const text = toolResultText(msg).replace(/\r/g, "").trim();
  return Boolean(text) && toolResultPreview(msg) !== text;
}

function toolResultImages(msg: TranscriptEntry): ImageContentBlock[] {
  return contentBlocks(msg).filter(
    (block): block is ImageContentBlock => block.kind === "image",
  );
}

function openImageLightbox(
  images: readonly ImageContentBlock[],
  index: number = 0,
) {
  if (images.length === 0) return;
  lightboxImages.value = [...images];
  lightboxIndex.value = Math.min(Math.max(index, 0), images.length - 1);
}

function closeImageLightbox() {
  lightboxImages.value = [];
  lightboxIndex.value = 0;
}

function showPreviousLightboxImage() {
  if (lightboxImages.value.length <= 1) return;
  lightboxIndex.value =
    (lightboxIndex.value + lightboxImages.value.length - 1) %
    lightboxImages.value.length;
}

function showNextLightboxImage() {
  if (lightboxImages.value.length <= 1) return;
  lightboxIndex.value = (lightboxIndex.value + 1) % lightboxImages.value.length;
}

function messageIdLabel(msg: TranscriptEntry): string {
  return msg.id ?? "missing";
}

function userMessageText(msg: TranscriptEntry): string {
  return messageContent(msg).trim();
}

function hasMessageImages(msg: TranscriptEntry): boolean {
  return contentBlocks(msg).some(block => block.kind === "image");
}

function revisionPreview(text: string, maxLength: number = 96): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

function canReviseMessage(msg: TranscriptEntry): msg is TranscriptEntry & {
  id: string;
} {
  return Boolean(
    props.allowRevision &&
    !showBusyIndicator.value &&
    msg.role === "user" &&
    typeof msg.id === "string" &&
    userMessageText(msg),
  );
}

function handleRevise(msg: TranscriptEntry) {
  if (!canReviseMessage(msg)) return;
  const text = userMessageText(msg);
  emit("revise", {
    entryId: msg.id,
    text,
    preview: revisionPreview(text),
    hasImages: hasMessageImages(msg),
  });
}

function userMessageElementForNode(node: Node | null): HTMLElement | null {
  const root = container.value;
  if (!root || !node) return null;

  const element = node instanceof Element ? node : node.parentElement;
  const candidate = element?.closest<HTMLElement>(userCopySelector) ?? null;
  if (!candidate || !root.contains(candidate)) return null;
  return candidate;
}

function selectedUserMessageElements(selection: Selection): HTMLElement[] {
  const root = container.value;
  if (!root || selection.rangeCount === 0 || selection.isCollapsed) return [];

  const elements = new Set<HTMLElement>();
  const userElements = root.querySelectorAll<HTMLElement>(userCopySelector);

  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index);
    if (!range.intersectsNode(root)) continue;

    for (const element of userElements) {
      if (range.intersectsNode(element)) elements.add(element);
    }

    const startElement = userMessageElementForNode(range.startContainer);
    const endElement = userMessageElementForNode(range.endContainer);
    if (startElement) elements.add(startElement);
    if (endElement) elements.add(endElement);
  }

  return [...elements];
}

function selectedUserCopyText(selection: Selection | null): string | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const [element, extraElement] = selectedUserMessageElements(selection);
  if (!element || extraElement) return null;

  const messageIndex = Number(element.dataset.userMessageIndex);
  const msg = Number.isInteger(messageIndex)
    ? props.messages[messageIndex]
    : undefined;
  if (!msg) return null;

  return userMessageCopyText(msg, selection.toString(), element.innerText);
}

function handleCopy(event: ClipboardEvent) {
  const text = selectedUserCopyText(window.getSelection());
  if (!text || !event.clipboardData) return;

  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
}

function requestOlderTranscript() {
  if (!container.value) return;
  if (!props.hasOlder || props.initialLoading || props.pageLoading) return;
  pendingHistoryAnchor = {
    scrollTop: container.value.scrollTop,
    scrollHeight: container.value.scrollHeight,
  };
  emit("loadOlder");
}

function maybeLoadOlderTranscript() {
  if (!container.value) return;
  if (!props.hasOlder || props.initialLoading || props.pageLoading) return;

  if (container.value.scrollTop > TOP_LOAD_THRESHOLD) {
    topLoadArmed = true;
    return;
  }

  if (!topLoadArmed) return;
  topLoadArmed = false;
  requestOlderTranscript();
}

function handleScroll() {
  maybeLoadOlderTranscript();
}

onMounted(() => {
  document.addEventListener("copy", handleCopy);
  container.value?.addEventListener("scroll", handleScroll, { passive: true });
});
onBeforeUnmount(() => {
  document.removeEventListener("copy", handleCopy);
  container.value?.removeEventListener("scroll", handleScroll);
});

watch(
  () => props.messages.length,
  async () => {
    await nextTick();

    if (pendingHistoryAnchor && container.value) {
      const delta =
        container.value.scrollHeight - pendingHistoryAnchor.scrollHeight;
      container.value.scrollTop = pendingHistoryAnchor.scrollTop + delta;
      pendingHistoryAnchor = null;
      return;
    }

    if (!wasDisconnected) {
      if (container.value) {
        container.value.scrollTop = container.value.scrollHeight;
      }
      return;
    }

    restoreScroll();
  },
);

watch(
  () => showBusyIndicator.value,
  async busy => {
    if (busy) {
      await nextTick();
      if (container.value) {
        container.value.scrollTop = container.value.scrollHeight;
      }
    }
  },
);

watch(
  () => [props.hasOlder, props.initialLoading, props.pageLoading] as const,
  ([hasOlder, initialLoading, pageLoading]) => {
    if (!hasOlder || initialLoading || pageLoading) return;
    if (!container.value) return;
    if (container.value.scrollTop > TOP_LOAD_THRESHOLD) {
      topLoadArmed = true;
    }
  },
);

defineExpose({ preserveScroll, scrollToMessageId });
</script>

<template>
  <div ref="container" class="chat-transcript">
    <div v-if="initialLoading" class="empty-state loading-state">
      <p class="empty-title">Loading conversation</p>
      <p class="empty-subtitle">Fetching the latest transcript window.</p>
    </div>
    <div v-else-if="messages.length === 0" class="empty-state">
      <p class="empty-title">Start a conversation</p>
      <p class="empty-subtitle">Start typing to keep the session moving.</p>
      <div class="empty-hints">
        <span class="hint-chip">Enter send</span>
        <span class="hint-chip">Drop or paste images</span>
      </div>
    </div>
    <div v-if="!initialLoading && hasOlder" class="history-loader">
      <button
        type="button"
        class="history-loader-button"
        :disabled="pageLoading"
        @click="requestOlderTranscript()"
      >
        {{
          pageLoading ? "Loading earlier messages..." : "Load earlier messages"
        }}
      </button>
    </div>

    <template
      v-for="(item, index) in displayItems"
      :key="displayItemKey(item, index)"
    >
      <div
        v-if="item.kind === 'session_event'"
        class="session-event-row"
        :data-tree-entry-ids="item.sourceMessageIds.join(' ') || undefined"
      >
        <div class="session-event-line" aria-hidden="true"></div>
        <div class="session-event-body">
          <span class="session-event-label">{{ item.label }}</span>
          <span v-if="item.model" class="session-event-chip">
            <span class="session-event-chip-label">Model</span>
            <span class="session-event-chip-value">{{
              sessionEventModelText(item)
            }}</span>
          </span>
          <span v-if="item.thinkingLevel" class="session-event-chip">
            <span class="session-event-chip-label">Thinking</span>
            <span class="session-event-chip-value">{{
              item.thinkingLevel
            }}</span>
          </span>
          <span
            v-if="showMessageIds && item.sourceMessageIds.length > 0"
            class="session-event-debug"
          >
            IDs {{ item.sourceMessageIds.join(", ") }}
          </span>
        </div>
        <div class="session-event-line" aria-hidden="true"></div>
      </div>

      <template v-else>
        <div
          v-if="isToolResultMessage(item.message)"
          class="message-row tool"
          :data-message-id="item.message.id ?? undefined"
          :data-tree-entry-id="item.message.id ?? undefined"
        >
          <div class="message-meta">
            <span class="message-role">{{ roleLabel(item.message.role) }}</span>
          </div>
          <div class="message-content tool-row">
            <div class="tool-result-card">
              <div class="tool-result-card-header">
                <div class="tool-result-card-heading">
                  <span class="tool-result-card-label">{{
                    roleLabel(item.message.role)
                  }}</span>
                  <span v-if="showMessageIds" class="message-debug-id">
                    ID {{ messageIdLabel(item.message) }}
                  </span>
                </div>
                <button
                  v-if="toolResultCanExpand(item.message)"
                  type="button"
                  class="tool-result-card-toggle"
                  @click="
                    toggleToolBlock(
                      messageStableKey(item.message, item.messageIndex),
                      -1,
                    )
                  "
                  :title="
                    isToolBlockExpanded(
                      messageStableKey(item.message, item.messageIndex),
                      -1,
                    )
                      ? 'Collapse'
                      : 'Expand'
                  "
                >
                  {{
                    isToolBlockExpanded(
                      messageStableKey(item.message, item.messageIndex),
                      -1,
                    )
                      ? "Hide"
                      : "Details"
                  }}
                </button>
              </div>
              <pre
                v-if="toolResultPreview(item.message)"
                class="tool-result-card-preview"
                >{{ toolResultPreview(item.message) }}</pre
              >
              <div
                v-if="toolResultImages(item.message).length > 0"
                class="tool-result-card-images"
              >
                <figure
                  v-for="(image, imageIndex) in toolResultImages(item.message)"
                  :key="`${image.src}-${imageIndex}`"
                  class="message-image-block"
                >
                  <button
                    type="button"
                    class="message-image-button"
                    :aria-label="`Open image ${imageIndex + 1}`"
                    @click="
                      openImageLightbox(
                        toolResultImages(item.message),
                        imageIndex,
                      )
                    "
                  >
                    <img
                      class="message-image"
                      :src="image.src"
                      :alt="image.alt"
                      loading="lazy"
                    />
                  </button>
                </figure>
              </div>
              <pre
                v-if="
                  isToolBlockExpanded(
                    messageStableKey(item.message, item.messageIndex),
                    -1,
                  ) && toolResultText(item.message).trim()
                "
                class="tool-result-card-details"
                >{{ toolResultText(item.message) }}</pre
              >
            </div>
          </div>
        </div>

        <div
          v-else-if="isErrorMessage(item.message)"
          class="message-row"
          :class="roleClass(item.message.role)"
          :data-message-id="item.message.id ?? undefined"
          :data-tree-entry-id="item.message.id ?? undefined"
        >
          <div class="message-content" :class="roleClass(item.message.role)">
            <div class="error-block" :class="{ aborted: isAbortedMessage(item.message) }">
              <div class="error-block-header">
                <div class="error-block-heading">
                  <span class="error-label">{{
                    isAbortedMessage(item.message) ? "Cancelled" : "Error"
                  }}</span>
                  <span v-if="showMessageIds" class="message-debug-id">
                    ID {{ messageIdLabel(item.message) }}
                  </span>
                </div>
              </div>
              <div v-if="errorMessageText(item.message)" class="error-block-body">
                <span class="error-message">{{ errorMessageText(item.message) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else
          class="message-row"
          :class="roleClass(item.message.role)"
          :data-message-id="item.message.id ?? undefined"
          :data-tree-entry-id="item.message.id ?? undefined"
        >
          <div class="message-stack" :class="roleClass(item.message.role)">
            <div
              class="message-content"
              :class="roleClass(item.message.role)"
              :data-user-message-index="
                item.message.role === 'user' ? item.messageIndex : undefined
              "
            >
              <div v-if="showMessageIds" class="message-debug-id">
                ID {{ messageIdLabel(item.message) }}
              </div>
              <template
                v-for="(block, bIdx) in contentBlocks(item.message)"
                :key="bIdx"
              >
                <article
                  v-if="block.kind === 'system'"
                  class="system-block"
                  :data-system-type="block.systemType"
                >
                  <div class="system-block-header">
                    <span class="system-block-label">{{ block.label }}</span>
                    <span v-if="block.meta" class="system-block-meta">{{
                      block.meta
                    }}</span>
                  </div>
                  <div class="system-block-title">{{ block.title }}</div>
                  <MarkdownRenderer
                    v-if="block.body"
                    class="system-block-body"
                    :content="block.body"
                  />
                </article>

                <div
                  v-else-if="block.kind === 'thinking'"
                  class="thinking-block"
                >
                  <button
                    class="thinking-toggle"
                    @click="
                      toggleThinking(
                        messageStableKey(item.message, item.messageIndex),
                        bIdx,
                      )
                    "
                  >
                    <Sparkle class="toggle-icon" aria-hidden="true" />
                    Thinking
                  </button>
                  <MarkdownRenderer
                    v-if="
                      isThinkingExpanded(
                        messageStableKey(item.message, item.messageIndex),
                        bIdx,
                      )
                    "
                    class="thinking-content"
                    :content="block.text"
                  />
                </div>

                <div
                  v-else-if="block.kind === 'tool'"
                  class="tool-card-block"
                  :data-tree-entry-id="block.resultSourceMessageId"
                >
                  <ToolCard
                    :block="block"
                    :expanded="
                      isToolBlockExpanded(
                        messageStableKey(item.message, item.messageIndex),
                        bIdx,
                      )
                    "
                    @toggle="
                      toggleToolBlock(
                        messageStableKey(item.message, item.messageIndex),
                        bIdx,
                      )
                    "
                  />
                </div>

                <figure
                  v-else-if="block.kind === 'image'"
                  class="message-image-block"
                >
                  <button
                    type="button"
                    class="message-image-button"
                    aria-label="Open image"
                    @click="openImageLightbox([block])"
                  >
                    <img
                      class="message-image"
                      :src="block.src"
                      :alt="block.alt"
                      loading="lazy"
                    />
                  </button>
                </figure>

                <MarkdownRenderer
                  v-else-if="block.kind === 'text' && block.text"
                  :content="block.text"
                />
              </template>
            </div>
            <div v-if="canReviseMessage(item.message)" class="message-actions">
              <button
                type="button"
                class="message-action-button"
                aria-label="Edit message"
                title="Edit message"
                @click="handleRevise(item.message)"
              >
                <Pencil class="message-action-icon" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </template>

    <div v-if="showBusyIndicator" class="streaming-indicator">
      <span class="busy-label">{{ busyIndicatorLabel }}</span>
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>

    <ImageLightbox
      :open="lightboxImages.length > 0"
      :images="lightboxImages"
      :index="lightboxIndex"
      @close="closeImageLightbox"
      @previous="showPreviousLightboxImage"
      @next="showNextLightboxImage"
    />
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

.loading-state {
  min-height: 240px;
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
  font-size: 0.68rem;
  color: var(--text-subtle);
}

.history-loader {
  display: flex;
  justify-content: center;
  width: 100%;
}

.history-loader-button {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--text-subtle);
  padding: 8px 14px;
  font-size: 0.74rem;
  cursor: pointer;
}

.history-loader-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
}

.history-loader-button:disabled {
  opacity: 0.7;
  cursor: progress;
}

.session-event-row {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(24px, 1fr) auto minmax(24px, 1fr);
  align-items: center;
  gap: 12px;
}

.session-event-line {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--border) 88%, transparent),
    transparent
  );
}

.session-event-body {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.session-event-label {
  font-size: 0.66rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.session-event-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel) 76%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 20%, transparent);
  font-size: 0.72rem;
  line-height: 1.2;
  color: var(--text-muted);
}

.session-event-chip-label {
  display: inline-flex;
  align-items: center;
  padding-right: 8px;
  border-right: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  line-height: 1;
  color: var(--text-subtle);
}

.session-event-chip-value {
  display: inline-flex;
  align-items: center;
  font-weight: 500;
  line-height: 1.1;
  color: var(--text);
}

.session-event-debug {
  font-family: var(--pi-font-mono);
  font-size: 0.64rem;
  color: var(--text-subtle);
}

.message-row {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
}

.message-row.assistant,
.message-row.user,
.message-row.system {
  display: flex;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.system {
  justify-content: center;
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
  font-size: 0.64rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.message-stack {
  min-width: 0;
  width: 100%;
}

.message-stack.user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.message-content {
  min-width: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text);
  word-break: break-word;
}

.message-content.assistant,
.message-content.tool,
.message-content.system {
  width: 100%;
  padding-left: 14px;
}

.message-debug-id {
  display: inline-flex;
  align-items: center;
  margin: 0 0 10px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  font-family: var(--pi-font-mono);
  font-size: 0.66rem;
  line-height: 1;
  color: var(--text-subtle);
}

.message-actions {
  display: flex;
  justify-content: flex-end;
  width: fit-content;
  max-width: min(720px, 100%);
  margin: 6px 4px 0 0;
}

.message-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
  background: color-mix(in srgb, var(--panel) 84%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition:
    opacity 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease,
    background 0.14s ease,
    transform 0.14s ease;
}

.message-stack.user:hover .message-action-button,
.message-stack.user:focus-within .message-action-button,
.message-action-button:focus-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.message-action-button:hover,
.message-action-button:focus-visible {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--panel-2) 92%, transparent);
  color: var(--text);
}

.message-action-icon {
  width: 14px;
  height: 14px;
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
.markdown-body + .message-image-block,
.markdown-body + .system-block,
.thinking-block + .markdown-body,
.thinking-block + .tool-card-block,
.thinking-block + .message-image-block,
.thinking-block + .system-block,
.tool-card-block + .markdown-body,
.tool-card-block + .thinking-block,
.tool-card-block + .message-image-block,
.tool-card-block + .system-block,
.message-image-block + .markdown-body,
.message-image-block + .thinking-block,
.message-image-block + .tool-card-block,
.message-image-block + .message-image-block,
.message-image-block + .system-block,
.system-block + .markdown-body,
.system-block + .thinking-block,
.system-block + .tool-card-block,
.system-block + .message-image-block,
.system-block + .system-block {
  margin-top: 12px;
}

.thinking-block {
  padding-left: 10px;
}

.system-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(720px, 100%);
  margin: 0 auto;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 86%, transparent);
}

.system-block-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.system-block-label,
.system-block-meta {
  font-size: 0.66rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.system-block-title {
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--text);
}

.system-block-body {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.6;
}

.message-image-block {
  margin: 0;
}

.message-image-button {
  display: block;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
}

.message-image {
  display: block;
  max-width: min(100%, 420px);
  max-height: 320px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
  object-fit: contain;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    border-color 0.16s ease;
}

.message-image-button:hover .message-image,
.message-image-button:focus-visible .message-image {
  transform: translateY(-1px) scale(1.01);
  border-color: var(--border-strong);
  box-shadow: 0 18px 32px rgba(0, 0, 0, 0.16);
}

.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.7rem;
  cursor: pointer;
}

.thinking-toggle:hover {
  color: var(--text);
}

.thinking-content {
  margin: 8px 0 0;
  padding: 10px 0 0;
  font-size: 0.74rem;
  line-height: 1.55;
  color: var(--text-muted);
  max-height: 400px;
  overflow-y: auto;
  word-break: break-word;
}

.error-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--tool-card-bg);
}

.error-block:not(.aborted) {
  border-color: color-mix(in srgb, var(--error-border) 58%, var(--border));
}

.error-block-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.error-block-heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.error-label {
  font-size: 0.64rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.error-block:not(.aborted) .error-label {
  color: var(--error-text);
}

.error-block-body {
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--tool-card-bg-strong);
  overflow: auto;
  max-height: 360px;
}

.error-block:not(.aborted) .error-block-body {
  border-color: color-mix(in srgb, var(--error-border) 92%, var(--border));
}

.error-message {
  display: block;
  margin: 0;
  padding: 10px 12px;
  color: var(--text-muted);
  font-size: 0.72rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.error-block:not(.aborted) .error-message {
  color: var(--error-text);
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.tool-result-card-heading {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
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
  font-family: inherit;
  font-size: 0.72rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-muted);
}

.tool-result-card-images {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tool-result-card-details {
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.toggle-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 0 8px 14px;
  width: min(920px, calc(100% - 64px));
  margin: 0 auto;
}

.busy-label {
  margin-right: 4px;
  font-size: 0.72rem;
  color: var(--text-subtle);
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

  .session-event-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .session-event-line {
    display: none;
  }

  .message-row.tool {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .message-meta {
    display: none;
  }

  .message-content.assistant,
  .message-content.tool,
  .message-content.user,
  .message-content.system,
  .tool-row {
    margin-left: 0;
    max-width: 100%;
    padding-left: 0;
  }

  .message-actions {
    max-width: 100%;
    margin-right: 0;
  }

  .thinking-block {
    padding-left: 0;
  }

  .system-block {
    max-width: 100%;
    padding: 10px 12px;
  }

  .tool-result-card-header {
    flex-direction: column;
    align-items: stretch;
  }

  .tool-result-card-toggle {
    align-self: flex-start;
  }

  .streaming-indicator {
    width: calc(100% - 32px);
    padding-left: 0;
  }
}

@media (max-width: 640px) {
  .chat-transcript {
    padding: 12px 12px 8px;
    gap: 12px;
  }

  .message-content {
    font-size: 0.86rem;
    line-height: 1.65;
  }

  .message-content.user {
    padding: 10px 12px;
    border-radius: 16px 16px 6px 16px;
  }

  .tool-result-card {
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
  }

  .error-block {
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
  }

  .error-message {
    padding: 9px 10px;
  }

  .error-message,
  .tool-result-card-preview,
  .tool-result-card-details,
  .thinking-content,
  .system-block-body {
    font-size: 0.68rem;
  }

  .message-image {
    max-width: 100%;
    max-height: 240px;
  }

  .streaming-indicator {
    width: calc(100% - 24px);
  }
}
</style>
