<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import ExtensionDialog from "./components/ExtensionDialog.vue";
import ReconnectBanner from "./components/ReconnectBanner.vue";
import { useBridgeClient } from "./composables/useBridgeClient";
import AppHeader from "./layout/AppHeader.vue";
import AppMainContent from "./layout/AppMainContent.vue";
import AppNotifications from "./layout/AppNotifications.vue";
import AppRightSidebar from "./layout/AppRightSidebar.vue";
import AppSidebar from "./layout/AppSidebar.vue";
import type { RpcImageContent, RpcThinkingLevel } from "./shared-types";
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
  pendingTranscriptConfigEvent,
  sessionState,
  sessionStats,
  gitRepoState,
  gitRepoLoading,
  gitBranchSwitching,
  sessions,
  treeEntries,
  activeTreeSessionPath,
  runningSessionPaths,
  workspaceSessionCursors,
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
  loadWorkspaceSessions,
  refreshWorkspaceSessions,
  loadGitRepoState,
  switchGitBranch,
  createGitBranch,
  setThinkingLevel,
  setAutoCompactionEnabled,
  renameSession,
  deleteSession,
  pendingExtensionRequest,
  notifications,
  statusEntries,
  prefillText,
  respondToUIRequest,
  dismissNotification,
  pendingMessageCount,
  queuedUserMessages,
  cancelQueuedMessage,
  editQueuedMessage,
} = useBridgeClient();

const activeSessionPath = computed(
  () => activeTreeSessionPath.value ?? sessionState.value?.sessionFile ?? null,
);
const hasSessionOutline = computed(
  () =>
    Boolean(activeSessionPath.value) ||
    transcript.value.length > 0 ||
    treeEntries.value.length > 0,
);
const activeSessionLabel = computed(() => {
  const active = sessions.value.find(
    session =>
      session.path === activeSessionPath.value ||
      session.id === sessionState.value?.sessionId,
  );
  if (active?.name) {
    return active.name;
  }
  if (!hasSessionOutline.value) {
    return "No active session";
  }
  return (
    sessionState.value?.sessionName ??
    sessionState.value?.sessionId ??
    "Untitled session"
  );
});
const sidebarOpen = ref(false);
const leftSidebarCollapsed = ref(false);
const outlineSidebarOpen = ref(false);
const mainContentRef = ref<InstanceType<typeof AppMainContent> | null>(null);
const pendingRevision = ref<{
  entryId: string;
  text: string;
  preview: string;
  hasImages: boolean;
} | null>(null);
const editQueuedPayload = ref<{
  text: string;
  images: RpcImageContent[];
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

watch(theme, value => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_CACHE_KEY, value);
  }
});

watch(debugMode, value => {
  if (!debugModeAvailable) return;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DEBUG_MODE_CACHE_KEY, String(value));
  }
});

watch(connectionStatus, status => {
  if (status === "disconnected") {
    mainContentRef.value?.preserveTranscriptScroll();
    pendingRevision.value = null;
    outlineSidebarOpen.value = false;
  }
});

watch(
  () => sessionState.value?.sessionFile ?? null,
  () => {
    pendingRevision.value = null;
  },
);

watch(hasSessionOutline, visible => {
  if (!visible) {
    outlineSidebarOpen.value = false;
  }
});

const compatWarningVisible = ref(false);

function isCompactLayout(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 900px)").matches;
}

function toggleTheme() {
  theme.value = theme.value === "dark" ? "light" : "dark";
}

function toggleSessionSidebar() {
  const nextOpen = !sidebarOpen.value;
  sidebarOpen.value = nextOpen;
  if (nextOpen && isCompactLayout()) {
    outlineSidebarOpen.value = false;
  }
}

function toggleLeftSidebarCollapse() {
  leftSidebarCollapsed.value = !leftSidebarCollapsed.value;
}

function toggleDebugMode() {
  if (!debugModeAvailable) return;
  debugMode.value = !debugMode.value;
}

async function handleSessionSelect(sessionPath: string) {
  pendingRevision.value = null;
  try {
    const response = await sendCommand({ type: "switch_session", sessionPath });
    if (response.success) {
      sidebarOpen.value = false;
    }
  } catch {
    // Keep the current sidebar state on failure.
  }
}

function handleRefreshSessions() {
  refreshWorkspaceSessions().catch(() => {});
}

