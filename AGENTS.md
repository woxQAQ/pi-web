# AGENTS.md

This file provides guidance to coding agents when working with code in this
repository.

## Commands

- `pnpm run check` — type-check with `tsgo`
- `pnpm run build:web` — build the Vue browser bundle to `web-dist/`
- `pnpm run dev:web` — Vite dev server for the web UI
- `pnpm test` / `pnpm run test:watch` — run Vitest test suite
- `pnpm fmt` / `pnpm run fmt:check` — format/check with `oxfmt`
- `pnpm lint` / `pnpm run lint:fix` — lint/fix with `oxlint`

## Dev Workflow

When working on the browser UI, set `PI_BRIDGE_PORT=8080` before starting Pi so
the Vite `/ws` proxy has a stable target. Run `npm run dev:web`, start Pi, run
`/web`, then open the Vite URL.

## Architecture

- `packages/bin/` — Pi extension entry point, registers `/web` command
- `packages/bridge/` — HTTP server, WebSocket RPC bridge, auth, terminal log
  view
- `packages/web/` — Vue 3 client (Vite + vitest)

## important tips

- You should read the source code of @mariozechner/pi-coding-agent,
  @mariozechner/pi-ai carefuilly, especially the wire protocol of pi
- Do not add thin wrapper functions around existing functions unless the wrapper
  adds real value beyond renaming.
- use git conventional commits specification when commit
- do not use `nl -ba $file | rg -n $pattern`, use `car $file | rg -n $pattern`
  instead
