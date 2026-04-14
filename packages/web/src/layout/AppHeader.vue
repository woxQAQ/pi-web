<script setup lang="ts">
import { Bug, Menu, Moon, Sun } from "lucide-vue-next";
import type { ConnectionStatus } from "../composables/useBridgeClient";

defineProps<{
  theme: "dark" | "light";
  nextThemeLabel: "dark" | "light";
  debugMode: boolean;
  debugModeLabel: string;
  activeSessionLabel: string;
  networkUrl: string;
  connectionStatus: ConnectionStatus;
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  toggleTheme: [];
  toggleDebugMode: [];
}>();
</script>

<template>
  <header class="app-header">
    <button
      class="hamburger"
      aria-label="Toggle sidebar"
      @click="emit('toggleSidebar')"
    >
      <Menu class="hamburger-icon" aria-hidden="true" />
    </button>
    <div class="header-brand">
      <h1 class="app-title">Pi</h1>
    </div>
    <div class="header-session">
      <span class="session-kicker">session</span>
      <span class="session-name">{{ activeSessionLabel }}</span>
    </div>
    <div class="header-status">
      <span v-if="networkUrl" class="network-url">{{ networkUrl }}</span>
      <button
        class="debug-toggle"
        :class="{ active: debugMode }"
        type="button"
        :aria-label="debugModeLabel"
        :title="debugModeLabel"
        @click="emit('toggleDebugMode')"
      >
        <Bug class="debug-icon" aria-hidden="true" />
        <span class="debug-label">Debug</span>
      </button>
      <button
        class="theme-toggle"
        type="button"
        :aria-label="`Switch to ${nextThemeLabel} theme`"
        :title="`Switch to ${nextThemeLabel} theme`"
        @click="emit('toggleTheme')"
      >
        <Sun v-if="theme === 'dark'" class="theme-icon" aria-hidden="true" />
        <Moon v-else class="theme-icon" aria-hidden="true" />
      </button>
      <span
        class="connection-indicator"
        :class="connectionStatus"
        :title="`Connection: ${connectionStatus}`"
      >
        <span class="indicator-dot"></span>
        {{
          connectionStatus === "connected"
            ? "Connected"
            : connectionStatus === "connecting"
              ? "Syncing..."
              : "Offline"
        }}
      </span>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
  z-index: 20;
}

.hamburger {
  display: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  margin-left: -6px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}

.hamburger-icon {
  width: 18px;
  height: 18px;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-title {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--text);
}

.header-session {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.session-kicker {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
  white-space: nowrap;
}

.session-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.header-status {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-self: end;
}

.network-url,
.connection-indicator,
.debug-toggle,
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  font-size: 0.72rem;
  color: var(--text-subtle);
}

.debug-toggle,
.theme-toggle {
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.debug-toggle {
  padding-right: 12px;
}

.debug-toggle:hover,
.theme-toggle:hover {
  background: var(--panel-2);
  border-color: var(--border-strong);
  color: var(--text-muted);
  transform: translateY(-1px);
}

.debug-toggle.active {
  border-color: var(--border-strong);
  color: var(--text);
  background: var(--panel-2);
}

.theme-toggle {
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
}

.debug-icon,
.theme-icon {
  width: 16px;
  height: 16px;
}

.connection-indicator.connected,
.connection-indicator.connecting,
.connection-indicator.disconnected {
  color: var(--text-muted);
}

.indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
  opacity: 0.9;
}

.connection-indicator.disconnected .indicator-dot {
  opacity: 0.45;
}

.connection-indicator.connecting .indicator-dot {
  animation: sync-pulse 1.2s ease-in-out infinite;
}

@keyframes sync-pulse {
  0%,
  100% {
    transform: scale(0.85);
    opacity: 0.45;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (max-width: 900px) {
  .hamburger {
    display: flex;
  }

  .app-header {
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px;
    padding-top: env(safe-area-inset-top);
    height: calc(48px + env(safe-area-inset-top));
  }

  .session-kicker,
  .network-url,
  .debug-label {
    display: none;
  }

  .debug-toggle {
    padding-right: 10px;
  }
}
</style>
