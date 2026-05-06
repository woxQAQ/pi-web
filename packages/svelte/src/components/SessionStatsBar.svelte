<script lang="ts">
  import type {
    RpcGitRepoState,
    RpcSessionStats,
    RpcWorkspaceEnvironment,
  } from "@pi-web/bridge/types";
  import GitBranchDropdown from "./GitBranchDropdown.svelte";

  let {
    stats = null as RpcSessionStats | null,
    gitBranch = null as string | null,
    workspaceEnvironments = [] as RpcWorkspaceEnvironment[],
    gitRepoState = null as RpcGitRepoState | null,
    gitRepoLoading = false,
    gitBranchSwitching = false,
    gitActionsDisabled = false,
    refreshGitRepoState = (_?: boolean) =>
      Promise.resolve(null as RpcGitRepoState | null),
    switchGitBranch = (_: string) =>
      Promise.resolve(null as RpcGitRepoState | null),
    createGitBranch = (_: string) =>
      Promise.resolve(null as RpcGitRepoState | null),
  } = $props();

  function compactTokens(count: number) {
    if (count < 1_000) return `${count}`;
    if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
    if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
    if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    return `${Math.round(count / 1_000_000)}M`;
  }

  let contextPercent = $derived(
    stats?.percent != null ? Math.min(stats.percent, 100) : null,
  );
  let windowLabel = $derived(
    stats ? compactTokens(stats.contextWindow) : null,
  );
  let costLabel = $derived(
    stats && stats.cost > 0 ? `$${stats.cost.toFixed(3)}` : null,
  );
  let inputLabel = $derived(
    stats && stats.inputTokens > 0 ? `↑${compactTokens(stats.inputTokens)}` : null,
  );
  let outputLabel = $derived(
    stats && stats.outputTokens > 0 ? `↓${compactTokens(stats.outputTokens)}` : null,
  );
  let cacheReadLabel = $derived(
    stats && stats.cacheReadTokens > 0 ? `R${compactTokens(stats.cacheReadTokens)}` : null,
  );
  let cacheWriteLabel = $derived(
    stats && stats.cacheWriteTokens > 0 ? `W${compactTokens(stats.cacheWriteTokens)}` : null,
  );
  let gitBranchLabel = $derived(gitBranch?.trim() ? gitBranch.trim() : null);
  let wsEnvs = $derived(
    (workspaceEnvironments ?? []).filter(e => Boolean(e?.label?.trim())),
  );
  let hasStatsContent = $derived(
    inputLabel != null ||
      outputLabel != null ||
      cacheReadLabel != null ||
      cacheWriteLabel != null ||
      contextPercent != null ||
      costLabel != null,
  );
  let hasVisibleContent = $derived(
    gitBranchLabel != null || wsEnvs.length > 0 || hasStatsContent,
  );
  let barColor = $derived.by(() => {
    if (contextPercent == null) return "var(--text-subtle)";
    if (contextPercent < 50) return "var(--text-subtle)";
    if (contextPercent < 80) return "var(--warning)";
    return "var(--danger)";
  });
</script>

{#if hasVisibleContent}
  <div class="stats-bar">
    <div class="stats-inner">
      <div
        class="stats-leading"
        class:empty-leading={!(gitBranchLabel || wsEnvs.length > 0)}
      >
        {#if gitBranchLabel}
          <GitBranchDropdown
            label={gitBranchLabel}
            repoState={gitRepoState}
            loading={gitRepoLoading}
            switching={gitBranchSwitching}
            disabled={gitActionsDisabled}
            refresh={refreshGitRepoState}
            switchBranch={switchGitBranch}
            createBranch={createGitBranch}
          />
        {/if}
        {#each wsEnvs as environment (`${environment.type}:${environment.label}`)}
          <div
            class="stat-chip env-chip"
            title={environment.detail || environment.label}
          >
            <span class="stat-label env-label">{environment.label}</span>
          </div>
        {/each}
      </div>
      {#if hasStatsContent}
        <div class="stats-trailing">
          {#if inputLabel}
            <div class="stat-chip token-chip">
              <span class="stat-label">{inputLabel}</span>
            </div>
          {/if}
          {#if outputLabel}
            <div class="stat-chip token-chip">
              <span class="stat-label">{outputLabel}</span>
            </div>
          {/if}
          {#if cacheReadLabel}
            <div class="stat-chip token-chip">
              <span class="stat-label">{cacheReadLabel}</span>
            </div>
          {/if}
          {#if cacheWriteLabel}
            <div class="stat-chip token-chip">
              <span class="stat-label">{cacheWriteLabel}</span>
            </div>
          {/if}
          {#if costLabel}
            <div class="stat-chip cost-chip">
              <span class="stat-label">{costLabel}</span>
            </div>
          {/if}
          {#if contextPercent != null}
            <div class="stat-chip context-chip">
              <div class="context-bar-track">
                <div
                  class="context-bar-fill"
                  style="width: {contextPercent}%; background: {barColor}"
                ></div>
              </div>
              <span class="stat-label">
                {contextPercent.toFixed(1)}%/{windowLabel}
              </span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
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
    gap: 8px;
    width: min(960px, 100%);
    margin: 0 auto;
  }

  .stats-leading {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .env-chip {
    border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
    background: color-mix(in srgb, var(--accent) 8%, var(--panel));
  }

  .env-label {
    color: var(--text-subtle);
  }

  .stats-trailing {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-left: auto;
    min-width: 0;
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

  .token-chip,
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
    transition:
      width 0.4s ease,
      background 0.3s ease;
  }

  .stat-label {
    font-family: var(--pi-font-sans);
    font-size: 0.64rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    .stats-bar {
      justify-content: flex-start;
      padding: 6px 16px 0;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
    }

    .stats-bar::-webkit-scrollbar {
      display: none;
    }

    .stats-inner {
      width: max-content;
      min-width: 100%;
      flex-wrap: nowrap;
      gap: 6px;
    }

    .stats-leading,
    .stats-trailing,
    .stat-chip {
      flex-shrink: 0;
    }

    .stats-trailing {
      width: max-content;
      margin-left: auto;
      justify-content: flex-end;
      flex-wrap: nowrap;
      gap: 6px;
    }
  }

  @media (max-width: 640px) {
    .stats-bar {
      padding: 4px 12px 0;
    }

    .context-bar-track {
      width: 40px;
    }
  }
</style>
