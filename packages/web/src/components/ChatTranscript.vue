<script setup lang="ts">
import { ChevronDown, ChevronRight, Sparkle } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from "vue";
import type { TranscriptEntry } from "../composables/useBridgeClient";
import { userMessageCopyText } from "../utils/messageCopy";
import type { ImageContentBlock } from "../utils/transcript";
import {
  contentBlocks,
  isAbortedMessage,
  isErrorMessage,
  errorMessageText,
  isToolResultMessage,
} from "../utils/transcript";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import ToolCard from "./ToolCard.vue";

const props = defineProps<{
  messages: readonly TranscriptEntry[];
  isStreaming: boolean;
  showMessageIds: boolean;
}>();

const container = ref<HTMLDivElement | null>(null);
const userCopySelector = "[data-user-message-index]";

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

function messageIdLabel(msg: TranscriptEntry): string {
  return msg.id ?? "missing";
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

onMounted(() => document.addEventListener("copy", handleCopy));
onBeforeUnmount(() => document.removeEventListener("copy", handleCopy));

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
  async streaming => {
    if (streaming) {
      await nextTick();
      if (container.value) {
        container.value.scrollTop = container.value.scrollHeight;
      }
    }
  },
);

defineExpose({ preserveScroll });
</script>

<template>
  <div ref="container" class="chat-transcript">
    <div v-if="messages.length === 0" class="empty-state">
      <p class="empty-title">Start a conversation</p>
      <p class="empty-subtitle">
        Use / to open commands, then keep the session moving.
      </p>
      <div class="empty-hints">
        <span class="hint-chip">/ commands</span>
        <span class="hint-chip">Enter send</span>
        <span class="hint-chip">Drop or paste images</span>
      </div>
    </div>
    <template
      v-for="(msg, index) in messages"
      :key="messageStableKey(msg, index)"
    >
      <div v-if="isToolResultMessage(msg)" class="message-row tool">
        <div class="message-meta">
          <span class="message-role">{{ roleLabel(msg.role) }}</span>
        </div>
        <div class="message-content tool-row">
          <div class="tool-result-card">
            <div class="tool-result-card-header">
              <div class="tool-result-card-heading">
                <span class="tool-result-card-label">{{
                  roleLabel(msg.role)
                }}</span>
                <span v-if="showMessageIds" class="message-debug-id">
                  ID {{ messageIdLabel(msg) }}
                </span>
              </div>
              <button
                v-if="toolResultCanExpand(msg)"
                type="button"
                class="tool-result-card-toggle"
                @click="toggleToolBlock(messageStableKey(msg, index), -1)"
                :title="
                  isToolBlockExpanded(messageStableKey(msg, index), -1)
                    ? 'Collapse'
                    : 'Expand'
                "
              >
                {{
                  isToolBlockExpanded(messageStableKey(msg, index), -1)
                    ? "Hide"
                    : "Details"
                }}
              </button>
            </div>
            <pre
              v-if="toolResultPreview(msg)"
              class="tool-result-card-preview"
              >{{ toolResultPreview(msg) }}</pre
            >
            <div
              v-if="toolResultImages(msg).length > 0"
              class="tool-result-card-images"
            >
              <figure
                v-for="(image, imageIndex) in toolResultImages(msg)"
                :key="`${image.src}-${imageIndex}`"
                class="message-image-block"
              >
                <img
                  class="message-image"
                  :src="image.src"
                  :alt="image.alt"
                  loading="lazy"
                />
              </figure>
            </div>
            <pre
              v-if="
                isToolBlockExpanded(messageStableKey(msg, index), -1) &&
                toolResultText(msg).trim()
              "
              class="tool-result-card-details"
              >{{ toolResultText(msg) }}</pre
            >
          </div>
        </div>
      </div>

      <div
        v-else-if="isErrorMessage(msg)"
        class="message-row"
        :class="roleClass(msg.role)"
      >
        <div class="message-content" :class="roleClass(msg.role)">
          <div v-if="showMessageIds" class="message-debug-id">
            ID {{ messageIdLabel(msg) }}
          </div>
          <div class="error-block" :class="{ aborted: isAbortedMessage(msg) }">
            <span class="error-label">{{
              isAbortedMessage(msg) ? "Cancelled" : "Error"
            }}</span>
            <span v-if="errorMessageText(msg)" class="error-message">{{
              errorMessageText(msg)
            }}</span>
          </div>
        </div>
      </div>

      <div v-else class="message-row" :class="roleClass(msg.role)">
        <div
          class="message-content"
          :class="roleClass(msg.role)"
          :data-user-message-index="msg.role === 'user' ? index : undefined"
        >
          <div v-if="showMessageIds" class="message-debug-id">
            ID {{ messageIdLabel(msg) }}
          </div>
          <template v-for="(block, bIdx) in contentBlocks(msg)" :key="bIdx">
            <div v-if="block.kind === 'thinking'" class="thinking-block">
              <button
                class="thinking-toggle"
                @click="toggleThinking(messageStableKey(msg, index), bIdx)"
              >
                <Sparkle class="toggle-icon" aria-hidden="true" />
                Thinking
              </button>
              <MarkdownRenderer
                v-if="isThinkingExpanded(messageStableKey(msg, index), bIdx)"
                class="thinking-content"
                :content="block.text"
              />
            </div>

            <ToolCard
              v-else-if="block.kind === 'tool'"
              class="tool-card-block"
              :block="block"
              :expanded="
                isToolBlockExpanded(messageStableKey(msg, index), bIdx)
              "
              @toggle="toggleToolBlock(messageStableKey(msg, index), bIdx)"
            />

            <figure
              v-else-if="block.kind === 'image'"
              class="message-image-block"
            >
              <img
                class="message-image"
                :src="block.src"
                :alt="block.alt"
                loading="lazy"
              />
            </figure>

            <MarkdownRenderer
              v-else-if="block.kind === 'text' && block.text"
              :content="block.text"
            />
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

.message-debug-id {
  display: inline-flex;
  align-items: center;
  margin: 0 0 10px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  font-family:
    ui-monospace, SFMono-Regular, SFMono-Regular, Consolas, "Liberation Mono",
    Menlo, monospace;
  font-size: 0.66rem;
  line-height: 1;
  color: var(--text-subtle);
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
.thinking-block + .markdown-body,
.thinking-block + .tool-card-block,
.thinking-block + .message-image-block,
.tool-card-block + .markdown-body,
.tool-card-block + .thinking-block,
.tool-card-block + .message-image-block,
.message-image-block + .markdown-body,
.message-image-block + .thinking-block,
.message-image-block + .tool-card-block,
.message-image-block + .message-image-block {
  margin-top: 12px;
}

.thinking-block {
  padding-left: 10px;
}

.message-image-block {
  margin: 0;
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

  .message-meta {
    display: none;
  }

  .message-content.assistant,
  .message-content.tool,
  .message-content.user,
  .tool-row {
    margin-left: 0;
    max-width: 100%;
    padding-left: 0;
  }

  .thinking-block {
    padding-left: 0;
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

  .tool-result-card-preview,
  .tool-result-card-details,
  .thinking-content {
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
