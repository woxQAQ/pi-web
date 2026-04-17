<script setup lang="ts">
import { ArrowLeft, RefreshCw } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { TreeEntry } from "../composables/useBridgeClient";
import {
  filterTreeEntries,
  getTreeEntryDisplayParts,
  type TreeFilterMode,
} from "../utils/treeOutline";

const props = defineProps<{
  entries: readonly TreeEntry[];
  sessionLabel: string;
  sessionPath: string | null;
  isHistoricalView: boolean;
}>();

const emit = defineEmits<{
  back: [];
  select: [entryId: string];
  refresh: [];
}>();

const query = ref("");
const filterMode = ref<TreeFilterMode>("default");

const filterOptions: Array<{ mode: TreeFilterMode; label: string }> = [
  { mode: "default", label: "Default" },
  { mode: "no-tools", label: "No-tools" },
  { mode: "user-only", label: "User" },
  { mode: "labeled-only", label: "Labeled" },
  { mode: "all", label: "All" },
];

watch(
  () => props.sessionPath,
  () => {
    query.value = "";
    filterMode.value = "default";
  },
);

const filteredEntries = computed(() =>
  filterTreeEntries(props.entries, filterMode.value, query.value),
);
const activePathCount = computed(
  () => props.entries.filter(entry => entry.isOnActivePath).length,
);

function displayParts(entry: TreeEntry) {
  return getTreeEntryDisplayParts(entry);
}

function handleSelect(entryId: string) {
  if (props.isHistoricalView) return;
  emit("select", entryId);
}
</script>

<template>
  <div class="tree-rail">
    <header class="tree-header">
      <button
        class="nav-button"
        type="button"
        aria-label="Back to sessions"
        title="Back to sessions"
        @click="emit('back')"
      >
        <ArrowLeft aria-hidden="true" />
      </button>
      <div class="header-copy">
        <p class="header-kicker">Session outline</p>
        <h2 class="header-title">{{ sessionLabel }}</h2>
      </div>
      <button
        class="nav-button"
        type="button"
        aria-label="Refresh outline"
        title="Refresh outline"
        @click="emit('refresh')"
      >
        <RefreshCw aria-hidden="true" />
      </button>
    </header>

    <div class="tree-toolbar">
      <input
        v-model="query"
        class="search-input"
        type="search"
        placeholder="Search..."
      />
      <div class="filter-row">
        <button
          v-for="option in filterOptions"
          :key="option.mode"
          class="filter-chip"
          :class="{ active: filterMode === option.mode }"
          type="button"
          @click="filterMode = option.mode"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="tree-status">
      <span class="status-token"
        >{{ filteredEntries.length }} / {{ entries.length }} entries</span
      >
      <span class="status-token">{{ activePathCount }} on path</span>
      <span v-if="isHistoricalView" class="status-token warning"
        >Read only</span
      >
    </div>

    <p v-if="isHistoricalView" class="tree-note">
      Browsing a stored session snapshot. Navigation is disabled.
    </p>

    <ol v-if="filteredEntries.length > 0" class="tree-list">
      <li v-for="entry in filteredEntries" :key="entry.id" class="tree-row">
        <button
          class="tree-item"
          :class="[
            `role-${displayParts(entry).role}`,
            {
              active: entry.isActive,
              'in-path': entry.isOnActivePath,
              dimmed: !entry.isOnActivePath,
              readonly: isHistoricalView,
            },
          ]"
          type="button"
          :disabled="isHistoricalView"
          :title="displayParts(entry).title"
          @click="handleSelect(entry.id)"
        >
          <span class="tree-guides" aria-hidden="true">
            <span
              v-for="(column, index) in entry.trackColumns ?? []"
              :key="`${entry.id}-${index}`"
              class="track-column"
              :class="column"
            ></span>
          </span>
          <span class="tree-marker" aria-hidden="true"></span>
          <span class="tree-line">
            <span class="tree-role">{{ displayParts(entry).roleLabel }}</span>
            <span v-if="displayParts(entry).labelTag" class="tree-tag">
              {{ displayParts(entry).labelTag }}
            </span>
            <span class="tree-preview">{{
              displayParts(entry).previewText
            }}</span>
          </span>
          <span v-if="entry.isActive" class="tree-current">current</span>
        </button>
      </li>
    </ol>
    <div v-else class="empty-state">
      <p class="empty-title">No matching tree entries</p>
      <p class="empty-copy">Try another filter or search term.</p>
    </div>
  </div>
</template>

<style scoped>
.tree-rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 12px 10px 10px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--rail-bg) 96%, white 4%),
      color-mix(in srgb, var(--rail-bg) 90%, var(--panel) 10%)
    ),
    var(--rail-bg);
}

.tree-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 4px 6px 12px;
}

.nav-button {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  color: var(--text-subtle);
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease,
    transform 0.12s ease;
}

