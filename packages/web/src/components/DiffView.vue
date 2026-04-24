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
    <table class="diff-table" role="presentation">
      <tbody>
        <tr
          v-for="(line, index) in lines"
          :key="`${index}:${line.text}`"
          class="diff-line"
          :data-kind="line.kind"
        >
          <td>
            <pre>{{ line.text }}</pre>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.diff-view {
  margin: 0;
  border: 1px solid var(--tool-output-border);
  border-radius: 10px;
  background: var(--tool-output-bg);
  overflow: auto;
  max-height: 360px;
}

.diff-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
}

.diff-line td {
  padding: 0;
  color: var(--text-muted);
}

.diff-line pre {
  margin: 0;
  padding: 0 12px;
  font-family: var(--pi-font-mono);
  font-size: 0.72rem;
  line-height: 1.65;
  white-space: pre;
  color: inherit;
  font-weight: 500;
}

.diff-line[data-kind="header"] td {
  background: color-mix(in srgb, var(--tool-output-bg) 92%, var(--border));
  color: var(--text-subtle);
}

.diff-line[data-kind="hunk"] td {
  border-top: 1px solid
    color-mix(in srgb, var(--tool-output-border) 82%, transparent);
  border-bottom: 1px solid
    color-mix(in srgb, var(--tool-output-border) 82%, transparent);
  background: color-mix(in srgb, var(--tool-output-bg) 84%, var(--border));
  color: var(--text);
}

.diff-line[data-kind="added"] td {
  background: color-mix(
    in srgb,
    var(--diff-added-bg) 72%,
    var(--tool-output-bg)
  );
  box-shadow: inset 3px 0 0 var(--diff-added-accent);
  color: var(--diff-added-text);
}

.diff-line[data-kind="removed"] td {
  background: color-mix(
    in srgb,
    var(--diff-removed-bg) 72%,
    var(--tool-output-bg)
  );
  box-shadow: inset 3px 0 0 var(--diff-removed-accent);
  color: var(--diff-removed-text);
}
</style>
