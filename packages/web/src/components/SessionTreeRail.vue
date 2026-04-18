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
  { mode: "no-tools", label: "No tools" },
  { mode: "user-only", label: "User" },
  { mode: "labeled-only", label: "Labels" },
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

function displayParts(entry: TreeEntry) {
  return getTreeEntryDisplayParts(entry);
}

function handleSelect(entryId: string) {
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
            },
          ]"
          type="button"
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
  padding: 10px 8px 8px;
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
  gap: 8px;
  align-items: start;
  padding: 2px 4px 8px;
}

.nav-button {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
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
  width: 14px;
  height: 14px;
}

.header-copy {
  min-width: 0;
}

.header-kicker,
.tree-role,
.tree-current {
  font-size: 0.63rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.filter-chip {
  font-size: 0.6rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.header-kicker {
  margin: 0 0 2px;
  color: var(--text-subtle);
}

.header-title {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.2;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 4px 8px;
}

.search-input {
  height: 30px;
  width: 100%;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  padding: 0 10px;
  font-size: 0.78rem;
  outline: none;
}

.search-input:focus {
  border-color: var(--border-strong);
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--border-strong) 70%, transparent);
}

.filter-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 1px;
  scrollbar-width: none;
}

.filter-row::-webkit-scrollbar {
  display: none;
}

.filter-chip {
  height: 24px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-subtle);
  white-space: nowrap;
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

.tree-list {
  list-style: none;
  margin: 0;
  padding: 0 2px 0 4px;
  overflow-y: auto;
  flex: 1;
}

.tree-row + .tree-row {
  margin-top: 0;
}

.tree-item {
  width: 100%;
  min-height: 24px;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  box-shadow: none;
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

.tree-item.dimmed {
  opacity: 0.52;
}

.tree-item.in-path {
  opacity: 1;
  background: transparent;
}

.tree-item.active {
  background: color-mix(in srgb, var(--panel-3) 56%, transparent);
  border-color: color-mix(in srgb, var(--border-strong) 60%, transparent);
}

.tree-guides {
  display: inline-flex;
  align-items: stretch;
  height: 18px;
}

.track-column {
  position: relative;
  width: 11px;
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
  top: -8px;
  bottom: -8px;
}

.track-column.branch-last::before {
  top: -8px;
  height: calc(50% + 1px);
}

.track-column.branch::after,
.track-column.branch-last::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 9px;
  height: 1px;
  background: color-mix(in srgb, var(--border) 82%, transparent);
}

.tree-marker {
  width: 6px;
  height: 6px;
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
  gap: 6px;
  overflow: hidden;
  font-family: var(--pi-font-mono);
  font-size: 0.73rem;
  line-height: 1.15;
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
  max-width: 8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 5px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
  background: color-mix(in srgb, var(--panel) 90%, transparent);
  color: var(--text);
  font-size: 0.62rem;
  line-height: 1.15;
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
  margin: 6px 4px 0;
  padding: 12px 10px;
  border-radius: 9px;
  border: 1px dashed var(--border-strong);
  background: color-mix(in srgb, var(--panel) 58%, transparent);
}

.empty-title {
  margin: 0 0 3px;
  font-size: 0.78rem;
  color: var(--text);
}

.empty-copy {
  margin: 0;
  font-size: 0.71rem;
  line-height: 1.4;
  color: var(--text-subtle);
}
</style>
