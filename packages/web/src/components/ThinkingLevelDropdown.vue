<script setup lang="ts">
import { Check, ChevronDown } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { RpcThinkingLevel } from "../shared-types";
import {
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVEL_OPTIONS,
} from "../utils/thinkingLevels";

const props = defineProps<{
  value: RpcThinkingLevel | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [level: RpcThinkingLevel];
}>();

const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const highlightedIndex = ref(0);

const selectedLevel = computed(() => props.value ?? DEFAULT_THINKING_LEVEL);
const selectedLabel = computed(
  () =>
    THINKING_LEVEL_OPTIONS.find(option => option.value === selectedLevel.value)
      ?.label ?? "Off",
);
const selectedIndex = computed(() =>
  THINKING_LEVEL_OPTIONS.findIndex(
    option => option.value === selectedLevel.value,
  ),
);

function syncHighlightedIndex() {
  highlightedIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0;
}

function scrollToHighlighted() {
  nextTick(() => {
    const element = listRef.value?.children[highlightedIndex.value] as
      | HTMLElement
      | undefined;
    element?.scrollIntoView({ block: "nearest" });
  });
}

async function openDropdown() {
  if (props.disabled) return;
  isOpen.value = true;
  syncHighlightedIndex();
  await nextTick();
  listRef.value?.focus();
  scrollToHighlighted();
}

function closeDropdown(options?: { focusTrigger?: boolean }) {
  isOpen.value = false;
  if (options?.focusTrigger) {
    nextTick(() => {
      triggerRef.value?.focus();
    });
  }
}

function toggleDropdown() {
  if (isOpen.value) {
    closeDropdown();
    return;
  }
  void openDropdown();
}

function updateHighlight(nextIndex: number) {
  const maxIndex = THINKING_LEVEL_OPTIONS.length - 1;
  highlightedIndex.value = Math.min(Math.max(nextIndex, 0), maxIndex);
  scrollToHighlighted();
}

function selectLevel(level: RpcThinkingLevel) {
  emit("select", level);
  closeDropdown({ focusTrigger: true });
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (props.disabled) return;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (!isOpen.value) {
        void openDropdown();
        return;
      }
      updateHighlight(highlightedIndex.value + 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      if (!isOpen.value) {
        void openDropdown();
        return;
      }
      updateHighlight(highlightedIndex.value - 1);
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      toggleDropdown();
      break;
  }
}

function handleListKeydown(event: KeyboardEvent) {
  if (!isOpen.value) return;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      updateHighlight(
        (highlightedIndex.value + 1) % THINKING_LEVEL_OPTIONS.length,
      );
      break;
    case "ArrowUp":
      event.preventDefault();
      updateHighlight(
        (highlightedIndex.value - 1 + THINKING_LEVEL_OPTIONS.length) %
          THINKING_LEVEL_OPTIONS.length,
      );
      break;
    case "Home":
      event.preventDefault();
      updateHighlight(0);
      break;
    case "End":
      event.preventDefault();
      updateHighlight(THINKING_LEVEL_OPTIONS.length - 1);
      break;
    case "Enter":
    case " ": {
      event.preventDefault();
      const option = THINKING_LEVEL_OPTIONS[highlightedIndex.value];
      if (option) {
        selectLevel(option.value);
      }
      break;
    }
    case "Escape":
      event.preventDefault();
      closeDropdown({ focusTrigger: true });
      break;
    case "Tab":
      closeDropdown();
      break;
  }
}

function handleDocumentMousedown(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!rootRef.value?.contains(target)) {
    closeDropdown();
  }
}

watch(isOpen, open => {
  if (typeof document === "undefined") return;
  if (open) {
    document.addEventListener("mousedown", handleDocumentMousedown);
    return;
  }
  document.removeEventListener("mousedown", handleDocumentMousedown);
});

watch(
  () => props.value,
  () => {
    if (!isOpen.value) return;
    syncHighlightedIndex();
    scrollToHighlighted();
  },
);

onBeforeUnmount(() => {
  if (typeof document !== "undefined") {
    document.removeEventListener("mousedown", handleDocumentMousedown);
  }
});
</script>

<template>
  <div ref="rootRef" class="thinking-dropdown">
    <button
      ref="triggerRef"
      class="thinking-trigger"
      :type="'button'"
      :disabled="disabled"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      aria-label="Thinking level"
      aria-keyshortcuts="Shift+Tab"
      title="Thinking level · Shift+Tab"
      @click="toggleDropdown"
      @keydown="handleTriggerKeydown"
    >
      <span class="thinking-trigger-label" aria-hidden="true">Thinking</span>
      <span class="thinking-trigger-value">{{ selectedLabel }}</span>
      <ChevronDown class="thinking-trigger-caret" aria-hidden="true" />
    </button>

    <div v-if="isOpen" class="thinking-menu">
      <ul
        ref="listRef"
        class="thinking-list"
        tabindex="-1"
        role="listbox"
        aria-label="Thinking level options"
        @keydown="handleListKeydown"
      >
        <li
          v-for="(option, index) in THINKING_LEVEL_OPTIONS"
          :key="option.value"
          class="thinking-list-item"
        >
          <button
            class="thinking-option"
            :type="'button'"
            :class="{
              highlighted: index === highlightedIndex,
              selected: option.value === selectedLevel,
            }"
            role="option"
            :aria-selected="option.value === selectedLevel"
            @click="selectLevel(option.value)"
            @mouseenter="highlightedIndex = index"
          >
            <span class="thinking-option-label">{{ option.label }}</span>
            <Check
              v-if="option.value === selectedLevel"
              class="thinking-option-check"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.thinking-dropdown {
  position: relative;
  flex-shrink: 0;
}

.thinking-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
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
    opacity 0.15s ease;
}

.thinking-trigger:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  color: var(--text);
}

.thinking-trigger[aria-expanded="true"] {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border-strong));
  background: var(--surface-active);
  color: var(--text);
}

.thinking-trigger:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
  color: var(--text);
}

.thinking-trigger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.thinking-trigger-label {
  display: inline-flex;
  align-items: center;
  color: var(--text-subtle);
  font-family: var(--pi-font-sans);
  font-size: 0.64rem;
  line-height: 1.2;
  white-space: nowrap;
}

.thinking-trigger-value {
  min-width: 0;
  color: var(--text);
  font-family: var(--pi-font-mono);
  font-size: 0.64rem;
  line-height: 1.2;
  white-space: nowrap;
}

.thinking-trigger-caret {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  color: var(--text-subtle);
}

.thinking-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  width: 156px;
  padding: 6px;
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel) 97%, transparent),
    var(--bg-elevated)
  );
  box-shadow: var(--shadow-floating);
  backdrop-filter: blur(18px);
  z-index: 18;
}

.thinking-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.thinking-list:focus {
  outline: none;
}

.thinking-list-item + .thinking-list-item {
  margin-top: 3px;
}

.thinking-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    transform 0.12s ease;
}

.thinking-option:hover,
.thinking-option.highlighted {
  background: var(--surface-hover);
  border-color: color-mix(in srgb, var(--border-strong) 84%, transparent);
  transform: translateX(1px);
}

.thinking-option.selected {
  background: var(--surface-selected);
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border-strong));
}

.thinking-option-label {
  font-family: var(--pi-font-mono);
  font-size: 0.72rem;
  color: var(--text);
}

.thinking-option-check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .thinking-menu {
    width: min(156px, calc(100vw - 24px));
  }
}
</style>
