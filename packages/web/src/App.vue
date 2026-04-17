<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ExtensionDialog from "./components/ExtensionDialog.vue";
import ReconnectBanner from "./components/ReconnectBanner.vue";
import TreePanel from "./components/TreePanel.vue";
import { useBridgeClient } from "./composables/useBridgeClient";
import AppHeader from "./layout/AppHeader.vue";
import AppMainContent from "./layout/AppMainContent.vue";
import AppNotifications from "./layout/AppNotifications.vue";
import AppSidebar from "./layout/AppSidebar.vue";
import type {
  RpcImageContent,
  RpcPluginStateValue,
  RpcThinkingLevel,
} from "./shared-types";
import { readInitialDebugMode } from "./utils/debugMode";
import type { RpcModelInfo } from "./utils/models";
import { parseCompactSlashCommand } from "./utils/slashCommands";

type ThemeMode = "dark" | "light";

const {
  connectionStatus,
  transcript,
  transcriptHasOlder,
  transcriptInitialLoading,
  transcriptPageLoading,
  sessionState,
  sessionStats,
  sessions,
  treeEntries,
  liveSessionPath,
  isHistoricalView,
  commands,
  workspaceEntries,
  workspaceEntriesLoading,
  availableModels,
  currentModel,
  currentThinkingLevel,
  isStreaming,
  isCompacting,
  isReconnecting,
  reconnectCount,
  lastDisconnectReason,
  connectionError,
  sendPrompt,
  loadOlderTranscriptPage,
  abortGeneration,
  compactSession,
  sendCommand,
  fetchWorkspaceEntries,
  setThinkingLevel,
  setAutoCompactionEnabled,
  pendingExtensionRequest,
  notifications,
  statusEntries,
  prefillText,
  respondToUIRequest,
  dismissNotification,
} = useBridgeClient();

const activeSessionId = computed(() => sessionState.value?.sessionId ?? null);
const runningSessionPath = computed(() => {
  if (!isStreaming.value) return null;
  return liveSessionPath.value ?? sessionState.value?.sessionFile ?? null;
});
const activeSessionLabel = computed(() => {
  const active = sessions.value.find(
    session => session.id === activeSessionId.value,
  );
  return (
    active?.name ??
    sessionState.value?.sessionName ??
    sessionState.value?.sessionId ??
    "No active session"
  );
});
const networkUrl = computed(() => {
  if (typeof window === "undefined") return "";
  const h = window.location.host;
  if (h.startsWith("localhost") || h.startsWith("127.")) return "";
  return h;
});
const sidebarOpen = ref(false);
const treePanelOpen = ref(false);
const mainContentRef = ref<InstanceType<typeof AppMainContent> | null>(null);
const pendingRevision = ref<{
  entryId: string;
  text: string;
  preview: string;
  hasImages: boolean;
} | null>(null);

const THEME_CACHE_KEY = "pi-web-theme";
const DEBUG_MODE_CACHE_KEY = "pi-web-debug-mode";

function readCachedTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const cached = window.localStorage.getItem(THEME_CACHE_KEY);
  if (cached === "dark" || cached === "light") return cached;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

const debugModeAvailable =
  typeof window !== "undefined" &&
  window.__PI_WEB_CONFIG__?.debugModeAvailable === true;

function readCachedDebugMode(): boolean {
  if (typeof window === "undefined") return false;
  return readInitialDebugMode(
    debugModeAvailable,
    window.localStorage.getItem(DEBUG_MODE_CACHE_KEY),
    window.location.search,
  );
}

const theme = ref<ThemeMode>(readCachedTheme());
const debugMode = ref(readCachedDebugMode());
const nextThemeLabel = computed<ThemeMode>(() =>
  theme.value === "dark" ? "light" : "dark",
);
const debugModeLabel = computed(() =>
  debugMode.value ? "Disable debug mode" : "Enable debug mode",
);

