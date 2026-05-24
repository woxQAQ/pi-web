<script lang="ts">
  import MarkdownRenderer from "./MarkdownRenderer.svelte";

  let {
    skillName = "",
    skillContent = "",
    onOpenFileReference,
  }: {
    skillName: string;
    skillContent: string;
    onOpenFileReference?: (payload: { path: string; lineNumber: number }) => void;
  } = $props();

  let expanded = $state(false);
</script>

<div class="skill-box">
  <button
    type="button"
    class="skill-box-toggle"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span class="skill-box-label">[skill]</span>
    <span class="skill-box-name">{skillName}</span>
  </button>

  {#if expanded}
    <div class="skill-box-content">
      <MarkdownRenderer
        content={skillContent}
        onOpenFileReference={onOpenFileReference}
      />
    </div>
  {/if}
</div>

<style>
  .skill-box {
    max-width: min(720px, 100%);
    margin: 0 auto;
    border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--panel) 86%, transparent);
    overflow: hidden;
  }

  .skill-box-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    border: none;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .skill-box-toggle:hover {
    background: color-mix(in srgb, var(--panel) 94%, transparent);
  }

  .skill-box-label {
    flex: none;
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .skill-box-name {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text);
  }

  .skill-box-content {
    padding: 0 14px 14px;
    font-size: 0.76rem;
    line-height: 1.6;
    color: var(--text-muted);
    max-height: 400px;
    overflow-y: auto;
  }
</style>
