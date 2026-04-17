<script setup lang="ts">
import { RefreshCw, Plus } from "lucide-vue-next";
import SidebarJumpNavigator from "../components/SidebarJumpNavigator.vue";
import SessionRail from "../components/SessionRail.vue";
import type {
  SessionEntry,
  TreeEntry,
} from "../composables/useBridgeClient";

defineProps<{
  sessions: readonly SessionEntry[];
  treeEntries: readonly TreeEntry[];
  activeSessionId: string | null;
  runningSessionPath: string | null;
  sidebarOpen: boolean;
  isHistoricalView: boolean;
  hideTools: boolean;
}>();

const emit = defineEmits<{
  closeSidebar: [];
  selectSession: [sessionPath: string];
  refreshSessions: [];
  newSession: [];
  navigateTree: [entryId: string];
  toggleHideTools: [];
}>();
</script>

<template>
  <aside class="left-rail" :class="{ open: sidebarOpen }">
    <div class="rail-sections">
      <section class="sessions-section">
        <SessionRail
          :sessions="sessions"
          :active-session-id="activeSessionId"
          :running-session-path="runningSessionPath"
          @select="emit('selectSession', $event)"
        >
          <template #header-actions>
            <button
              class="tree-rail-button"
              type="button"
              aria-label="Refresh sessions"
              title="Refresh sessions"
              @click="emit('refreshSessions')"
            >
              <RefreshCw aria-hidden="true" />
            </button>
            <button
              class="tree-rail-button"
              type="button"
              aria-label="New session"
              title="New session"
              @click="emit('newSession')"
            >
              <Plus aria-hidden="true" />
            </button>
          </template>
        </SessionRail>
      </section>

      <section class="jump-section">
        <SidebarJumpNavigator
          :entries="treeEntries"
          :hide-tools="hideTools"
          :is-historical-view="isHistoricalView"
          @navigate="emit('navigateTree', $event)"
          @toggle-hide-tools="emit('toggleHideTools')"
        />
      </section>
    </div>
  </aside>
  <div class="rail-backdrop" @click="emit('closeSidebar')"></div>
</template>

<style scoped>
.left-rail {
  grid-column: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--rail-bg);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.rail-sections {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.sessions-section {
  flex: 0 0 clamp(160px, 32%, 280px);
  min-height: 160px;
}

.jump-section {
  flex: 1 1 auto;
  min-height: 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--rail-bg) 98%, transparent),
    color-mix(in srgb, var(--panel) 84%, transparent)
  );
}

:deep(.session-rail) {
  height: 100%;
}

.tree-rail-button {
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

.tree-rail-button:hover {
  background: var(--panel-2);
  border-color: var(--border-strong);
  color: var(--text-muted);
}

.tree-rail-button svg {
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
    width: min(88vw, 330px);
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
