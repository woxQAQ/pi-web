<script setup lang="ts">
import { ChevronLeft, ChevronRight, Pencil, Sparkle } from "lucide-vue-next";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { TranscriptEntry, TreeEntry } from "../composables/useBridgeClient";
import { userMessageCopyText } from "../utils/messageCopy";
import type { ImageContentBlock } from "../utils/transcript";
import {
  contentBlocks,
  isAbortedMessage,
  isErrorMessage,
  errorMessageText,
  isToolResultMessage,
  messageContent,
} from "../utils/transcript";
import { buildMessageBranchNavigators } from "../utils/treeNavigation";
import ImageLightbox from "./ImageLightbox.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import ToolCard from "./ToolCard.vue";

const props = defineProps<{
  messages: readonly TranscriptEntry[];
  treeEntries: readonly TreeEntry[];
  hasOlder: boolean;
  initialLoading: boolean;
  pageLoading: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  showMessageIds: boolean;
  allowRevision: boolean;
  allowBranchNavigation: boolean;
  hideTools: boolean;
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
  navigateBranch: [entryId: string];
}>();

const container = ref<HTMLDivElement | null>(null);
const userCopySelector = "[data-user-message-index]";

let wasDisconnected = false;
let savedScrollTop = 0;
let savedScrollHeight = 0;
let topLoadArmed = true;
let pendingHistoryAnchor: { scrollTop: number; scrollHeight: number } | null =
  null;

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
const showBusyIndicator = computed(
  () => props.isStreaming || props.isCompacting,
);
const busyIndicatorLabel = computed(() =>
  props.isCompacting && !props.isStreaming
    ? "Compacting context"
    : "Assistant is responding",
);
const branchNavigators = computed(() =>
  buildMessageBranchNavigators(props.treeEntries, props.messages),
);
const messageRenderSignature = computed(
  () =>
    `${props.hideTools ? "conversation-only" : "full-transcript"}\u001e${visibleMessages.value
      .map(({ msg, sourceIndex }) => messageStableKey(msg, sourceIndex))
      .join("\u001f")}`,
);
const lightboxImages = ref<ImageContentBlock[]>([]);
const lightboxIndex = ref(0);
const highlightedEntryId = ref<string | null>(null);
const variantSwipeStart = new Map<string, { x: number; y: number }>();
let pendingViewportRestore: { scrollTop: number } | null = null;
let pendingMessageFocus: {
  entryId: string;
  behavior: ScrollBehavior;
  block: ScrollLogicalPosition;
} | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

function messageStableKey(msg: TranscriptEntry, index: number): string {
  return msg.transcriptKey ?? msg.id ?? `message:${index}`;
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

function isHiddenSystemBlock(block: ReturnType<typeof contentBlocks>[number]) {
  return (
    block.kind === "system" &&
    (block.systemType === "model_change" ||
      block.systemType === "thinking_level_change" ||
      block.systemType === "session_info")
  );
}

function visibleContentBlocks(msg: TranscriptEntry) {
  return contentBlocks(msg).filter(block => {
    if (isHiddenSystemBlock(block)) return false;
    if (props.hideTools && block.kind === "tool") return false;
    return true;
  });
}

const visibleMessages = computed(() =>
  props.messages.flatMap((msg, sourceIndex) => {
    const blocks = visibleContentBlocks(msg);

    if (props.hideTools) {
      if (isErrorMessage(msg)) {
        return [{ msg, sourceIndex, blocks }];
      }

      if (
        (msg.role === "user" || msg.role === "assistant") &&
        blocks.length > 0
      ) {
        return [{ msg, sourceIndex, blocks }];
      }

      return [];
    }

    if (isToolResultMessage(msg) || isErrorMessage(msg) || blocks.length > 0) {
      return [{ msg, sourceIndex, blocks }];
    }

    return [];
  }),
);

function queueViewportRestore() {
  if (!container.value) return;
  pendingViewportRestore = {
    scrollTop: container.value.scrollTop,
  };
}

function clearPreservedViewport() {
  pendingViewportRestore = null;
}

function restorePreservedViewport(): boolean {
  if (!container.value || !pendingViewportRestore) return false;
  const maxScrollTop = Math.max(
    0,
    container.value.scrollHeight - container.value.clientHeight,
  );
  container.value.scrollTop = Math.min(
    pendingViewportRestore.scrollTop,
    maxScrollTop,
  );
  pendingViewportRestore = null;
  return true;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function messageElementByEntryId(entryId: string): HTMLElement | null {
  const root = container.value;
  if (!root) return null;
  return root.querySelector<HTMLElement>(
    `[data-entry-id="${escapeAttributeValue(entryId)}"]`,
  );
}

function flashMessage(entryId: string) {
  highlightedEntryId.value = entryId;
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    if (highlightedEntryId.value === entryId) {
      highlightedEntryId.value = null;
    }
  }, 1200);
}

