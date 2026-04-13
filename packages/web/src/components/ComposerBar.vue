<script setup lang="ts">
import { SendHorizontal } from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import type { ConnectionStatus } from "../composables/useBridgeClient";
import type { RpcSlashCommand } from "../shared-types";
import type { RpcModelInfo } from "../utils/models";
import CommandPalette from "./CommandPalette.vue";
import ModelDropdown from "./ModelDropdown.vue";

const THINKING_LEVEL_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
] as const;

const props = defineProps<{
  connectionStatus: ConnectionStatus;
  commands: RpcSlashCommand[];
  models: RpcModelInfo[];
  selectedModel: RpcModelInfo | null;
  thinkingLevel: string | null;
}>();

const emit = defineEmits<{
  submit: [message: string];
  selectModel: [model: RpcModelInfo];
  selectThinkingLevel: [level: string];
}>();

const MAX_TEXTAREA_HEIGHT = 160;

const inputText = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const isDisabled = computed(() => props.connectionStatus !== "connected");
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null);

const showPalette = ref(false);
const filterText = computed(() => {
  if (!showPalette.value) return "";
  return inputText.value.slice(1);
});
const currentModelText = computed(() => {
  if (!props.selectedModel)
    return props.models.length > 0 ? "choose model" : "no models";
  return `${props.selectedModel.provider}/${props.selectedModel.id}`;
});
const selectedThinkingLevel = computed(() => {
  if (props.thinkingLevel === "normal") return "medium";
  return props.thinkingLevel ?? "off";
});
const selectedThinkingLabel = computed(
  () =>
    THINKING_LEVEL_OPTIONS.find(
      (option) => option.value === selectedThinkingLevel.value,
    )?.label ?? "Off",
);
const thinkingSelectWidth = computed(
  () => `calc(${selectedThinkingLabel.value.length + 1.5}ch + 84px)`,
);
const normalizedInputText = computed(() =>
  normalizeSubmittedText(inputText.value),
);
const canSubmit = computed(
  () => !isDisabled.value && normalizedInputText.value.length > 0,
);

function normalizeSubmittedText(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  if (lines.length === 0) return "";

  lines[0] = lines[0].trimStart();
  lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
  return lines.join("\n");
}

function resizeTextarea() {
  nextTick(() => {
    const el = textareaRef.value;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    el.style.overflowY =
      el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  });
}

watch(inputText, (val) => {
  showPalette.value = val.startsWith("/");
  resizeTextarea();
});

function handleSubmit() {
  const text = normalizedInputText.value;
  if (!text || isDisabled.value) return;
  emit("submit", text);
  inputText.value = "";
  showPalette.value = false;
  resizeTextarea();
}

function handleCommandSelect(commandName: string) {
  inputText.value = "";
  showPalette.value = false;
  emit("submit", `/${commandName}`);
  resizeTextarea();
}

function handlePaletteClose() {
  showPalette.value = false;
}

function handleModelSelect(model: RpcModelInfo) {
  emit("selectModel", model);
}

function handleThinkingLevelChange(event: Event) {
  const level = (event.target as HTMLSelectElement | null)?.value;
  if (!level) return;
  emit("selectThinkingLevel", level);
}

function handleInputKeydown(e: KeyboardEvent) {
  if (showPalette.value && paletteRef.value) {
    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Escape" ||
      e.key === "Enter"
    ) {
      paletteRef.value.handleKeydown(e);
      return;
    }
  }

  if (e.key === "Enter" && !e.shiftKey && !showPalette.value) {
    e.preventDefault();
    handleSubmit();
  }
}

resizeTextarea();
</script>

