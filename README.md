# pi-web

A [Pi](https://github.com/mariozechner/pi-coding-agent) extension that opens a
WebSocket bridge for browser-based interaction.

Running `/web` inside Pi starts a local HTTP/WebSocket server and degrades the
terminal to a read-only log view. Open the served URL in a browser to interact
with Pi through a full-featured chat UI.

---

## Quick start

Install the published package into your Pi environment:

```bash
pi install woxqaq@pi-web-bridge
```

For development snapshots, you can still install directly from git:

```bash
pi install git:https://github.com/woxQAQ/pi-web
```

Start Pi, then run:

```
/web
```

Open the printed URL (default: `http://localhost:8080`) in your browser.

---

## Features

- **Browser-based Pi client** — chat, command palette, diff viewer, tool cards,
  markdown rendering with syntax highlighting
- **WebSocket RPC bridge** — real-time bidirectional communication between the
  browser and Pi's backend
- **Multi-client support** — several browsers can connect simultaneously; events
  are fanned out to all clients
- **SPA static hosting** — the Vue 3 UI is served from `web-dist/` with fallback
  routing

---

## Environment variables

| Variable         | Description                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `PI_BRIDGE_PORT` | Bridge HTTP/WebSocket port (default: `8080`)                                                     |
| `PI_BRIDGE_HOST` | Bridge bind host (default: `0.0.0.0`)                                                            |
| `PI_WEB_DEBUG`   | Enable debug mode in the web UI (`1` or `true`), now debug mode only support show the message ID |

---

## License

MIT

## Known issues

- Safari(IOS/MacOS) has problems on websocket connection