function focusMessage(
  entryId: string,
  options: {
    behavior?: ScrollBehavior;
    block?: ScrollLogicalPosition;
  } = {},
): boolean {
  const element = messageElementByEntryId(entryId);
  if (!element) return false;

  element.scrollIntoView({
    behavior: options.behavior ?? "smooth",
    block: options.block ?? "center",
    inline: "nearest",
  });
  flashMessage(entryId);
  return true;
}

function queueFocusMessage(
  entryId: string,
  options: {
    behavior?: ScrollBehavior;
    block?: ScrollLogicalPosition;
  } = {},
) {
  pendingMessageFocus = {
    entryId,
    behavior: options.behavior ?? "smooth",
    block: options.block ?? "center",
  };
}

function flushQueuedMessageFocus(): boolean {
  if (!pendingMessageFocus) return false;

  const didHandle = true;
  if (
    focusMessage(pendingMessageFocus.entryId, {
      behavior: pendingMessageFocus.behavior,
      block: pendingMessageFocus.block,
    })
  ) {
    pendingMessageFocus = null;
  }

  return didHandle;
}

function messageBranchNavigator(msg: TranscriptEntry) {
  if (msg.role !== "user" || typeof msg.id !== "string") return null;
  return branchNavigators.value[msg.id] ?? null;
}

function canNavigateBranchVariants(msg: TranscriptEntry): boolean {
  return Boolean(
    props.allowBranchNavigation &&
      !showBusyIndicator.value &&
      messageBranchNavigator(msg),
  );
}

function previousBranchTarget(msg: TranscriptEntry): string | null {
  return messageBranchNavigator(msg)?.previous?.navigateEntryId ?? null;
}

function nextBranchTarget(msg: TranscriptEntry): string | null {
  return messageBranchNavigator(msg)?.next?.navigateEntryId ?? null;
}

function branchCountLabel(msg: TranscriptEntry): string {
  const navigator = messageBranchNavigator(msg);
  if (!navigator) return "";
  return `${navigator.currentIndex + 1}/${navigator.total}`;
}

function handlePreviousBranch(msg: TranscriptEntry) {
  const target = previousBranchTarget(msg);
  if (!target) return;
  handleBranchNavigate(target);
}

function handleNextBranch(msg: TranscriptEntry) {
  const target = nextBranchTarget(msg);
  if (!target) return;
  handleBranchNavigate(target);
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

function handleBranchNavigate(entryId: string) {
  if (!props.allowBranchNavigation || showBusyIndicator.value) return;
  emit("navigateBranch", entryId);
}

function handleVariantTouchStart(msg: TranscriptEntry, event: TouchEvent) {
  const navigator = messageBranchNavigator(msg);
  if (!navigator || event.changedTouches.length === 0) return;
  const touch = event.changedTouches[0];
  const key = msg.id ?? messageStableKey(msg, 0);
  variantSwipeStart.set(key, { x: touch.clientX, y: touch.clientY });
}

function handleVariantTouchEnd(msg: TranscriptEntry, event: TouchEvent) {
  const key = msg.id ?? messageStableKey(msg, 0);
  const start = variantSwipeStart.get(key);
  variantSwipeStart.delete(key);
  if (!start || event.changedTouches.length === 0) return;

  const navigator = messageBranchNavigator(msg);
  if (!navigator) return;

  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - start.x;
  const deltaY = touch.clientY - start.y;
  if (Math.abs(deltaX) < 56 || Math.abs(deltaY) > 40) return;

  if (deltaX < 0 && navigator.next) {
    handleBranchNavigate(navigator.next.navigateEntryId);
    return;
  }

  if (deltaX > 0 && navigator.previous) {
    handleBranchNavigate(navigator.previous.navigateEntryId);
  }
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
  variantSwipeStart.clear();
  if (highlightTimer) clearTimeout(highlightTimer);
});

