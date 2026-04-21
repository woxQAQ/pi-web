# Autoresearch: initial session list load

## Objective
Reduce the time for the web bridge to answer the first `list_sessions` RPC during browser startup. The user reports that the session list is slow on initial load. The workload is a realistic multi-workspace session store with hundreds of JSONL session files, including long historical transcripts and some long initial prompts so the loop does not overfit to tiny session files or short first messages.

## Metrics
- **Primary**: `session_list_ms` (ms, lower is better), median RPC elapsed time across repeated fresh adapters.
- **Secondary**: `best_ms`, `worst_ms`, `session_count`, `entries_per_session`, `large_session_count`, `long_initial_prompt_count`, `total_session_bytes`.

## How to Run
`./autoresearch.sh` outputs `METRIC name=value` lines.

## Files in Scope
- `packages/bridge/ws-rpc-adapter.ts`: RPC implementation for `list_sessions` and helpers that scan session JSONL files.
- `packages/bridge/session-registry.ts`: cached detached session managers that interact with list state.
- `packages/bridge/__tests__/ws-rpc-adapter.test.ts`: regression coverage for list sessions behavior.
- `scripts/bench-session-list.ts`: synthetic benchmark for the startup session list workload.
- `autoresearch.sh`, `autoresearch.checks.sh`, `autoresearch.md`, `autoresearch.ideas.md`: autoresearch harness and notes.

## Off Limits
- Do not change Pi session file formats.
- Do not skip valid sessions or cap the returned list just to improve the metric.
- Do not special-case the benchmark corpus, paths, or environment beyond existing `PI_WEB_SESSIONS_ROOT` behavior.
- Do not add runtime dependencies.

## Constraints
- Preserve current `list_sessions` response shape and ordering.
- Include stored sessions, the live session, and cached detached sessions.
- Malformed or unreadable session files should still be skipped without failing the RPC.
- Keep correctness checks passing.

## What's Been Tried
- Baseline: 29.46ms median. Implementation enumerated session files, opened each with `SessionManager.open`, and derived display metadata from full parsed entries.
- Kept: lightweight stored-session metadata parsing avoids `SessionManager.open` for list rows, lowering median to 17.171ms.
- Kept: stop scanning once the first user message is found because it takes precedence over explicit names, lowering median to 8.437ms.
- Kept: line-by-line scanning without `split()` lowers allocation and median to 6.64ms.
- Kept: precomputed sort keys avoid repeated `Date.parse` in comparator, lowering median to 5.841ms.
- Kept: combined timestamp normalization and sort-key parsing lowers median to 5.762ms.
- Discarded on the original small/medium corpus: canonical timestamp regex fast path, array path collection without a Set, workspace metadata caching, head-only reads, avoiding `trim()`, comparator hoisting, live running-state caching, direct timestamp parsing, display-text shortcuts, and string-content inlining all regressed the primary metric.
- Workload broadened after run 23 to include long historical transcripts. This avoids overfitting to tiny JSONL files and re-tests whether bounded metadata reads are worthwhile for real slow startup cases.
- Mixed long-transcript baseline: 13.092ms median with 480 sessions, 80 long sessions, and 13.3MB total JSONL.
- Kept on mixed corpus: bounded metadata head reads improved median to 9.651ms, then tuning the head size to 2KB improved median to 5.936ms.
- Kept on mixed corpus: generated user string-content extraction improved median to 5.852ms, then retuning head size to 512 bytes improved median to 5.285ms.
- Discarded on mixed corpus: 256-byte, 768-byte, 1536-byte, 1KB before fast extraction, 3KB/4KB/8KB/32KB head sizes, shared head buffer, parser wrapper removal, direct live-file duplicate checks, unbounded async reads, avoiding head slicing, stat-based small-file reads, and array path collection all regressed.
- Workload broadened again after run 48 to include long initial prompts. This checks that head-size tuning does not overfit to short first user messages.