function handleLoadOlderSessions(payload: {
  workspacePath: string;
  cursor?: string | null;
}) {
  loadWorkspaceSessions({
    workspacePath: payload.workspacePath,
    cursor: payload.cursor,
    limit: 50,
    merge: "append",
  }).catch(() => {});
}

async function handleNewSession(workspacePath: string) {
  pendingRevision.value = null;
  try {
    const response = await sendCommand({
      type: "new_session",
      workspacePath,
    });
    if (response.success) {
      sidebarOpen.value = false;
    }
  } catch {
    // Keep the current sidebar state on failure.
  }
}

async function handleRenameSession(sessionPath: string, name: string) {
  try {
    const response = await renameSession(sessionPath, name);
    if (response.success) {
      handleRefreshSessions();
    }
  } catch {
    // Ignore
  }
}

async function handleDeleteSession(sessionPath: string) {
  try {
    const response = await deleteSession(sessionPath);
    if (response.success) {
      handleRefreshSessions();
    }
  } catch {
    // Ignore
  }
}

function toggleOutlineSidebar() {
  const nextOpen = !outlineSidebarOpen.value;
  outlineSidebarOpen.value = nextOpen;
  if (nextOpen) {
    if (isCompactLayout()) {
      sidebarOpen.value = false;
    }
    handleRefreshTree();
  }
}

function handleRefreshTree() {
  if (!hasSessionOutline.value) {
    return;
  }

  const sessionPath = activeSessionPath.value ?? undefined;
  sendCommand({ type: "list_tree_entries", sessionPath }).catch(() => {});
}

async function revealTreeEntryInTranscript(entryId: string): Promise<boolean> {
  if (mainContentRef.value?.scrollToTranscriptEntry(entryId)) {
    return true;
  }

  try {
    await sendCommand({ type: "get_messages", direction: "latest", limit: 40 });
    await nextTick();
    if (mainContentRef.value?.scrollToTranscriptEntry(entryId)) {
      return true;
    }
  } catch {
    // Keep the current transcript window if refreshing fails.
  }

  const MAX_HISTORY_PAGES = 50;
  for (
    let page = 0;
    page < MAX_HISTORY_PAGES && transcriptHasOlder.value;
    page += 1
  ) {
    await loadOlderTranscriptPage();
    await nextTick();
    if (mainContentRef.value?.scrollToTranscriptEntry(entryId)) {
      return true;
    }
  }

  return false;
}

async function handleTreeEntrySelect(entryId: string) {
  pendingRevision.value = null;

  const entry = treeEntries.value.find(candidate => candidate.id === entryId);
  if (entry?.isOnActivePath) {
    const revealed = await revealTreeEntryInTranscript(entryId);
    if (revealed) {
      if (isCompactLayout()) {
        outlineSidebarOpen.value = false;
      }
      return;
    }
  }

  try {
    const response = await sendCommand({ type: "select_tree_entry", entryId });
    if (response.success) {
      await nextTick();
      mainContentRef.value?.scrollToTranscriptEntry(entryId);
      if (isCompactLayout()) {
        outlineSidebarOpen.value = false;
      }
    }
  } catch {
    // Keep the current outline state on failure.
  }
}