watch(
  () => messageRenderSignature.value,
  async () => {
    await nextTick();

    if (pendingHistoryAnchor && container.value) {
      const delta =
        container.value.scrollHeight - pendingHistoryAnchor.scrollHeight;
      container.value.scrollTop = pendingHistoryAnchor.scrollTop + delta;
      pendingHistoryAnchor = null;
      return;
    }

    if (flushQueuedMessageFocus()) {
      return;
    }

    if (restorePreservedViewport()) {
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

defineExpose({
  preserveScroll,
  preserveViewport: queueViewportRestore,
  clearPreservedViewport,
  focusMessage,
  queueFocusMessage,
});
</script>

<template>
  <div ref="container" class="chat-transcript">
    <div v-if="initialLoading" class="empty-state loading-state">
      <p class="empty-title">Loading conversation</p>
      <p class="empty-subtitle">Fetching the latest transcript window.</p>
    </div>
    <div v-else-if="visibleMessages.length === 0" class="empty-state">
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
      v-for="item in visibleMessages"
      :key="messageStableKey(item.msg, item.sourceIndex)"
    >
      <div v-if="isToolResultMessage(item.msg)" class="message-row tool">
        <div class="message-meta">
          <span class="message-role">{{ roleLabel(item.msg.role) }}</span>
        </div>
        <div class="message-content tool-row">
          <div class="tool-result-card">
            <div class="tool-result-card-header">
              <div class="tool-result-card-heading">
                <span class="tool-result-card-label">{{
                  roleLabel(item.msg.role)
                }}</span>
                <span v-if="showMessageIds" class="message-debug-id">
                  ID {{ messageIdLabel(item.msg) }}
                </span>
              </div>
              <button
                v-if="toolResultCanExpand(item.msg)"
                type="button"
                class="tool-result-card-toggle"
                @click="
                  toggleToolBlock(
                    messageStableKey(item.msg, item.sourceIndex),
                    -1,
                  )
                "
                :title="
                  isToolBlockExpanded(
                    messageStableKey(item.msg, item.sourceIndex),
                    -1,
                  )
                    ? 'Collapse'
                    : 'Expand'
                "
              >
                {{
                  isToolBlockExpanded(
                    messageStableKey(item.msg, item.sourceIndex),
                    -1,
                  )
                    ? "Hide"
                    : "Details"
                }}
              </button>
            </div>
            <pre
              v-if="toolResultPreview(item.msg)"
              class="tool-result-card-preview"
              >{{ toolResultPreview(item.msg) }}</pre
            >
            <div
              v-if="toolResultImages(item.msg).length > 0"
              class="tool-result-card-images"
            >
              <figure
                v-for="(image, imageIndex) in toolResultImages(item.msg)"
                :key="`${image.src}-${imageIndex}`"
                class="message-image-block"
              >
                <button
                  type="button"
                  class="message-image-button"
                  :aria-label="`Open image ${imageIndex + 1}`"
                  @click="
                    openImageLightbox(toolResultImages(item.msg), imageIndex)
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
                  messageStableKey(item.msg, item.sourceIndex),
                  -1,
                ) && toolResultText(item.msg).trim()
              "
              class="tool-result-card-details"
              >{{ toolResultText(item.msg) }}</pre
            >
          </div>
        </div>
      </div>

      <div
        v-else-if="isErrorMessage(item.msg)"
        class="message-row"
        :class="[
          roleClass(item.msg.role),
          { 'jump-highlight': highlightedEntryId === item.msg.id },
        ]"
        :data-entry-id="
          typeof item.msg.id === 'string' ? item.msg.id : undefined
        "
      >
        <div class="message-content" :class="roleClass(item.msg.role)">
          <div v-if="showMessageIds" class="message-debug-id">
            ID {{ messageIdLabel(item.msg) }}
          </div>
          <div
            class="error-block"
            :class="{ aborted: isAbortedMessage(item.msg) }"
          >
            <span class="error-label">{{
              isAbortedMessage(item.msg) ? "Cancelled" : "Error"
            }}</span>
            <span v-if="errorMessageText(item.msg)" class="error-message">{{
              errorMessageText(item.msg)
            }}</span>
          </div>
        </div>
      </div>

      <div
        v-else-if="item.blocks.length > 0"
        class="message-row"
        :class="[
          roleClass(item.msg.role),
          { 'jump-highlight': highlightedEntryId === item.msg.id },
        ]"
        :data-entry-id="
          typeof item.msg.id === 'string' ? item.msg.id : undefined
        "
      >
        <div
          class="message-stack"
          :class="roleClass(item.msg.role)"
          @touchstart.passive="handleVariantTouchStart(item.msg, $event)"
          @touchend.passive="handleVariantTouchEnd(item.msg, $event)"
        >
          <div
            class="message-content"
            :class="roleClass(item.msg.role)"
            :data-user-message-index="
              item.msg.role === 'user' ? item.sourceIndex : undefined
            "
          >
            <div v-if="showMessageIds" class="message-debug-id">
              ID {{ messageIdLabel(item.msg) }}
            </div>
            <template v-for="(block, bIdx) in item.blocks" :key="bIdx">
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

              <div v-else-if="block.kind === 'thinking'" class="thinking-block">
                <button
                  class="thinking-toggle"
                  @click="
                    toggleThinking(
                      messageStableKey(item.msg, item.sourceIndex),
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
                      messageStableKey(item.msg, item.sourceIndex),
                      bIdx,
                    )
                  "
                  class="thinking-content"
                  :content="block.text"
                />
              </div>

              <ToolCard
                v-else-if="block.kind === 'tool'"
                class="tool-card-block"
                :block="block"
                :expanded="
                  isToolBlockExpanded(
                    messageStableKey(item.msg, item.sourceIndex),
                    bIdx,
                  )
                "
                @toggle="
                  toggleToolBlock(
                    messageStableKey(item.msg, item.sourceIndex),
                    bIdx,
                  )
                "
                @preview-image="openImageLightbox($event.images, $event.index)"
              />

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
          <div
            v-if="canReviseMessage(item.msg) || messageBranchNavigator(item.msg)"
            class="message-actions"
            :class="[
              roleClass(item.msg.role),
              { persistent: !!messageBranchNavigator(item.msg) },
            ]"
          >
            <button
              v-if="canReviseMessage(item.msg)"
              type="button"
              class="message-action-button"
              aria-label="Edit message"
              title="Edit message"
              @click="handleRevise(item.msg)"
            >
              <Pencil class="message-action-icon" aria-hidden="true" />
            </button>
            <div
              v-if="messageBranchNavigator(item.msg)"
              class="message-branch-switcher"
              :class="{ disabled: !canNavigateBranchVariants(item.msg) }"
              :title="
                canNavigateBranchVariants(item.msg)
                  ? 'Swipe or use the arrows to switch branches'
                  : 'Branch switching is temporarily unavailable'
              "
            >
              <button
                type="button"
                class="message-branch-button"
                :disabled="
                  !canNavigateBranchVariants(item.msg) ||
                  !previousBranchTarget(item.msg)
                "
                aria-label="Previous branch"
                @click="handlePreviousBranch(item.msg)"
              >
                <ChevronLeft class="message-branch-icon" aria-hidden="true" />
              </button>
              <span class="message-branch-count">
                {{ branchCountLabel(item.msg) }}
              </span>
              <button
                type="button"
                class="message-branch-button"
                :disabled="
                  !canNavigateBranchVariants(item.msg) ||
                  !nextBranchTarget(item.msg)
                "
                aria-label="Next branch"
                @click="handleNextBranch(item.msg)"
              >
                <ChevronRight
                  class="message-branch-icon"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
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

