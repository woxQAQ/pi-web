<script setup lang="ts">
import type { SessionEntry } from "../composables/useBridgeClient";

defineProps<{
  sessions: readonly SessionEntry[];
  activeSessionId: string | null;
}>();

const emit = defineEmits<{
  select: [sessionId: string];
}>();
</script>

<template>
  <div class="session-rail">
    <div class="rail-header">
      <span class="rail-title">Sessions</span>
      <div class="rail-actions">
        <slot name="header-actions"></slot>
      </div>
    </div>
    <ul v-if="sessions.length > 0" class="rail-list">
      <li
        v-for="s in sessions"
        :key="s.id"
        class="rail-item"
        :class="{ active: s.id === activeSessionId }"
        :title="s.path"
        @click="emit('select', s.path)"
      >
        <span class="item-indicator"></span>
        <span class="item-label">{{ s.name }}</span>
      </li>
    </ul>
    <p v-else class="rail-empty">No sessions</p>
  </div>
</template>

<style scoped>
.session-rail {
  display: flex;
  flex-direction: column;
  padding: 12px 10px 0;
  overflow: hidden;
}

.rail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  color: var(--text-subtle);
  flex-shrink: 0;
}

.rail-title {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.rail-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.rail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

.rail-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.82rem;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.rail-item:hover {
  background: var(--panel-2);
}

.rail-item.active {
  background: var(--panel-3);
  color: var(--text);
}

.item-indicator {
  width: 2px;
  height: 14px;
  border-radius: 999px;
  background: transparent;
  flex-shrink: 0;
}

.rail-item.active .item-indicator {
  background: var(--text);
}

.item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-empty {
  margin: 0;
  padding: 8px 10px;
  font-size: 0.78rem;
  color: var(--text-subtle);
}
</style>