let preferencesLoaded = false;
watch(connectionStatus, async status => {
  if (status !== "connected" || preferencesLoaded) return;
  preferencesLoaded = true;
  try {
    const themeRes = await sendCommand({
      type: "get_plugin_state",
      key: "theme",
    });
    const savedTheme = (themeRes.data as { value?: RpcPluginStateValue }).value;
    if (themeRes.success && (savedTheme === "dark" || savedTheme === "light")) {
      theme.value = savedTheme;
    }

    if (debugModeAvailable) {
      const debugModeRes = await sendCommand({
        type: "get_plugin_state",
        key: "debugMode",
      });
      const savedDebugMode = (
        debugModeRes.data as {
          value?: RpcPluginStateValue;
        }
      ).value;
      if (debugModeRes.success && typeof savedDebugMode === "boolean") {
        debugMode.value = savedDebugMode;
      }
    }
  } catch {
    // Server unavailable, keep cached values.
  }
});

watch(theme, value => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_CACHE_KEY, value);
  }
  sendCommand({ type: "set_plugin_state", key: "theme", value }).catch(
    () => {},
  );
});

watch(debugMode, value => {
  if (!debugModeAvailable) return;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DEBUG_MODE_CACHE_KEY, String(value));
  }
  sendCommand({ type: "set_plugin_state", key: "debugMode", value }).catch(
    () => {},
  );
});

watch(connectionStatus, status => {
  if (status === "disconnected") {
    mainContentRef.value?.preserveTranscriptScroll();
    pendingRevision.value = null;
  }
});

watch(
  () => sessionState.value?.sessionFile ?? null,
  () => {
    pendingRevision.value = null;
  },
);

watch(isHistoricalView, historical => {
  if (historical) {
    pendingRevision.value = null;
  }
});

const compatWarningVisible = ref(false);

function toggleTheme() {
  theme.value = theme.value === "dark" ? "light" : "dark";
}

function toggleDebugMode() {
  if (!debugModeAvailable) return;
  debugMode.value = !debugMode.value;
}

function handleSessionSelect(sessionPath: string) {
  pendingRevision.value = null;
  sendCommand({ type: "switch_session", sessionPath }).catch(() => {});
  sidebarOpen.value = false;
}

function handleRefreshSessions() {
  sendCommand({ type: "list_sessions" }).catch(() => {});
}

function handleNewSession() {
  pendingRevision.value = null;
  sendCommand({ type: "new_session" }).catch(() => {});
  sidebarOpen.value = false;
}

function handleTreeNavigate(entryId: string) {
  if (isHistoricalView.value) return;
  pendingRevision.value = null;
  treePanelOpen.value = false;
  sendCommand({ type: "navigate_tree", entryId }).catch(() => {});
}

async function handlePrompt(payload: {
  message: string;
  images: RpcImageContent[];
  revisionEntryId?: string;
}) {
  const compactCommand = parseCompactSlashCommand(payload.message);
  if (compactCommand) {
    pendingRevision.value = null;
    compactSession(compactCommand.customInstructions).catch(() => {});
    return;
  }

  if (payload.revisionEntryId) {
    try {
      const response = await sendCommand({
        type: "navigate_tree",
        entryId: payload.revisionEntryId,
      });
      if (!response.success) {
        return;
      }
      const result = response.data as { cancelled?: boolean } | undefined;
      if (result?.cancelled) {
        return;
      }
    } catch {
      return;
    }
  }

  pendingRevision.value = null;
  sendPrompt(payload.message, payload.images);
}

function handleReviseMessage(payload: {
  entryId: string;
  text: string;
  preview: string;
  hasImages: boolean;
}) {
  pendingRevision.value = payload;
}

function handleCancelRevision() {
  pendingRevision.value = null;
}

function handleAbort() {
  abortGeneration().catch(() => {});
}