<template>
  <div class="composer-bar">
    <div class="composer-inner-wrap">
      <CommandPalette
        v-if="showPalette && commands.length > 0"
        ref="paletteRef"
        :commands="commands"
        :filter="filterText"
        @select="handleCommandSelect"
        @close="handlePaletteClose"
      />
      <div class="composer-dock" :class="{ disabled: isDisabled }">
        <div class="composer-main-row">
          <textarea
            ref="textareaRef"
            v-model="inputText"
            class="prompt-input"
            rows="1"
            :disabled="isDisabled"
            @keydown="handleInputKeydown"
            @input="resizeTextarea"
          />
          <button
            class="send-btn"
            :disabled="!canSubmit"
            aria-label="Send message"
            @click="handleSubmit"
          >
            <SendHorizontal class="send-icon" aria-hidden="true" />
          </button>
        </div>

        <div class="composer-footer-row">
          <div class="composer-status-cluster">
            <ModelDropdown
              :models="models"
              :selected-model="selectedModel"
              :label="currentModelText"
              :disabled="isDisabled"
              @select="handleModelSelect"
            />
            <label
              class="thinking-control"
              :style="{
                '--thinking-select-width': thinkingSelectWidth,
              }"
            >
              <span class="sr-only">Thinking level</span>
              <select
                class="thinking-select"
                :value="selectedThinkingLevel"
                :disabled="isDisabled"
                @change="handleThinkingLevelChange"
              >
                <option
                  v-for="option in THINKING_LEVEL_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-bar {
  flex-shrink: 0;
  padding: 16px 24px 12px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  background: linear-gradient(to top, var(--bg), var(--composer-fade));
}

.composer-inner-wrap {
  position: relative;
  width: min(960px, 100%);
  margin: 0 auto;
}

.composer-dock {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 18px;
  border: 1px solid var(--border);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-elevated) 92%, transparent),
    var(--panel)
  );
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.12);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.composer-dock:focus-within {
  border-color: var(--border-strong);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--panel) 94%, transparent),
    var(--panel-2)
  );
  box-shadow: 0 26px 56px rgba(0, 0, 0, 0.16);
}

.composer-dock.disabled {
  opacity: 0.74;
}

.composer-main-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  min-width: 0;
}

.prompt-input {
  flex: 1;
  min-width: 0;
  max-height: 160px;
  padding: 10px 6px 8px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 0.94rem;
  line-height: 1.5;
  outline: none;
  resize: none;
  overflow-y: hidden;
  scrollbar-gutter: stable;
}

.prompt-input:disabled {
  cursor: not-allowed;
}

.prompt-input::placeholder {
  color: var(--text-subtle);
}

.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--text);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease,
    transform 0.15s ease;
}

.send-btn:hover:not(:disabled) {
  background: var(--button-hover);
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-icon {
  width: 15px;
  height: 15px;
}

.composer-footer-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  min-width: 0;
}

.composer-status-cluster {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.thinking-control {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.thinking-control::before {
  content: "Thinking";
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  font-family: "SF Mono", "Monaco", "Menlo", monospace;
  font-size: 0.62rem;
  color: var(--text-subtle);
  pointer-events: none;
}

.thinking-select {
  width: var(--thinking-select-width, auto);
  height: 26px;
  padding: 0 20px 0 68px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  background: color-mix(in srgb, var(--panel) 70%, transparent);
  color: var(--text);
  font-family: "SF Mono", "Monaco", "Menlo", monospace;
  font-size: 0.66rem;
  outline: none;
  cursor: pointer;
  appearance: none;
}

.thinking-select:hover:not(:disabled),
.thinking-select:focus {
  border-color: var(--border-strong);
  background: var(--panel-2);
}

.thinking-select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}


@media (max-width: 900px) {
  .composer-bar {
    position: sticky;
    bottom: 0;
    z-index: 10;
    padding: 12px 16px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }

  .composer-inner-wrap {
    width: 100%;
  }

  .prompt-input {
    font-size: 16px;
  }

  .composer-footer-row {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .composer-status-cluster {
    width: 100%;
  }

  .thinking-select {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .composer-dock {
    gap: 8px;
    padding: 10px;
  }

  .composer-main-row {
    gap: 8px;
  }

  .composer-footer-row {
    gap: 10px;
    padding-top: 8px;
  }

}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
