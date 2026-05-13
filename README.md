# pi-web

[![Dataset on HF](https://huggingface.co/datasets/huggingface/badges/resolve/main/dataset-on-hf-sm.svg)](https://huggingface.co/datasets/woxQAQ/pi-web)

A dashboard based on pi agent SDK. Full slop project to apply the comprehension
about agentic coding by me.

Now the dashboard release as a pi extension, after installing the extension, you
can press `/web` in the pi tui and open the `localhost:7036` in your browser to
enjoy the same experience in pi tui.

---

## Feature

- Full-featured pi tui experience
- Codex-like file viewer(review panel are coming)
- Base46 color theme system(Welcome for new theme contribute).
- Stateless, reuse the pi's sessions and config

---

## Quick start

Install the published package into your Pi environment:

```bash
pi install npm:@woxqaq/pi-web
```

Start Pi, then run:

```
/web
```

Open the printed URL (default: `http://localhost:7036`) in your browser.

## Standalone bridge

You can also run the bridge without attaching to a live Pi TUI process:

```bash
pnpm run build:web
pnpm run dev:bridge:standalone
```

That starts a standalone bridge dev server on `http://localhost:8080` by
default. In source mode it watches `packages/bridge/` and hot-reloads the bridge
runtime without interrupting the active session. If `web-dist/` is missing, the
bridge still starts and serves a placeholder page.

If you need a different port:

```bash
pnpm run dev:bridge:standalone -- --port 9000
```

For a built entrypoint, use:

```bash
pnpm run build:bridge
node dist/bridge/standalone/main.js
```

---

## License

MIT

## Known issues

- Safari(IOS/MacOS) has problems on websocket connection
