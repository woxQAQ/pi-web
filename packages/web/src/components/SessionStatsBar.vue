<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  stats: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
    messageCount: number;
    cost: number;
  } | null;
}>();

const contextPercent = computed(() => {
  if (!props.stats || props.stats.percent == null) return null;
  return Math.min(props.stats.percent, 100);
});

const tokenLabel = computed(() => {
  if (!props.stats || props.stats.tokens == null) return null;
  const t = props.stats.tokens;
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1_000) return `${(t / 1_000).toFixed(1)}k`;
  return `${t}`;
});

const windowLabel = computed(() => {
  if (!props.stats) return null;
  const w = props.stats.contextWindow;
  if (w >= 1_000_000) return `${(w / 1_000_000).toFixed(0)}M`;
  if (w >= 1_000) return `${(w / 1_000).toFixed(0)}k`;
  return `${w}`;
});

const costLabel = computed(() => {
  if (!props.stats || props.stats.cost <= 0) return null;
  const c = props.stats.cost;
  if (c < 0.01) return `$${c.toFixed(4)}`;
  if (c < 1) return `$${c.toFixed(3)}`;
  return `$${c.toFixed(2)}`;
});

const barColor = computed(() => {
  if (contextPercent.value == null) return "var(--text-subtle)";
  if (contextPercent.value < 50) return "var(--text-subtle)";
  if (contextPercent.value < 80) return "#eab308";
  return "#ef4444";
});
</script>

<template>
  <div v-if="stats" class="stats-bar">
    <div class="stats-inner">
      <div v-if="contextPercent != null" class="stat-chip context-chip">
        <div class="context-bar-track">
          <div
            class="context-bar-fill"
            :style="{
              width: `${contextPercent}%`,
              background: barColor,
            }"
          />
        </div>
        <span class="stat-label">
          {{ tokenLabel }} / {{ windowLabel }}
          <span class="stat-dim">({{ contextPercent.toFixed(0) }}%)</span>
        </span>
      </div>
      <div v-if="costLabel" class="stat-chip cost-chip">
        <span class="stat-label">{{ costLabel }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 6px 24px 0;
}

.stats-inner {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: min(960px, 100%);
  margin: 0 auto;
}

.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--panel) 60%, transparent);
}

.context-chip {
  gap: 8px;
}

.cost-chip {
  border-color: color-mix(in srgb, var(--border) 50%, transparent);
}

.context-bar-track {
  width: 48px;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--border) 80%, transparent);
  overflow: hidden;
  flex-shrink: 0;
}

.context-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease, background 0.3s ease;
}

.stat-label {
  font-family: "SF Mono", "Monaco", "Menlo", "Consolas", monospace;
  font-size: 0.64rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.stat-dim {
  color: var(--text-subtle);
}

@media (max-width: 900px) {
  .stats-bar {
    padding: 6px 16px 0;
  }
}
</style>
