<script setup lang="ts">
import { ref } from "vue";
import ChatTranscript from "../components/ChatTranscript.vue";
import CompatWarning from "../components/CompatWarning.vue";
import ComposerBar from "../components/ComposerBar.vue";
import SessionStatsBar from "../components/SessionStatsBar.vue";
import type {
  ConnectionStatus,
  TranscriptEntry,
} from "../composables/useBridgeClient";
import type {
  RpcImageContent,
  RpcSessionStats,
  RpcSlashCommand,
  RpcThinkingLevel,
  RpcWorkspaceEntry,
} from "../shared-types";
import type { RpcModelInfo } from "../utils/models";

defineProps<{
  compatWarningVisible: boolean;
  statusEntries: Record<string, string>;
  transcript: readonly TranscriptEntry[];
  transcriptHasOlder: boolean;
  transcriptInitialLoading: boolean;
  transcriptPageLoading: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  isDebugMode: boolean;
  connectionStatus: ConnectionStatus;
  commands: readonly RpcSlashCommand[];
  workspaceEntries: readonly RpcWorkspaceEntry[];
  workspaceEntriesLoading: boolean;
  ensureWorkspaceEntries: () => Promise<RpcWorkspaceEntry[]>;
  availableModels: readonly RpcModelInfo[];
  currentModel: RpcModelInfo | null;
  currentThinkingLevel: RpcThinkingLevel | null;
  autoCompactionEnabled: boolean;
  sessionStats: RpcSessionStats | null;
  prefillText: string | null;
  pendingRevision: {
    entryId: string;
    text: string;
    preview: string;
    hasImages: boolean;
  } | null;
  allowRevision: boolean;
}>();

const emit = defineEmits<{
  submit: [
    payload: {
      message: string;
      images: RpcImageContent[];
      revisionEntryId?: string;
    },
  ];
  abort: [];
  loadOlderTranscript: [];
  selectModel: [model: RpcModelInfo];
  selectThinkingLevel: [level: RpcThinkingLevel];
  toggleAutoCompaction: [enabled: boolean];
  reviseMessage: [
    payload: {
      entryId: string;
      text: string;
      preview: string;
      hasImages: boolean;
    },
  ];
  cancelRevision: [];
}>();

const chatTranscriptRef = ref<InstanceType<typeof ChatTranscript> | null>(null);

function preserveTranscriptScroll() {
  chatTranscriptRef.value?.preserveScroll();
}

defineExpose({ preserveTranscriptScroll });
</script>

<template>
  <main class="center-column">
    <CompatWarning :visible="compatWarningVisible" />

    <!-- <div v-if="Object.keys(statusEntries).length > 0" class="status-bar">
      <span
        v-for="(text, key) in statusEntries"
        :key="key"
        class="status-entry"
      >
        {{ text }}
      </span>
    </div> -->

    <ChatTranscript
      ref="chatTranscriptRef"
      :messages="transcript"
      :has-older="transcriptHasOlder"
      :initial-loading="transcriptInitialLoading"
      :page-loading="transcriptPageLoading"
      :is-streaming="isStreaming"
      :is-compacting="isCompacting"
      :show-message-ids="isDebugMode"
      :allow-revision="allowRevision"
      @load-older="emit('loadOlderTranscript')"
      @revise="emit('reviseMessage', $event)"
    />
    <SessionStatsBar :stats="sessionStats" />
    <ComposerBar
      :connection-status="connectionStatus"
      :is-streaming="isStreaming"
      :commands="commands"
      :workspace-entries="workspaceEntries"
      :workspace-entries-loading="workspaceEntriesLoading"
      :ensure-workspace-entries="ensureWorkspaceEntries"
      :models="availableModels"
      :selected-model="currentModel"
      :thinking-level="currentThinkingLevel"
      :auto-compaction-enabled="autoCompactionEnabled"
      :prefill-text="prefillText"
      :revision="pendingRevision"
      @submit="emit('submit', $event)"
      @abort="emit('abort')"
      @cancel-revision="emit('cancelRevision')"
      @select-model="emit('selectModel', $event)"
      @select-thinking-level="emit('selectThinkingLevel', $event)"
      @toggle-auto-compaction="emit('toggleAutoCompaction', $event)"
    />
  </main>
</template>

<style scoped>
.center-column {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}

.status-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 24px 0;
  flex-shrink: 0;
}

.status-entry {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  font-size: 0.68rem;
  color: var(--text-subtle);
}

@media (max-width: 900px) {
  .center-column {
    grid-column: 1;
  }

  .status-bar {
    padding: 12px 16px 0;
  }
}
</style>
