<script setup lang="ts">
import SessionTreeRail from "../components/SessionTreeRail.vue";
import type { TreeEntry } from "../composables/useBridgeClient";

defineProps<{
  treeEntries: readonly TreeEntry[];
  sidebarOpen: boolean;
  sessionLabel: string;
  sessionPath: string | null;
}>();

const emit = defineEmits<{
  closeSidebar: [];
  selectTreeEntry: [entryId: string];
  refreshTree: [];
}>();
</script>

<template>
  <aside class="right-rail" :class="{ open: sidebarOpen }">
    <div class="rail-panel">
      <SessionTreeRail
        :entries="treeEntries"
        :session-label="sessionLabel"
        :session-path="sessionPath"
        @select="emit('selectTreeEntry', $event)"
        @refresh="emit('refreshTree')"
      />
    </div>
  </aside>
  <div class="rail-backdrop" @click="emit('closeSidebar')"></div>
</template>

<style scoped>
.right-rail {
  grid-column: 2;
  min-width: 0;
  height: 100%;
  background: var(--rail-bg);
  border-left: 1px solid var(--border);
  overflow: hidden;
}

.rail-panel {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.rail-backdrop {
  display: none;
}

@media (max-width: 900px) {
  .right-rail {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(100vw, 420px);
    max-width: 100vw;
    transform: translateX(100%);
    transition: transform 0.2s ease;
    z-index: 15;
  }

  .right-rail.open {
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
    transition: opacity 0.2s ease;
  }

  .right-rail.open ~ .rail-backdrop {
    pointer-events: auto;
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .right-rail {
    width: 100vw;
    border-left: none;
  }
}
</style>
