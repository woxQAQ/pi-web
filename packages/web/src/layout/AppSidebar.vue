<script setup lang="ts">
import { Plus, RefreshCw } from "lucide-vue-next";
import SessionRail from "../components/SessionRail.vue";
import type { SessionEntry } from "../composables/useBridgeClient";

defineProps<{
  sessions: readonly SessionEntry[];
  activeSessionPath: string | null;
  runningSessionPaths: readonly string[];
  sidebarOpen: boolean;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  closeSidebar: [];
  selectSession: [sessionPath: string];
  refreshSessions: [];
  newSession: [];
  renameSession: [sessionPath: string, name: string];
  deleteSession: [sessionPath: string];
}>();
</script>

<template>
  <aside class="left-rail" :class="{ open: sidebarOpen, collapsed }">
    <SessionRail
      class="expanded-rail"
      :sessions="sessions"
      :active-session-path="activeSessionPath"
      :running-session-paths="runningSessionPaths"
      @select="emit('selectSession', $event)"
      @rename="emit('renameSession', $event.sessionPath, $event.name)"
      @delete="emit('deleteSession', $event)"
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
  </aside>
  <div class="rail-backdrop" @click="emit('closeSidebar')"></div>
</template>

<style scoped>
.left-rail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--rail-bg);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.left-rail.collapsed {
  display: none;
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

  .left-rail.collapsed {
    display: flex;
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