function handleModelSelect(model: RpcModelInfo) {
  if (
    currentModel.value &&
    currentModel.value.provider === model.provider &&
    currentModel.value.id === model.id
  ) {
    return;
  }

  sendCommand({
    type: "set_model",
    provider: model.provider,
    modelId: model.id,
  }).catch(() => {});
}

function handleThinkingLevelSelect(level: RpcThinkingLevel) {
  if (currentThinkingLevel.value === level) {
    return;
  }

  setThinkingLevel(level).catch(() => {});
}

function handleAutoCompactionToggle(enabled: boolean) {
  if (sessionState.value?.autoCompactionEnabled === enabled) {
    return;
  }

  setAutoCompactionEnabled(enabled).catch(() => {});
}

async function openTreePanel() {
  sidebarOpen.value = false;
  if (connectionStatus.value === "connected") {
    try {
      await sendCommand({
        type: "list_tree_entries",
        sessionPath: sessionState.value?.sessionFile,
      });
    } catch {
      // Keep the panel reachable even if refresh fails.
    }
  }
  treePanelOpen.value = true;
}

function handleUIRespond(payload: Parameters<typeof respondToUIRequest>[0]) {
  respondToUIRequest(payload);
}

function handleDismissNotification(id: string) {
  dismissNotification(id);
}

watch(
  notifications,
  current => {
    for (const n of current) {
      if (!(n as Record<string, unknown>)._timerSet) {
        (n as Record<string, unknown>)._timerSet = true;
        setTimeout(() => dismissNotification(n.id), 5000);
      }
    }
  },
  { deep: true },
);

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  if (event.key !== "Escape") return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!isStreaming.value) return;
  event.preventDefault();
  handleAbort();
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
});
</script>

<template>
  <div class="app-shell" :data-theme="theme">
    <AppHeader
      :theme="theme"
      :next-theme-label="nextThemeLabel"
      :show-debug-toggle="debugModeAvailable"
      :debug-mode="debugMode"
      :debug-mode-label="debugModeLabel"
      :active-session-label="activeSessionLabel"
      :network-url="networkUrl"
      :connection-status="connectionStatus"
      @toggle-sidebar="sidebarOpen = !sidebarOpen"
      @toggle-theme="toggleTheme"
      @toggle-debug-mode="toggleDebugMode"
    />

    <ReconnectBanner
      :visible="isReconnecting"
      :reason="lastDisconnectReason"
      :reconnect-count="reconnectCount"
    />

    <div class="app-body">
      <AppSidebar
        :sessions="sessions"
        :active-session-id="activeSessionId"
        :running-session-path="runningSessionPath"
        :sidebar-open="sidebarOpen"
        :tree-panel-open="treePanelOpen"
        :is-historical-view="isHistoricalView"
        @close-sidebar="sidebarOpen = false"
        @open-tree-panel="openTreePanel"
        @select-session="handleSessionSelect"
        @refresh-sessions="handleRefreshSessions"
        @new-session="handleNewSession"
      />

      <AppMainContent
        ref="mainContentRef"
        :compat-warning-visible="compatWarningVisible"
        :status-entries="statusEntries"
        :transcript="transcript"
        :transcript-has-older="transcriptHasOlder"
        :transcript-initial-loading="transcriptInitialLoading"
        :transcript-page-loading="transcriptPageLoading"
        :is-streaming="isStreaming"
        :is-compacting="isCompacting"
        :is-debug-mode="debugModeAvailable && debugMode"
        :connection-status="connectionStatus"
        :commands="commands"
        :workspace-entries="workspaceEntries"
        :workspace-entries-loading="workspaceEntriesLoading"
        :ensure-workspace-entries="fetchWorkspaceEntries"
        :available-models="availableModels"
        :current-model="currentModel"
        :current-thinking-level="currentThinkingLevel"
        :auto-compaction-enabled="sessionState?.autoCompactionEnabled ?? false"
        :session-stats="sessionStats"
        :prefill-text="prefillText"
        :pending-revision="pendingRevision"
        :allow-revision="connectionStatus === 'connected' && !isHistoricalView"
        @submit="handlePrompt($event)"
        @load-older-transcript="loadOlderTranscriptPage"
        @abort="handleAbort"
        @revise-message="handleReviseMessage"
        @cancel-revision="handleCancelRevision"
        @select-model="handleModelSelect"
        @select-thinking-level="handleThinkingLevelSelect"
        @toggle-auto-compaction="handleAutoCompactionToggle"
      />
    </div>

    <AppNotifications
      :connection-error="connectionError"
      :notifications="notifications"
      @dismiss="handleDismissNotification"
    />

    <TreePanel
      :open="treePanelOpen"
      :entries="treeEntries"
      :session-label="activeSessionLabel"
      :is-historical-view="isHistoricalView"
      @close="treePanelOpen = false"
      @navigate="handleTreeNavigate"
    />

    <ExtensionDialog
      :request="pendingExtensionRequest"
      @respond="handleUIRespond"
    />
  </div>