.message-row {
  position: relative;
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
}

.message-row > * {
  position: relative;
  z-index: 1;
}

.message-row.jump-highlight::before {
  content: "";
  position: absolute;
  inset: -8px -10px;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 58%, transparent);
  background: color-mix(in srgb, var(--panel-2) 64%, transparent);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.08);
  pointer-events: none;
  animation: jump-flash 1.15s ease;
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
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: min(720px, 100%);
  margin-top: 6px;
}

.message-actions.user {
  justify-content: flex-end;
  margin-right: 4px;
  margin-left: auto;
}

.message-actions.assistant {
  justify-content: flex-start;
  margin-left: 14px;
}

.message-action-button,
.message-branch-button {
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
  transition:
    opacity 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease,
    background 0.14s ease,
    transform 0.14s ease;
}

.message-action-button {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
}

.message-stack.user:hover .message-action-button,
.message-stack.user:focus-within .message-action-button,
.message-actions.persistent .message-action-button,
.message-action-button:focus-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.message-action-button:hover,
.message-action-button:focus-visible,
.message-branch-button:hover,
.message-branch-button:focus-visible {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--panel-2) 92%, transparent);
  color: var(--text);
}

.message-action-button:disabled,
.message-branch-button:disabled {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
  transform: none;
}

.message-action-icon,
.message-branch-icon {
  width: 14px;
  height: 14px;
}

