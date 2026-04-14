# Pi Web

Pi Web exposes a live Pi session through a browser UI. Run `/web` inside Pi,
open the generated URL, and continue the same session from a desktop or mobile
browser while the terminal switches to a read-only bridge view.

## What It Does

- Mirror an active Pi session into a browser UI over HTTP + WebSocket
- Keep the browser connected to the same session state, transcript, model
  selection, and slash commands
- Support session switching, tree navigation, extension dialogs, notifications,
  and reconnect flow
- Expose LAN and Tailscale-friendly URLs for continuing work from another device
- Reuse a fixed default port so the browser URL stays stable across `/web` runs

## Current Capabilities

The current implementation includes:

- A bridge server embedded in the Pi extension process
- A Vue-based chat UI with transcript rendering, code highlighting, diff views,
  and model selection
- Session rail and tree navigation for browsing session history
- Reconnect handling for temporary network interruptions
- Extension UI routing for prompts, confirmations, editor input, notifications,
  and status updates
- A terminal log view that shows bridge state, connected clients, and shutdown
  instructions

## Requirements

- Node.js `>=20.6.0`
- Pi with extension support
- A local checkout of this repository

## Quick Start

```bash
npm install
npm run build
npm run build:web
```

Then start Pi in this project and run:

```text
/web
```

Pi Web starts an HTTP server on port `8080` by default and prints a URL like:

```text
http://localhost:8080
```

Open that URL in a browser.

Press `Ctrl+C` in the terminal to stop the bridge and return to the normal Pi
TUI.

## Configuration

Pi Web reads its runtime settings from environment variables before the
extension starts.

| Variable         | Default   | Description                                                     |
| ---------------- | --------- | --------------------------------------------------------------- |
| `PI_BRIDGE_HOST` | `0.0.0.0` | Host/interface to bind the HTTP and WebSocket server to         |
| `PI_BRIDGE_PORT` | `8080`    | Port to bind. Set `0` only if you explicitly want a random port |

Notes:

- Binding to `0.0.0.0` allows access from other devices on the same network.
- The terminal log view also prints detected LAN addresses, including Tailscale
  IPs when available.
- There is no bridge token anymore. Any client that can reach the bridge port
  can connect.

## Development

### Commands

```bash
npm test            # run the full test suite
npm run test:watch  # run tests in watch mode
npm run build       # compile the bridge extension
npm run build:web   # build the browser bundle into web-dist/
npm run dev:web     # run the Vite dev server for the web UI
```

### Typical Local Workflow

1. Run `npm run dev:web` while working on the browser UI.
2. Start Pi. The bridge uses port `8080` by default, which matches the Vite
   `/ws` proxy target.
3. Run `/web` in Pi.
4. Open the Vite URL for fast frontend iteration.

## Architecture

Pi Web is split into three parts:

- `packages/bin/` registers the `/web` command and manages the Pi-side lifecycle
- `packages/bridge/` implements the HTTP server, WebSocket RPC bridge, event
  fan-out, and terminal log view
- `packages/web/` contains the Vue client that talks to the bridge over `/ws`

At runtime:

1. `/web` starts the bridge server inside the Pi process.
2. The server serves static assets from `web-dist/` when available.
3. Browser clients connect to `/ws` on the same bridge origin.
4. The bridge maps WebSocket RPC messages onto Pi's extension APIs and forwards
   events back to the browser.

## Project Structure

```text
packages/
  bin/
    index.ts              # /web command entry point
  bridge/
    types.ts              # RPC protocol and bridge types
    bridge-event-bus.ts   # event fan-out and buffering
    lifecycle.ts          # startup, shutdown, and SIGINT handling
    network.ts            # LAN and Tailscale address detection
    server.ts             # HTTP server and WebSocket upgrades
    terminal-log-view.ts  # read-only terminal status view
    ws-rpc-adapter.ts     # bridge between WebSocket RPC and Pi APIs
  web/
    src/
      App.vue             # main browser application shell
      components/         # transcript, dialogs, tree, composer, etc.
      composables/        # WebSocket client state management
      utils/              # transcript/model/render helpers
    vite.config.ts        # web build and dev proxy config
web-dist/                 # generated browser bundle
```

## Testing

The repository uses Vitest for both bridge and web UI coverage.

```bash
npm test
```

## License

MIT
