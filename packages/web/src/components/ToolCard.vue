<script setup lang="ts">
import { computed } from "vue";
import { buildToolCardModel } from "../utils/toolBlock";
import type {
  ImageContentBlock,
  JsonObject,
  ToolContentBlock,
} from "../utils/transcript";
import DiffView from "./DiffView.vue";
import HighlightedCode from "./HighlightedCode.vue";

const props = defineProps<{
  block: ToolContentBlock;
  expanded: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const model = computed(() => buildToolCardModel(props.block));
const hasDetails = computed(() => model.value.details.length > 0);
const showPreview = computed(() => !props.expanded || !hasDetails.value);

function asJsonObject(
  value: ToolContentBlock["toolArgs"] | ToolContentBlock["resultDetails"],
): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function stringValue(
  record: JsonObject | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function filePathFromArgs(): string | undefined {
  return stringValue(asJsonObject(props.block.toolArgs), "path");
}

const readPath = computed(filePathFromArgs);
const writePath = computed(filePathFromArgs);
const editDiff = computed(() => {
  if (props.block.toolName !== "edit") return undefined;
  return stringValue(asJsonObject(props.block.resultDetails), "diff");
});

const resultImages = computed(() =>
  (props.block.resultBlocks ?? []).filter(
    (block): block is ImageContentBlock => block.kind === "image",
  ),
);
const hasImageResult = computed(() => resultImages.value.length > 0);
</script>

<template>
  <article
    class="tool-card"
    :data-status="model.status"
    :data-tool="block.toolName"
  >
    <header class="tool-card-header">
      <div class="tool-card-heading">
        <span class="tool-card-label">{{ model.label }}</span>
        <div class="tool-card-title-row">
          <span class="tool-card-title">{{ model.title }}</span>
          <template v-if="model.diffStats">
            <span class="tool-card-stat tool-card-stat-added"
              >+{{ model.diffStats.added }}</span
            >
            <span class="tool-card-stat tool-card-stat-removed"
              >-{{ model.diffStats.removed }}</span
            >
          </template>
          <span v-else-if="model.meta" class="tool-card-meta">{{
            model.meta
          }}</span>
        </div>
      </div>
      <button
        v-if="hasDetails"
        type="button"
        class="tool-card-toggle"
        @click="emit('toggle')"
      >
        {{ expanded ? "Hide" : "Details" }}
      </button>
    </header>

    <div v-if="resultImages.length > 0" class="tool-card-image-strip">
      <figure
        v-for="(image, index) in resultImages"
        :key="`${image.src}-${index}`"
        class="tool-card-image-block"
      >
        <img
          class="tool-card-image"
          :src="image.src"
          :alt="image.alt"
          loading="lazy"
        />
      </figure>
    </div>

    <DiffView v-if="showPreview && editDiff" :diff="editDiff" />
    <div
      v-else-if="
        showPreview &&
        model.preview &&
        block.toolName === 'read' &&
        !hasImageResult
      "
      class="tool-card-code-panel"
    >
      <HighlightedCode :code="model.preview" :path="readPath" />
    </div>
    <div
      v-else-if="showPreview && model.preview && block.toolName === 'bash'"
      class="tool-card-code-panel"
    >
      <pre class="tool-card-preview">{{ model.preview }}</pre>
    </div>
    <div
      v-else-if="showPreview && model.preview && block.toolName === 'write'"
      class="tool-card-code-panel"
    >
      <HighlightedCode :code="model.preview" :path="writePath" />
    </div>
    <pre v-else-if="showPreview && model.preview" class="tool-card-preview">{{
      model.preview
    }}</pre>

    <div v-if="expanded && hasDetails" class="tool-card-details">
      <section
        v-for="section in model.details"
        :key="section.label"
        class="tool-card-section"
      >
        <div class="tool-card-section-label">{{ section.label }}</div>
        <div
          v-if="
            block.toolName === 'read' &&
            section.label === 'Contents' &&
            !hasImageResult
          "
          class="tool-card-code-panel"
        >
          <HighlightedCode :code="section.text" :path="readPath" />
        </div>
        <div
          v-else-if="block.toolName === 'write' && section.label === 'Content'"
          class="tool-card-code-panel"
        >
          <HighlightedCode :code="section.text" :path="writePath" />
        </div>
        <div v-else-if="block.toolName === 'bash'" class="tool-card-code-panel">
          <pre class="tool-card-section-text">{{ section.text }}</pre>
        </div>
        <pre v-else class="tool-card-section-text">{{ section.text }}</pre>
      </section>
    </div>
  </article>
</template>

<style scoped>
.tool-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  /*border-left: 2px solid var(--border-strong);*/
  border-radius: 12px;
  background: var(--tool-card-bg);
}

.tool-card[data-status="success"] {
  /*border-left-color: var(--text-subtle);*/
}

.tool-card[data-status="error"] {
  border-color: var(--error-border);
  border-left-color: var(--error-border);
  background: var(--tool-card-bg);
}

.tool-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.tool-card-heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-card-label,
.tool-card-section-label {
  font-size: 0.64rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.tool-card-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.tool-card-title {
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--text);
  word-break: break-word;
}

.tool-card[data-tool="bash"] .tool-card-label,
.tool-card[data-tool="bash"] .tool-card-title,
.tool-card[data-tool="bash"] .tool-card-meta,
.tool-card[data-tool="bash"] .tool-card-preview,
.tool-card[data-tool="bash"] .tool-card-section-label,
.tool-card[data-tool="bash"] .tool-card-section-text {
  font-family: var(--pi-font-mono);
}

.tool-card-meta {
  font-size: 0.68rem;
  color: var(--text-subtle);
}

.tool-card-stat {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.tool-card-stat-added {
  color: var(--diff-added-accent);
}

.tool-card-stat-removed {
  color: var(--diff-removed-accent);
}

.tool-card-toggle {
  flex: none;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--tool-card-bg) 72%, transparent);
  font-size: 0.66rem;
  color: var(--text-subtle);
  cursor: pointer;
}

.tool-card-toggle:hover {
  border-color: var(--border-strong);
  color: var(--text-muted);
}

.tool-card-preview,
.tool-card-section-text {
  margin: 0;
  font-family: inherit;
  font-size: 0.72rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-muted);
}

.tool-card-image-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tool-card-image-block {
  margin: 0;
}

.tool-card-image {
  display: block;
  max-width: min(100%, 420px);
  max-height: 280px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--tool-card-bg-strong);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
  object-fit: contain;
}

.tool-card-code-panel {
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--tool-card-bg-strong);
  overflow: auto;
  max-height: 360px;
}

.tool-card-code-panel pre,
.tool-card-code-panel :deep(pre) {
  margin: 0;
  padding: 10px 12px;
  background: transparent !important;
}

.tool-card[data-status="error"] .tool-card-preview,
.tool-card[data-status="error"] .tool-card-section-text {
  color: var(--error-text);
}

.tool-card-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.tool-card[data-status="error"] .tool-card-details {
  border-top-color: var(--error-border);
}

.tool-card-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

@media (max-width: 640px) {
  .tool-card {
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
  }

  .tool-card-header {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .tool-card-toggle {
    align-self: flex-start;
  }

  .tool-card-title {
    font-size: 0.74rem;
  }

  .tool-card-preview,
  .tool-card-section-text {
    font-size: 0.68rem;
    line-height: 1.55;
  }

  .tool-card-code-panel {
    max-height: 280px;
  }
}
</style>
