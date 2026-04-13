# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Commands

- `npm run check` — type-check with `tsgo`
- `npm run build:web` — build the Vue browser bundle to `web-dist/`
- `npm run dev:web` — Vite dev server for the web UI
- `npm test` / `npm run test:watch` — run Vitest test suite
- `npm fmt` / `npm run fmt:check` — format/check with `oxfmt`
- `npm lint` / `npm run lint:fix` — lint/fix with `oxlint`

## Dev Workflow

When working on the browser UI, set `PI_BRIDGE_PORT=8080` before starting Pi so the Vite `/ws` proxy has a stable target. Run `npm run dev:web`, start Pi, run `/web`, then open the Vite URL.

## Architecture

- `packages/bin/` — Pi extension entry point, registers `/web` command
- `packages/bridge/` — HTTP server, WebSocket RPC bridge, auth, terminal log view
- `packages/web/` — Vue 3 client (Vite + vitest)