.nav-button:hover {
  background: var(--panel-2);
  border-color: var(--border-strong);
  color: var(--text);
  transform: translateY(-1px);
}

.nav-button svg {
  width: 15px;
  height: 15px;
}

.header-copy {
  min-width: 0;
}

.header-kicker,
.tree-role,
.tree-current,
.status-token,
.filter-chip {
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.header-kicker {
  margin: 0 0 4px;
  color: var(--text-subtle);
}

.header-title {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.3;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 6px 10px;
}

.search-input {
  height: 34px;
  width: 100%;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  padding: 0 11px;
  font-size: 0.82rem;
  outline: none;
}

.search-input:focus {
  border-color: var(--border-strong);
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--border-strong) 70%, transparent);
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.filter-chip {
  height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-subtle);
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}

.filter-chip:hover {
  background: var(--panel-2);
  border-color: var(--border-strong);
  color: var(--text-muted);
}

.filter-chip.active {
  background: color-mix(in srgb, var(--panel-3) 86%, transparent);
  border-color: color-mix(in srgb, var(--border-strong) 92%, transparent);
  color: var(--text);
}

.tree-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 6px 8px;
}

.status-token {
  display: inline-flex;
  align-items: center;
  min-height: 23px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 78%, transparent);
  color: var(--text-subtle);
}

.status-token.warning {
  color: var(--error-text);
  border-color: var(--error-border);
  background: color-mix(in srgb, var(--error-bg) 80%, transparent);
}

.tree-note {
  margin: 0;
  padding: 0 6px 10px;
  font-size: 0.73rem;
  line-height: 1.45;
  color: var(--text-subtle);
}

.tree-list {
  list-style: none;
  margin: 0;
  padding: 2px 4px 0 6px;
  overflow-y: auto;
  flex: 1;
}

.tree-row + .tree-row {
  margin-top: 1px;
}

.tree-item {
  width: 100%;
  min-height: 28px;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    opacity 0.12s ease;
}

.tree-item:hover {
  background: color-mix(in srgb, var(--panel-2) 72%, transparent);
}

.tree-item.readonly {
  cursor: default;
}

.tree-item.dimmed {
  opacity: 0.52;
}

.tree-item.in-path {
  opacity: 1;
  background: color-mix(in srgb, var(--panel) 66%, transparent);
}

.tree-item.active {
  background: color-mix(in srgb, var(--panel-3) 80%, transparent);
  border-color: color-mix(in srgb, var(--border-strong) 72%, transparent);
}

.tree-guides {
  display: inline-flex;
  align-items: stretch;
  height: 22px;
}

.track-column {
  position: relative;
  width: 13px;
  flex-shrink: 0;
}

.track-column.line::before,
.track-column.branch::before,
.track-column.branch-last::before {
  content: "";
  position: absolute;
  left: 50%;
  width: 1px;
  background: color-mix(in srgb, var(--border) 82%, transparent);
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
  width: 11px;
  height: 1px;
  background: color-mix(in srgb, var(--border) 82%, transparent);
}

.tree-marker {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-strong) 86%, transparent);
  flex-shrink: 0;
}

.tree-item.in-path .tree-marker {
  background: color-mix(in srgb, var(--text-muted) 84%, var(--text));
}

.tree-item.active .tree-marker,
.tree-item.role-user .tree-marker {
  background: var(--text);
}

.tree-line {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 7px;
  overflow: hidden;
  font-family: var(--pi-font-mono);
  font-size: 0.77rem;
  line-height: 1.2;
}

.tree-role {
  flex-shrink: 0;
  color: var(--text-subtle);
}

.tree-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.tree-tag {
  flex-shrink: 0;
  max-width: 8.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
  background: color-mix(in srgb, var(--panel) 90%, transparent);
  color: var(--text);
  font-size: 0.67rem;
  line-height: 1.2;
}

.tree-current {
  flex-shrink: 0;
  color: var(--text-subtle);
}

.tree-item.active .tree-preview,
.tree-item.active .tree-role,
.tree-item.role-user .tree-preview,
.tree-item.role-user .tree-role {
  color: var(--text);
}

.tree-item.role-assistant .tree-role {
  color: color-mix(in srgb, var(--text-subtle) 68%, var(--diff-added-accent));
}

.tree-item.role-tool .tree-role {
  color: color-mix(in srgb, var(--text-subtle) 88%, var(--border-strong));
}

.tree-item.role-meta .tree-role {
  color: color-mix(in srgb, var(--text-subtle) 76%, var(--text-muted));
}

.empty-state {
  margin: 8px 6px 0;
  padding: 14px 12px;
  border-radius: 10px;
  border: 1px dashed var(--border-strong);
  background: color-mix(in srgb, var(--panel) 58%, transparent);
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
</style>
