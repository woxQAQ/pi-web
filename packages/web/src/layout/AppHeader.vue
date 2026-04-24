<script setup lang="ts">
import {
  Bug,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Sun,
} from "lucide-vue-next";

defineProps<{
  theme: "dark" | "light";
  nextThemeLabel: "dark" | "light";
  showDebugToggle: boolean;
  debugMode: boolean;
  debugModeLabel: string;
  sidebarCollapsed: boolean;
  showOutlineToggle: boolean;
  outlineSidebarOpen: boolean;
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  toggleSidebarCollapse: [];
  toggleOutlineSidebar: [];
  toggleTheme: [];
  toggleDebugMode: [];
}>();
</script>

<template>
  <header class="app-header">
    <div class="header-leading">
      <button
        class="hamburger"
        aria-label="Toggle sidebar"
        @click="emit('toggleSidebar')"
      >
        <Menu class="hamburger-icon" aria-hidden="true" />
      </button>
      <button
        class="sidebar-collapse"
        type="button"
        :aria-label="
          sidebarCollapsed
            ? 'Expand sessions sidebar'
            : 'Collapse sessions sidebar'
        "
        :title="
          sidebarCollapsed
            ? 'Expand sessions sidebar'
            : 'Collapse sessions sidebar'
        "
        @click="emit('toggleSidebarCollapse')"
      >
        <PanelLeftOpen
          v-if="sidebarCollapsed"
          class="sidebar-collapse-icon"
          aria-hidden="true"
        />
        <PanelLeftClose
          v-else
          class="sidebar-collapse-icon"
          aria-hidden="true"
        />
      </button>
      <div class="header-brand">
        <h1 class="app-title">Pi</h1>
      </div>
    </div>
    <div class="header-status">
      <button
        v-if="showOutlineToggle"
        class="outline-toggle"
        type="button"
        :aria-label="
          outlineSidebarOpen
            ? 'Collapse right sidebar'
            : 'Expand right sidebar'
        "
        :title="
          outlineSidebarOpen
            ? 'Collapse right sidebar'
            : 'Expand right sidebar'
        "
        @click="emit('toggleOutlineSidebar')"
      >
        <PanelRightClose
          v-if="outlineSidebarOpen"
          class="outline-toggle-icon"
          aria-hidden="true"
        />
        <PanelRightOpen v-else class="outline-toggle-icon" aria-hidden="true" />
      </button>
      <button
        v-if="showDebugToggle"
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
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
  z-index: 20;
}

.header-leading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.hamburger {
  display: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
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
}

.app-title {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--text);
}

.header-status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.sidebar-collapse,
.outline-toggle,
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

.sidebar-collapse:hover,
.outline-toggle:hover,
.debug-toggle:hover,
.theme-toggle:hover {
  background: var(--surface-hover);
  border-color: var(--border-strong);
  color: var(--text-muted);
  transform: translateY(-1px);
}

.sidebar-collapse:focus-visible,
.outline-toggle:focus-visible,
.debug-toggle:focus-visible,
.theme-toggle:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.debug-toggle.active {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border-strong));
  color: var(--text);
  background: var(--surface-active);
}

.sidebar-collapse,
.outline-toggle,
.theme-toggle {
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
}

.sidebar-collapse-icon,
.outline-toggle-icon,
.debug-icon,
.theme-icon {
  width: 16px;
  height: 16px;
}

@media (max-width: 900px) {
  .hamburger {
    display: flex;
  }

  .sidebar-collapse {
    display: none;
  }

  .app-header {
    height: auto;
    padding: calc(env(safe-area-inset-top) + 8px) 12px 10px;
  }

  .header-status {
    gap: 8px;
  }

  .debug-label {
    display: none;
  }

  .debug-toggle {
    padding-right: 10px;
  }
}

@media (max-width: 640px) {
  .app-header {
    padding-inline: 10px;
    gap: 10px;
  }

  .header-leading {
    gap: 10px;
  }

  .hamburger,
  .outline-toggle,
  .theme-toggle {
    width: 30px;
    height: 30px;
  }

  .debug-toggle {
    height: 28px;
    padding: 0 9px;
    font-size: 0.68rem;
  }
}
</style>
