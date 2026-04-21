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
  sendCommand({ type: "list_sessions" }).catch(() => {});
}

async function handleNewSession() {
  pendingRevision.value = null;
  try {
    const response = await sendCommand({ type: "new_session" });
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
      :sidebar-open="sidebarOpen"
      :collapsed="leftSidebarCollapsed"
      @close-sidebar="sidebarOpen = false"
      @select-session="handleSessionSelect"
      @refresh-sessions="handleRefreshSessions"
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
          :auto-compaction-enabled="sessionState?.autoCompactionEnabled ?? false"
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
