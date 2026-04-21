<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import { Pencil, Trash2 } from "lucide-vue-next";
import type { SessionEntry } from "../composables/useBridgeClient";

const props = defineProps<{
  sessions: readonly SessionEntry[];
  activeSessionPath: string | null;
  runningSessionPaths: readonly string[];
}>();

const emit = defineEmits<{
  select: [sessionPath: string];
  rename: [payload: { sessionPath: string; name: string }];
  delete: [sessionPath: string];
}>();

/* ------------------------------------------------------------------
 * Context menu
 * ---------------------------------------------------------------- */
interface MenuState {
  visible: boolean;
  sessionPath: string | null;
  x: number;
  y: number;
  flipX: boolean;
  flipY: boolean;
}

const menu = ref<MenuState>({
  visible: false,
  sessionPath: null,
  x: 0,
  y: 0,
  flipX: false,
  flipY: false,
});

const MENU_WIDTH = 136;
const MENU_HEIGHT = 80; // approx

function openMenu(event: MouseEvent, sessionPath: string) {
  event.preventDefault();
  event.stopPropagation();

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let mx = event.clientX + 4;
  let my = event.clientY + 4;
  const flipX = mx + MENU_WIDTH > vw;
  const flipY = my + MENU_HEIGHT > vh;
  if (flipX) mx = event.clientX - MENU_WIDTH - 4;
  if (flipY) my = event.clientY - MENU_HEIGHT - 4;

  menu.value = {
    visible: true,
    sessionPath,
    x: mx,
    y: my,
    flipX,
    flipY,
  };
}

function closeMenu() {
  menu.value.visible = false;
}

watch(
  () => props.sessions.map(s => s.path).join(","),
  () => {
    closeMenu();
  },
);

/* ------------------------------------------------------------------
 * Rename inline
 * ---------------------------------------------------------------- */
const editingPath = ref<string | null>(null);
const editingName = ref("");
const editInputRef = ref<HTMLInputElement | null>(null);

function startRename(sessionPath: string) {
  const session = props.sessions.find(s => s.path === sessionPath);
  if (!session) return;
  editingPath.value = sessionPath;
  editingName.value = session.name;
  closeMenu();
  nextTick(() => {
    editInputRef.value?.focus();
    editInputRef.value?.select();
  });
}

function confirmRename() {
  const name = editingName.value.trim();
  if (editingPath.value && name) {
    emit("rename", { sessionPath: editingPath.value, name });
  }
  editingPath.value = null;
  editingName.value = "";
}

function cancelRename() {
  editingPath.value = null;
  editingName.value = "";
}

/* ------------------------------------------------------------------
 * Delete
 * ---------------------------------------------------------------- */
function handleDelete(sessionPath: string) {
  closeMenu();
  if (!confirm("Delete this session? This cannot be undone.")) return;
  emit("delete", sessionPath);
}

function handleClick(sessionPath: string) {
  if (editingPath.value === sessionPath) return;
  emit("select", sessionPath);
}

/* ------------------------------------------------------------------
 * Menu position style (fixed overlay + positioned panel)
 * ---------------------------------------------------------------- */
const menuPanelStyle = computed(() => ({
  left: `${menu.value.x}px`,
  top: `${menu.value.y}px`,
}));
</script>

<template>
  <div class="session-rail" @click="closeMenu">
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
        :class="{
          active: s.path === activeSessionPath,
          running: runningSessionPaths.includes(s.path),
        }"
        :title="s.path"
        @click="handleClick(s.path)"
        @contextmenu.prevent="openMenu($event, s.path)"
      >
        <span class="item-indicator"></span>

        <template v-if="editingPath === s.path">
          <input
            ref="editInputRef"
            v-model="editingName"
            class="item-input"
            type="text"
            @keydown.enter.prevent="confirmRename"
            @keydown.esc.prevent="cancelRename"
            @blur="confirmRename"
            @click.stop
          />
        </template>
        <template v-else>
          <span class="item-label">{{ s.name }}</span>
        </template>

        <span
          v-if="runningSessionPaths.includes(s.path)"
          class="item-status"
          role="status"
          aria-label="Agent running"
          title="Agent running"
        >
          <span class="item-status-dot" aria-hidden="true"></span>
        </span>
      </li>
    </ul>
    <p v-else class="rail-empty">No sessions</p>

    <!-- Global overlay so clicking anywhere dismisses the menu -->
    <div
      v-if="menu.visible"
      class="menu-overlay"
      @click.stop="closeMenu"
      @contextmenu.prevent.stop="closeMenu"
    >
      <div
        class="menu-panel"
        :class="{ show: menu.visible }"
        :style="menuPanelStyle"
        @click.stop
      >
        <button
          class="menu-item"
          type="button"
          @click="startRename(menu.sessionPath!)"
        >
          <Pencil class="menu-icon" aria-hidden="true" />
          <span>Rename</span>
        </button>
        <div class="menu-divider"></div>
        <button
          class="menu-item danger"
          type="button"
          @click="handleDelete(menu.sessionPath!)"
        >
          <Trash2 class="menu-icon" aria-hidden="true" />
          <span>Delete</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-rail {
  display: flex;
  flex-direction: column;
  padding: 0px 10px 0;
  overflow: hidden;
  position: relative;
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
  position: relative;
  user-select: none;
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

.rail-item.running .item-indicator {
  background: var(--diff-added-accent);
}

.item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--panel);
  color: var(--text);
  font-size: 0.82rem;
  outline: none;
}

.item-input:focus {
  border-color: var(--diff-added-accent);
  box-shadow: 0 0 0 1px
    color-mix(in srgb, var(--diff-added-accent) 30%, transparent);
}

.item-status {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.item-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--diff-added-accent);
  box-shadow: 0 0 0 0
    color-mix(in srgb, var(--diff-added-accent) 34%, transparent);
  animation:
    session-running-blink 1.1s ease-in-out infinite,
    session-running-ping 1.8s ease-out infinite;
}

.rail-empty {
  margin: 0;
  padding: 8px 10px;
  font-size: 0.78rem;
  color: var(--text-subtle);
}

@keyframes session-running-blink {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.38;
    transform: scale(0.86);
  }
}

@keyframes session-running-ping {
  0% {
    box-shadow: 0 0 0 0
      color-mix(in srgb, var(--diff-added-accent) 34%, transparent);
  }
  75% {
    box-shadow: 0 0 0 6px
      color-mix(in srgb, var(--diff-added-accent) 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0
      color-mix(in srgb, var(--diff-added-accent) 0%, transparent);
  }
}

/* ------------------------------------------------------------------
 * Context menu
 * ---------------------------------------------------------------- */
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: transparent;
}

.menu-panel {
  position: fixed;
  min-width: 136px;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel-2) 98%, white 2%);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--border) 50%, transparent),
    0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 1px;
  opacity: 0;
  transform: scale(0.96);
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
  pointer-events: auto;
}

.menu-panel.show {
  opacity: 1;
  transform: scale(1);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.78rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease, color 0.1s ease;
}

.menu-item:hover {
  background: var(--panel-3);
  color: var(--text);
}

.menu-item.danger {
  color: var(--text-muted);
}

.menu-item.danger:hover {
  background: var(--error-bg);
  color: var(--error-text);
}

.menu-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  opacity: 0.7;
}

.menu-item:hover .menu-icon {
  opacity: 1;
}

.menu-divider {
  height: 1px;
  margin: 1px 6px;
  background: var(--border);
  opacity: 0.6;
}
</style>