async function handlePrompt(payload: {
  message: string;
  images: RpcImageContent[];
  revisionEntryId?: string;
  steer?: boolean;
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
  sendPrompt(
    payload.message,
    payload.images,
    payload.steer ? "steer" : "followUp",
  );
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

async function handleCancelQueued(index: number) {
  await cancelQueuedMessage(index);
}

async function handleEditQueued(index: number) {
  const item = await editQueuedMessage(index);
  if (!item) return;
  editQueuedPayload.value = item;
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
  <div
    class="app-shell"
    :class="{ 'left-rail-collapsed': leftSidebarCollapsed }"
    :data-theme="theme"
  >
    <AppSidebar
      :sessions="sessions"
      :active-session-path="activeSessionPath"
      :running-session-paths="runningSessionPaths"
      :workspace-session-cursors="workspaceSessionCursors"
      :sidebar-open="sidebarOpen"
      :collapsed="leftSidebarCollapsed"
      @close-sidebar="sidebarOpen = false"
      @select-session="handleSessionSelect"
      @refresh-sessions="handleRefreshSessions"
      @load-older-sessions="handleLoadOlderSessions"
      @new-session="handleNewSession"
      @rename-session="handleRenameSession"
      @delete-session="handleDeleteSession"
    />

    <div class="app-main-column">
      <AppHeader
        :theme="theme"
        :next-theme-label="nextThemeLabel"
        :show-debug-toggle="debugModeAvailable"
        :debug-mode="debugMode"
        :debug-mode-label="debugModeLabel"
        :sidebar-collapsed="leftSidebarCollapsed"
        :show-outline-toggle="hasSessionOutline"
        :outline-sidebar-open="outlineSidebarOpen"
        @toggle-sidebar="toggleSessionSidebar"
        @toggle-sidebar-collapse="toggleLeftSidebarCollapse"
        @toggle-outline-sidebar="toggleOutlineSidebar"
        @toggle-theme="toggleTheme"
        @toggle-debug-mode="toggleDebugMode"
      />

      <ReconnectBanner
        :visible="isReconnecting"
        :reason="lastDisconnectReason"
        :reconnect-count="reconnectCount"
      />

      <div
        class="app-body"
        :class="{
          'has-right-rail': hasSessionOutline,
          'right-rail-open': hasSessionOutline && outlineSidebarOpen,
        }"
      >
        <AppMainContent
          ref="mainContentRef"
          :compat-warning-visible="compatWarningVisible"
          :status-entries="statusEntries"
          :transcript="transcript"
          :transcript-has-older="transcriptHasOlder"
          :transcript-initial-loading="transcriptInitialLoading"
          :transcript-page-loading="transcriptPageLoading"
          :pending-transcript-config-event="pendingTranscriptConfigEvent"
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
          :auto-compaction-enabled="
            sessionState?.autoCompactionEnabled ?? false
          "
          :session-stats="sessionStats"
          :session-state="sessionState"
          :git-repo-state="gitRepoState"
          :git-repo-loading="gitRepoLoading"
          :git-branch-switching="gitBranchSwitching"
          :refresh-git-repo-state="loadGitRepoState"
          :switch-git-branch="switchGitBranch"
          :create-git-branch="createGitBranch"
          :prefill-text="prefillText"
          :pending-revision="pendingRevision"
          :allow-revision="connectionStatus === 'connected'"
          :pending-message-count="pendingMessageCount"
          :queued-user-messages="queuedUserMessages"
          :edit-queued-payload="editQueuedPayload"
          @submit="handlePrompt($event)"
          @load-older-transcript="loadOlderTranscriptPage"
          @abort="handleAbort"
          @revise-message="handleReviseMessage"
          @cancel-revision="handleCancelRevision"
          @cancel-queued="handleCancelQueued"
          @edit-queued="handleEditQueued"
          @select-model="handleModelSelect"
          @select-thinking-level="handleThinkingLevelSelect"
          @toggle-auto-compaction="handleAutoCompactionToggle"
        />

        <AppRightSidebar
          v-if="hasSessionOutline && outlineSidebarOpen"
          :tree-entries="treeEntries"
          :sidebar-open="outlineSidebarOpen"
          :session-label="activeSessionLabel"
          :session-path="activeSessionPath"
          @close-sidebar="outlineSidebarOpen = false"
          @select-tree-entry="handleTreeEntrySelect"
          @refresh-tree="handleRefreshTree"
        />
      </div>
    </div>

    <AppNotifications
      :connection-error="connectionError"
      :notifications="notifications"
      @dismiss="handleDismissNotification"
    />

    <ExtensionDialog
      :request="pendingExtensionRequest"
      @respond="handleUIRespond"
    />
  </div>
</template>

<style scoped>
.app-shell {
  --bg: #0d1117;
  --bg-elevated: #161b22;
  --panel: #161b22;
  --panel-2: #21262d;
  --panel-3: #30363d;
  --tool-card-bg: #161b22;
  --tool-card-bg-strong: #21262d;
  --diff-added-bg: rgba(46, 160, 67, 0.15);
  --diff-added-text: #aff5b4;
  --diff-added-accent: #3fb950;
  --diff-removed-bg: rgba(218, 54, 51, 0.15);
  --diff-removed-text: #ffa198;
  --diff-removed-accent: #f85149;
  --diff-header-bg: #30363d;
  --diff-hunk-bg: #21262d;
  --rail-bg: #010409;
  --border: #30363d;
  --border-strong: #484f58;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --text-subtle: #7d8590;
  --accent: #2f81f7;
  --accent-hover: #58a6ff;
  --success: #3fb950;
  --warning: #d29922;
  --danger: #f85149;
  --surface-hover: rgba(110, 118, 129, 0.1);
  --surface-active: rgba(56, 139, 253, 0.15);
  --surface-selected: rgba(110, 118, 129, 0.4);
  --focus-ring: rgba(31, 111, 235, 0.35);
  --focus-ring-muted: rgba(139, 148, 158, 0.22);
  --selection-bg: rgba(56, 139, 253, 0.22);
  --button-bg: #21262d;
  --button-hover: #30363d;
  --shadow-raised: 0 8px 24px rgba(1, 4, 9, 0.28);
  --shadow-floating: 0 20px 48px rgba(1, 4, 9, 0.4);
  --shadow: 0 24px 60px rgba(1, 4, 9, 0.36);
  --overlay: rgba(1, 4, 9, 0.78);
  --backdrop: rgba(1, 4, 9, 0.52);
  --composer-fade: rgba(13, 17, 23, 0.96);
  --error-bg: rgba(248, 81, 73, 0.14);
  --error-border: rgba(248, 81, 73, 0.32);
  --error-text: #ffa198;
  --pi-font-sans:
    -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --pi-font-mono:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono",
    monospace;
  display: grid;
  grid-template-columns: clamp(280px, 24vw, 360px) minmax(0, 1fr);
  height: 100vh;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: var(--pi-font-sans);
  color-scheme: dark;
  position: relative;
}

.app-shell ::selection {
  background: var(--selection-bg);
}

.app-shell.left-rail-collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.app-main-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.app-shell[data-theme="light"] {
  --bg: #ffffff;
  --bg-elevated: #ffffff;
  --panel: #ffffff;
  --panel-2: #f6f8fa;
  --panel-3: #ebedf0;
  --tool-card-bg: #f6f8fa;
  --tool-card-bg-strong: #ebedf0;
  --diff-added-bg: rgba(26, 127, 55, 0.12);
  --diff-added-text: #116329;
  --diff-added-accent: #1a7f37;
  --diff-removed-bg: rgba(207, 34, 46, 0.1);
  --diff-removed-text: #a40e26;
  --diff-removed-accent: #cf222e;
  --diff-header-bg: #d8dee4;
  --diff-hunk-bg: #eaeef2;
  --rail-bg: #f6f8fa;
  --border: #d0d7de;
  --border-strong: #afb8c1;
  --text: #1f2328;
  --text-muted: #656d76;
  --text-subtle: #6e7781;
  --accent: #0969da;
  --accent-hover: #218bff;
  --success: #1a7f37;
  --warning: #9a6700;
  --danger: #cf222e;
  --surface-hover: rgba(234, 238, 242, 0.5);
  --surface-active: rgba(221, 244, 255, 0.95);
  --surface-selected: rgba(175, 184, 193, 0.2);
  --focus-ring: rgba(9, 105, 218, 0.28);
  --focus-ring-muted: rgba(101, 109, 118, 0.18);
  --selection-bg: rgba(9, 105, 218, 0.16);
  --button-bg: #f6f8fa;
  --button-hover: #f3f4f6;
  --shadow-raised: 0 8px 24px rgba(31, 35, 40, 0.08);
  --shadow-floating: 0 20px 48px rgba(31, 35, 40, 0.12);
  --shadow: 0 18px 48px rgba(31, 35, 40, 0.08);
  --overlay: rgba(31, 35, 40, 0.22);
  --backdrop: rgba(31, 35, 40, 0.12);
  --composer-fade: rgba(255, 255, 255, 0.96);
  --error-bg: rgba(207, 34, 46, 0.08);
  --error-border: rgba(207, 34, 46, 0.22);
  --error-text: #cf222e;
  color-scheme: light;
}

.app-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.app-body.has-right-rail {
  position: relative;
}

.app-body.has-right-rail.right-rail-open {
  grid-template-columns: minmax(0, 1fr) clamp(280px, 22vw, 340px);
}

@media (max-width: 900px) {
  .app-shell {
    display: flex;
    flex-direction: column;
  }

  .app-body,
  .app-body.has-right-rail,
  .app-body.has-right-rail.right-rail-open {
    grid-template-columns: 1fr;
    position: relative;
  }
}
</style>
