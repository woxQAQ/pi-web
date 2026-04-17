<script setup lang="ts">
import { Bot, EyeOff, Search, UserRound } from "lucide-vue-next";
import { computed, ref } from "vue";
import type { TreeEntry } from "../composables/useBridgeClient";
import {
  treeEntryMessageRole,
  treeEntryPreviewText,
} from "../utils/treeNavigation";

const props = defineProps<{
  entries: readonly TreeEntry[];
  hideTools: boolean;
  isHistoricalView: boolean;
}>();

const emit = defineEmits<{
  navigate: [entryId: string];
  toggleHideTools: [];
}>();

const query = ref("");

const jumpEntries = computed(() =>
  props.entries.flatMap(entry => {
    const role = treeEntryMessageRole(entry);
    if (!role) return [];
    return [
      {
        entry,
        role,
        label: treeEntryPreviewText(entry) || entry.id,
      },
    ];
  }),
);

const filteredEntries = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase();
  if (!normalizedQuery) return jumpEntries.value;

  return jumpEntries.value.filter(item => {
    const haystack = `${item.role} ${item.label}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
});

const activePathCount = computed(
  () => jumpEntries.value.filter(item => item.entry.isOnActivePath).length,
);

function roleLabel(role: "user" | "assistant"): string {
  return role === "user" ? "User" : "Assistant";
}

function handleNavigate(entryId: string) {
  emit("navigate", entryId);
}
</script>

<template>
  <div class="jump-navigator">
    <div class="jump-header">
      <div class="jump-heading">
        <p class="jump-kicker">Jump rail</p>
        <h2 class="jump-title">Conversation map</h2>
      </div>
      <button
        class="conversation-toggle"
        :class="{ active: hideTools }"
        type="button"
        :aria-pressed="hideTools"
        :title="
          hideTools
            ? 'Showing only user and assistant messages'
            : 'Show tool traces in the transcript'
        "
        @click="emit('toggleHideTools')"
      >
        <EyeOff aria-hidden="true" />
        <span>{{ hideTools ? "Conversation only" : "Show tools" }}</span>
      </button>
    </div>

    <div class="jump-toolbar">
      <div class="jump-status-line">
        <span class="status-token">{{ jumpEntries.length }} jumps</span>
        <span class="status-token">{{ activePathCount }} on path</span>
        <span v-if="isHistoricalView" class="status-token warning"
          >Local jumps only</span
        >
      </div>
      <label class="search-shell">
        <Search aria-hidden="true" />
        <input
          v-model="query"
          class="search-input"
          type="search"
          placeholder="Jump to a message"
        />
      </label>
    </div>

    <p v-if="isHistoricalView" class="jump-note">
      Stored session snapshot. You can jump within the loaded branch, but branch
      switching is disabled.
    </p>

    <ol v-if="filteredEntries.length > 0" class="jump-list">
      <li v-for="item in filteredEntries" :key="item.entry.id" class="jump-row">
        <button
          class="jump-item"
          :class="{
            active: item.entry.isActive,
            path: item.entry.isOnActivePath,
            user: item.role === 'user',
            assistant: item.role === 'assistant',
          }"
          type="button"
          :title="item.label"
          @click="handleNavigate(item.entry.id)"
        >
          <span class="jump-guides" aria-hidden="true">
            <span
              v-for="(column, index) in item.entry.trackColumns ?? []"
              :key="`${item.entry.id}-${index}`"
              class="track-column"
              :class="column"
            ></span>
          </span>
          <span class="jump-icon" :class="item.role">
            <UserRound v-if="item.role === 'user'" aria-hidden="true" />
            <Bot v-else aria-hidden="true" />
          </span>
          <span class="jump-copy">
            <span class="jump-role">{{ roleLabel(item.role) }}</span>
            <span class="jump-label">{{ item.label }}</span>
          </span>
          <span v-if="item.entry.isActive" class="jump-current">Now</span>
        </button>
      </li>
    </ol>
    <div v-else class="empty-state">
      <p class="empty-title">No matching jumps</p>
      <p class="empty-copy">Try another message keyword.</p>
    </div>
  </div>
</template>

<style scoped>
.jump-navigator {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 14px 10px 12px;
  gap: 12px;
}

.jump-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.jump-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.jump-kicker,
.status-token,
.jump-role,
.jump-current {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.jump-kicker {
  margin: 0;
  color: var(--text-subtle);
}

.jump-title {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.25;
  color: var(--text);
}

.conversation-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel) 94%, transparent),
    color-mix(in srgb, var(--panel-2) 86%, transparent)
  );
  color: var(--text-subtle);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease,
    box-shadow 0.16s ease;
}

.conversation-toggle:hover,
.conversation-toggle:focus-visible {
  border-color: var(--border-strong);
  color: var(--text);
  transform: translateY(-1px);
}

.conversation-toggle.active {
  color: var(--text);
  border-color: color-mix(in srgb, var(--border-strong) 86%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel-3) 84%, transparent),
    color-mix(in srgb, var(--panel-2) 92%, transparent)
  );
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--text) 10%, transparent),
    0 12px 24px rgba(0, 0, 0, 0.08);
}

.conversation-toggle svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.jump-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.jump-status-line {
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

.search-shell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
}

.search-shell svg {
  width: 14px;
  height: 14px;
  color: var(--text-subtle);
  flex-shrink: 0;
}

.search-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 0.8rem;
}

.search-input::placeholder {
  color: var(--text-subtle);
}

.jump-note {
  margin: -2px 0 0;
  font-size: 0.74rem;
  line-height: 1.45;
  color: var(--text-subtle);
}

.jump-list {
  list-style: none;
  margin: 0;
  padding: 2px 0 0;
  overflow-y: auto;
  flex: 1;
}

.jump-row + .jump-row {
  margin-top: 6px;
}

.jump-item {
  width: 100%;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 48px;
  padding: 10px 10px 10px 8px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel) 96%, transparent),
    color-mix(in srgb, var(--panel-2) 88%, transparent)
  );
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background 0.14s ease,
    transform 0.14s ease,
    box-shadow 0.14s ease;
}

.jump-item:hover,
.jump-item:focus-visible {
  border-color: var(--border-strong);
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.08);
}

.jump-item.path {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel-2) 94%, transparent),
    color-mix(in srgb, var(--panel-3) 72%, transparent)
  );
}

.jump-item.active {
  border-color: color-mix(in srgb, var(--border-strong) 92%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--text) 10%, transparent),
    0 16px 32px rgba(0, 0, 0, 0.1);
}

.jump-item.user {
  border-left: 2px solid color-mix(in srgb, var(--text) 18%, transparent);
}

.jump-item.assistant {
  border-left: 2px solid color-mix(in srgb, var(--border-strong) 82%, transparent);
}

.jump-guides {
  display: inline-flex;
  align-items: stretch;
  align-self: stretch;
  min-height: 100%;
}

.track-column {
  position: relative;
  width: 12px;
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
  top: -12px;
  bottom: -12px;
}

.track-column.branch-last::before {
  top: -12px;
  height: calc(50% + 1px);
}

.track-column.branch::after,
.track-column.branch-last::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 1px;
  background: color-mix(in srgb, var(--border) 76%, transparent);
}

.jump-icon {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel-3) 68%, transparent);
  color: var(--text-muted);
  flex-shrink: 0;
}

.jump-icon.user {
  color: var(--text);
}

.jump-icon svg {
  width: 14px;
  height: 14px;
}

.jump-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.jump-role {
  color: var(--text-subtle);
}

.jump-label {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 0.82rem;
  line-height: 1.4;
  color: var(--text-muted);
}

.jump-item.active .jump-label,
.jump-item.active .jump-role,
.jump-item.user .jump-label {
  color: var(--text);
}

.jump-current {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 84%, transparent);
  background: color-mix(in srgb, var(--panel-3) 90%, transparent);
  color: var(--text);
}

.empty-state {
  margin-top: 2px;
  padding: 14px;
  border-radius: 14px;
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
  .jump-navigator {
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
  }
}
</style>
