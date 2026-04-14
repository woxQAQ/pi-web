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
import type { RpcImageContent, RpcSlashCommand } from "../shared-types";
import type { RpcModelInfo } from "../utils/models";

defineProps<{
  compatWarningVisible: boolean;
  statusEntries: Record<string, string>;
  transcript: readonly TranscriptEntry[];
  isStreaming: boolean;
  isDebugMode: boolean;
  connectionStatus: ConnectionStatus;
  commands: readonly RpcSlashCommand[];
  availableModels: readonly RpcModelInfo[];
  currentModel: RpcModelInfo | null;
  currentThinkingLevel: string | null;
  sessionStats: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
    messageCount: number;
    cost: number;
  } | null;
}>();

const emit = defineEmits<{
  submit: [payload: { message: string; images: RpcImageContent[] }];
  abort: [];
  selectModel: [model: RpcModelInfo];
  selectThinkingLevel: [level: string];
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
      :is-streaming="isStreaming"
      :show-message-ids="isDebugMode"
    />
    <SessionStatsBar :stats="sessionStats" />
    <ComposerBar
      :connection-status="connectionStatus"
      :is-streaming="isStreaming"
      :commands="commands"
      :models="availableModels"
      :selected-model="currentModel"
      :thinking-level="currentThinkingLevel"
      @submit="emit('submit', $event)"
      @abort="emit('abort')"
      @select-model="emit('selectModel', $event)"
      @select-thinking-level="emit('selectThinkingLevel', $event)"
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
