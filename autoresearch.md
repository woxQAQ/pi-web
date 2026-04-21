# Autoresearch: initial session list load

## Objective
Reduce the time for the web bridge to answer the first `list_sessions` RPC during browser startup. The user reports that the session list is slow on initial load. The workload is a realistic multi-workspace session store with hundreds of JSONL session files.

## Metrics
- **Primary**: `session_list_ms` (ms, lower is better), median RPC elapsed time across repeated fresh adapters.
- **Secondary**: `best_ms`, `worst_ms`, `session_count`, `entries_per_session`.

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
- Baseline target: current implementation enumerates session files, opens each one with `SessionManager.open`, and derives display metadata from full parsed entries.