.message-branch-switcher {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.message-branch-switcher.disabled {
  opacity: 0.72;
}

.message-branch-count {
  min-width: 42px;
  text-align: center;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  user-select: none;
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
  align-items: flex-start;
  gap: 8px;
  max-width: min(680px, 100%);
  margin: 0;
  padding: 13px 15px;
  border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
  border-left: 2px solid color-mix(in srgb, var(--border-strong) 74%, transparent);
  border-radius: 16px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel) 94%, transparent),
    color-mix(in srgb, var(--panel-2) 88%, transparent)
  );
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
}

.system-block.compact {
  gap: 6px;
  width: fit-content;
  min-width: min(280px, 100%);
  max-width: min(520px, 100%);
  padding: 10px 12px 11px 14px;
  border-radius: 18px;
  border-left-width: 3px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel) 97%, transparent),
    color-mix(in srgb, var(--panel-2) 92%, transparent)
  );
}

.system-block[data-system-type="model_change"],
.system-block[data-system-type="thinking_level_change"],
.system-block[data-system-type="session_info"] {
  backdrop-filter: blur(8px);
}

.system-block-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.system-block.compact .system-block-header {
  gap: 16px;
}

.system-block-label,
.system-block-meta {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-subtle);
}

.system-block-meta {
  margin-left: auto;
  white-space: nowrap;
}

.system-block-title {
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--text);
}

.system-block.compact .system-block-title {
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.3;
}

.system-block-body {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.62;
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
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border-left: 2px solid #e05050;
  border-radius: 6px;
  background: color-mix(in srgb, #e05050 6%, transparent);
  font-size: 0.8rem;
}

.error-block.aborted {
  border-left-color: var(--text-muted);
  background: color-mix(in srgb, var(--text-muted) 6%, transparent);
}

.error-label {
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #e05050;
  flex-shrink: 0;
}

.error-block.aborted .error-label {
  color: var(--text-muted);
}

.error-message {
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.5;
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

@keyframes jump-flash {
  0% {
    opacity: 0;
    transform: scale(0.986);
  }
  18% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(1.008);
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

  .message-actions.assistant {
    margin-left: 0;
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

  .message-branch-count {
    min-width: 36px;
    font-size: 0.68rem;
  }

  .tool-result-card {
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
  }

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
