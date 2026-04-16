<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { highlightCodeHtml, readThemeMode } from "../utils/codeHighlight";

const props = defineProps<{
  code: string;
  path?: string;
}>();

const renderedHtml = ref("");
let renderVersion = 0;
let observer: MutationObserver | undefined;

async function renderCode() {
  const version = ++renderVersion;
  if (!props.code.trim()) {
    renderedHtml.value = "";
    return;
  }

  const html = await highlightCodeHtml(props.code, props.path, readThemeMode());
  if (version !== renderVersion) return;
  renderedHtml.value = html;
}

onMounted(() => {
  const shell = document.querySelector(".app-shell");
  if (shell) {
    observer = new MutationObserver(() => {
      void renderCode();
    });
    observer.observe(shell, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
});

watch(
  () => [props.code, props.path],
  () => {
    void renderCode();
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="renderedHtml" class="highlighted-code" v-html="renderedHtml"></div>
  <pre v-else class="highlighted-code-fallback">{{ code }}</pre>
</template>

<style scoped>
.highlighted-code,
.highlighted-code-fallback {
  margin: 0;
  font-family: var(--pi-font-mono);
  font-size: 0.72rem;
  line-height: 1.6;
  color: var(--text-muted);
}

.highlighted-code :deep(pre) {
  margin: 0;
  padding: 0;
  background: transparent !important;
  overflow-x: auto;
  white-space: pre;
}

.highlighted-code :deep(code) {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

.highlighted-code-fallback {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
