<script setup lang="ts">
import { Plus, RefreshCw } from "lucide-vue-next";
import SessionRail from "../components/SessionRail.vue";
import SessionTreeRail from "../components/SessionTreeRail.vue";
import type { SessionEntry, TreeEntry } from "../composables/useBridgeClient";

defineProps<{
  sessions: readonly SessionEntry[];
  treeEntries: readonly TreeEntry[];
  activeSessionId: string | null;
  runningSessionPath: string | null;
  sidebarOpen: boolean;
  sidebarView: "sessions" | "tree";
  sessionLabel: string;
  sessionPath: string | null;
  isHistoricalView: boolean;
}>();

const emit = defineEmits<{
  closeSidebar: [];
  selectSession: [sessionPath: string];
  selectTreeEntry: [entryId: string];
  backToSessions: [];
  refreshSessions: [];
  refreshTree: [];
  newSession: [];
}>();
</script>

<template>
  <aside class="left-rail" :class="{ open: sidebarOpen }">
    <SessionRail
      v-if="sidebarView === 'sessions'"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :running-session-path="runningSessionPath"
      @select="emit('selectSession', $event)"
    >
      <template #header-actions>
        <button
          class="rail-button"
          type="button"
          aria-label="Refresh sessions"
          title="Refresh sessions"
          @click="emit('refreshSessions')"
        >
          <RefreshCw aria-hidden="true" />
        </button>
        <button
          class="rail-button"
          type="button"
          aria-label="New session"
          title="New session"
          @click="emit('newSession')"
        >
          <Plus aria-hidden="true" />
        </button>
      </template>
    </SessionRail>

    <SessionTreeRail
      v-else
      :entries="treeEntries"
      :session-label="sessionLabel"
      :session-path="sessionPath"
      :is-historical-view="isHistoricalView"
      @back="emit('backToSessions')"
      @select="emit('selectTreeEntry', $event)"
      @refresh="emit('refreshTree')"
    />
  </aside>
  <div class="rail-backdrop" @click="emit('closeSidebar')"></div>
</template>

<style scoped>
.left-rail {
  grid-column: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--rail-bg);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.rail-button {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-subtle);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.rail-button:hover {
  background: var(--panel-2);
  border-color: var(--border-strong);
  color: var(--text-muted);
}

.rail-button svg {
  width: 16px;
  height: 16px;
}

.rail-backdrop {
  display: none;
}

@media (max-width: 900px) {
  .left-rail {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(88vw, 360px);
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    z-index: 15;
  }

  .left-rail.open {
    transform: translateX(0);
    box-shadow: var(--shadow);
  }

  .rail-backdrop {
    display: block;
    position: absolute;
    inset: 0;
    background: var(--backdrop);
    z-index: 14;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .left-rail.open ~ .rail-backdrop {
    pointer-events: auto;
    opacity: 1;
  }
}
</style>
