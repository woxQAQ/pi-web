<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  diff: string;
}>();

const lines = computed(() => {
  return props.diff
    .replace(/\r/g, "")
    .split("\n")
    .map(line => ({
      text: line,
      kind: classifyLine(line),
    }));
});

function classifyLine(
  line: string,
): "header" | "hunk" | "added" | "removed" | "context" {
  if (line.startsWith("+++") || line.startsWith("---")) return "header";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}
</script>

<template>
  <div class="diff-view" role="presentation">
    <div
      v-for="(line, index) in lines"
      :key="`${index}:${line.text}`"
      class="diff-line"
      :data-kind="line.kind"
    >
      <pre>{{ line.text }}</pre>
    </div>
  </div>
</template>

<style scoped>
.diff-view {
  margin: 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--tool-card-bg-strong);
  overflow: auto;
  max-height: 360px;
}

.diff-line pre {
  margin: 0;
  padding: 0 12px;
  font-family: "SF Mono", "Monaco", "Menlo", monospace;
  font-size: 0.72rem;
  line-height: 1.65;
  white-space: pre;
  color: var(--text-muted);
  font-weight: 500;
}

.diff-line[data-kind="header"] {
  background: var(--diff-header-bg);
}

.diff-line[data-kind="header"] pre {
  color: var(--text-subtle);
}

.diff-line[data-kind="hunk"] {
  background: var(--diff-hunk-bg);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.diff-line[data-kind="hunk"] pre {
  color: var(--text);
}

.diff-line[data-kind="added"] {
  background: var(--diff-added-bg);
  box-shadow: inset 3px 0 0 var(--diff-added-accent);
}

.diff-line[data-kind="added"] pre {
  color: var(--diff-added-text);
}

.diff-line[data-kind="removed"] {
  background: var(--diff-removed-bg);
  box-shadow: inset 3px 0 0 var(--diff-removed-accent);
}

.diff-line[data-kind="removed"] pre {
  color: var(--diff-removed-text);
}
</style>
