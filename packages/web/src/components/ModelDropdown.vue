<script setup lang="ts">
import { Bot, Check, Search } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { filterModels, getModelKey, type RpcModelInfo } from "../utils/models";

const props = defineProps<{
  models: RpcModelInfo[];
  selectedModel: RpcModelInfo | null;
  label?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [model: RpcModelInfo];
}>();

const rootRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const searchText = ref("");
const highlightedIndex = ref(0);

const hasModels = computed(() => props.models.length > 0);
const selectedKey = computed(() =>
  props.selectedModel ? getModelKey(props.selectedModel) : "",
);
const filteredModels = computed(() =>
  filterModels(props.models, searchText.value),
);
const triggerTitle = computed(() => {
  if (!props.selectedModel)
    return hasModels.value ? "Select Pi model" : "No Pi models available";
  return `${props.selectedModel.name} (${props.selectedModel.provider}/${props.selectedModel.id})`;
});

function syncHighlightedIndex() {
  if (filteredModels.value.length === 0) {
    highlightedIndex.value = 0;
    return;
  }

  const selectedIndex = filteredModels.value.findIndex(
    (model) => getModelKey(model) === selectedKey.value,
  );
  highlightedIndex.value = selectedIndex >= 0 ? selectedIndex : 0;
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
  if (props.disabled || !hasModels.value) return;
  isOpen.value = true;
  searchText.value = "";
  syncHighlightedIndex();
  await nextTick();
  searchInputRef.value?.focus();
  scrollToHighlighted();
}

function closeDropdown() {
  isOpen.value = false;
  searchText.value = "";
}

function toggleDropdown() {
  if (isOpen.value) {
    closeDropdown();
    return;
  }
  void openDropdown();
}

function selectModel(model: RpcModelInfo) {
  emit("select", model);
  closeDropdown();
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (!isOpen.value) return;

  if (filteredModels.value.length === 0) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown();
    }
    return;
  }

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      highlightedIndex.value =
        (highlightedIndex.value + 1) % filteredModels.value.length;
      scrollToHighlighted();
      break;
    case "ArrowUp":
      event.preventDefault();
      highlightedIndex.value =
        (highlightedIndex.value - 1 + filteredModels.value.length) %
        filteredModels.value.length;
      scrollToHighlighted();
      break;
    case "Enter": {
      event.preventDefault();
      const model = filteredModels.value[highlightedIndex.value];
      if (model) selectModel(model);
      break;
    }
    case "Escape":
      event.preventDefault();
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

watch(isOpen, (open) => {
  if (typeof document === "undefined") return;
  if (open) {
    document.addEventListener("mousedown", handleDocumentMousedown);
    return;
  }
  document.removeEventListener("mousedown", handleDocumentMousedown);
});

watch(searchText, () => {
  highlightedIndex.value = 0;
  scrollToHighlighted();
});

watch(
  () => props.selectedModel,
  () => {
    if (!isOpen.value) return;
    syncHighlightedIndex();
    scrollToHighlighted();
  },
);

watch(filteredModels, () => {
  if (highlightedIndex.value >= filteredModels.value.length) {
    highlightedIndex.value = Math.max(0, filteredModels.value.length - 1);
  }
  scrollToHighlighted();
});

onBeforeUnmount(() => {
  if (typeof document !== "undefined") {
    document.removeEventListener("mousedown", handleDocumentMousedown);
  }
});
</script>

<template>
  <div ref="rootRef" class="model-dropdown">
    <button
      class="model-trigger"
      :type="'button'"
      :disabled="disabled || !hasModels"
      :title="triggerTitle"
      :aria-expanded="isOpen"
      aria-haspopup="dialog"
      @click="toggleDropdown"
    >
      <Bot class="model-trigger-icon" aria-hidden="true" />
      <span v-if="label" class="model-trigger-label">{{ label }}</span>
      <span v-else class="sr-only">Select model</span>
    </button>

    <div v-if="isOpen" class="model-menu">
      <label class="model-search">
        <Search class="model-search-icon" aria-hidden="true" />
        <input
          ref="searchInputRef"
          v-model="searchText"
          class="model-search-input"
          type="text"
          placeholder="Search models"
          @keydown="handleSearchKeydown"
        />
      </label>

      <ul v-if="filteredModels.length > 0" ref="listRef" class="model-list">
        <li
          v-for="(model, index) in filteredModels"
          :key="getModelKey(model)"
          class="model-list-item"
        >
          <button
            class="model-option"
            :type="'button'"
            :class="{
              highlighted: index === highlightedIndex,
              selected: getModelKey(model) === selectedKey,
            }"
            @click="selectModel(model)"
            @mouseenter="highlightedIndex = index"
          >
            <div class="model-option-copy">
              <span class="model-option-name">{{ model.name }}</span>
              <span class="model-option-meta"
                >{{ model.provider }}/{{ model.id }}</span
              >
            </div>
            <Check
              v-if="getModelKey(model) === selectedKey"
              class="model-option-check"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
      <div v-else class="model-empty">No matching models</div>
    </div>
  </div>
</template>

<style scoped>
.model-dropdown {
  position: relative;
  flex-shrink: 0;
}

.model-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: min(100%, 520px);
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  background: color-mix(in srgb, var(--panel) 70%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.model-trigger:hover:not(:disabled),
.model-trigger[aria-expanded="true"] {
  background: var(--panel-2);
  border-color: var(--border-strong);
  color: var(--text);
  transform: translateY(-1px);
}

.model-trigger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.model-trigger-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.model-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: "SF Mono", "Monaco", "Menlo", monospace;
  font-size: 0.66rem;
}

.model-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 12px);
  width: min(360px, calc(100vw - 48px));
  padding: 10px;
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel) 97%, transparent),
    var(--bg-elevated)
  );
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
  z-index: 18;
}

.model-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px;
  margin-bottom: 8px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
}

.model-search:focus-within {
  border-color: var(--border-strong);
  background: var(--panel);
}

.model-search-icon {
  width: 14px;
  height: 14px;
  color: var(--text-subtle);
  flex-shrink: 0;
}

.model-search-input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 0.82rem;
  outline: none;
}

.model-search-input::placeholder {
  color: var(--text-subtle);
}

.model-list {
  max-height: 280px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}

.model-list-item + .model-list-item {
  margin-top: 4px;
}

.model-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 11px 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    transform 0.12s ease;
}

.model-option:hover,
.model-option.highlighted {
  background: var(--panel-2);
  border-color: color-mix(in srgb, var(--border-strong) 84%, transparent);
  transform: translateX(1px);
}

.model-option.selected {
  background: color-mix(in srgb, var(--panel-2) 82%, var(--button-bg));
  border-color: color-mix(in srgb, var(--border-strong) 90%, transparent);
}

.model-option-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.model-option-name,
.model-option-meta,
.model-empty {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option-name {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text);
}

.model-option-meta {
  font-family: "SF Mono", "Monaco", "Menlo", monospace;
  font-size: 0.66rem;
  color: var(--text-subtle);
}

.model-option-check {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.model-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  border-radius: 12px;
  font-size: 0.78rem;
  color: var(--text-subtle);
  background: color-mix(in srgb, var(--panel-2) 60%, transparent);
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