</template>

<style scoped>
.app-shell {
  --bg: #0a0a0a;
  --bg-elevated: #0f0f0f;
  --panel: #101010;
  --panel-2: #141414;
  --panel-3: #181818;
  --tool-card-bg: #151515;
  --tool-card-bg-strong: #1b1b1b;
  --diff-added-bg: rgba(34, 197, 94, 0.16);
  --diff-added-text: #dcfce7;
  --diff-added-accent: #22c55e;
  --diff-removed-bg: rgba(248, 113, 113, 0.15);
  --diff-removed-text: #fecaca;
  --diff-removed-accent: #f87171;
  --diff-header-bg: #242424;
  --diff-hunk-bg: #2b2b2b;
  --rail-bg: #111111;
  --border: #242424;
  --border-strong: #323232;
  --text: #f5f5f5;
  --text-muted: #b0b0b0;
  --text-subtle: #737373;
  --button-bg: #191919;
  --button-hover: #212121;
  --shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
  --overlay: rgba(0, 0, 0, 0.72);
  --backdrop: rgba(0, 0, 0, 0.45);
  --composer-fade: rgba(10, 10, 10, 0.96);
  --error-bg: rgba(127, 29, 29, 0.28);
  --error-border: rgba(248, 113, 113, 0.42);
  --error-text: #fecaca;
  --pi-font-sans:
    -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --pi-font-mono:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono",
    monospace;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: var(--pi-font-sans);
  color-scheme: dark;
}

.app-shell[data-theme="light"] {
  --bg: #fafafa;
  --bg-elevated: #ffffff;
  --panel: #ffffff;
  --panel-2: #f5f5f5;
  --panel-3: #efefef;
  --tool-card-bg: #f3f3f3;
  --tool-card-bg-strong: #ececec;
  --diff-added-bg: #dcfce7;
  --diff-added-text: #14532d;
  --diff-added-accent: #16a34a;
  --diff-removed-bg: #fee2e2;
  --diff-removed-text: #7f1d1d;
  --diff-removed-accent: #dc2626;
  --diff-header-bg: #dddddd;
  --diff-hunk-bg: #d1d1d1;
  --rail-bg: #f6f6f6;
  --border: #dddddd;
  --border-strong: #c9c9c9;
  --text: #111111;
  --text-muted: #454545;
  --text-subtle: #7a7a7a;
  --button-bg: #efefef;
  --button-hover: #e6e6e6;
  --shadow: 0 18px 48px rgba(20, 20, 20, 0.08);
  --overlay: rgba(0, 0, 0, 0.22);
  --backdrop: rgba(0, 0, 0, 0.12);
  --composer-fade: rgba(250, 250, 250, 0.96);
  --error-bg: #fff1f2;
  --error-border: #fecdd3;
  --error-text: #9f1239;
  color-scheme: light;
}

.app-body {
  display: grid;
  grid-template-columns: 272px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 900px) {
  .app-body {
    grid-template-columns: 1fr;
    position: relative;
  }
}
</style>
