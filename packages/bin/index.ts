/**
 * Pi Extension Entry Point - Web Bridge
 *
 * Registers the `/web` command that starts the bridge server,
 * degrades the terminal to a read-only log view, and allows
 * browser clients to interact with Pi via WebSocket RPC.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isBridgeExitInput } from "../bridge/exit-input.js";
import { startBridge, type BridgeController } from "../bridge/lifecycle.js";
import { createBridgeTerminalView } from "../bridge/terminal-log-view.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeConfig } from "../bridge/types.js";
import type { WsRpcAdapterContext } from "../bridge/ws-rpc-adapter.js";

async function webBridgeHandler(
  args: string,
  ctx: any,
  pi: any,
): Promise<void> {
  const adapterContext: WsRpcAdapterContext = {
    pi,
    ctx,
  };

  const thisFile = fileURLToPath(import.meta.url);
  const projectRoot = join(dirname(thisFile), "..", "..");
  const webDistDir = join(projectRoot, "web-dist");
  const staticDir = existsSync(webDistDir) ? webDistDir : undefined;

  const config: BridgeConfig = {
    ...DEFAULT_BRIDGE_CONFIG,
    port: process.env.PI_BRIDGE_PORT
      ? parseInt(process.env.PI_BRIDGE_PORT, 10)
      : DEFAULT_BRIDGE_CONFIG.port,
    host: process.env.PI_BRIDGE_HOST || DEFAULT_BRIDGE_CONFIG.host,
    staticDir,
  };

  let bridgeController: BridgeController | undefined;
  let terminalView:
    | (ReturnType<typeof createBridgeTerminalView> & { dispose: () => void })
    | undefined;
  let finishWebMode: (() => void) | undefined;

  try {
    bridgeController = await startBridge(config, adapterContext, () => {
      terminalView?.requestExit();
      finishWebMode?.();
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await ctx.ui.custom(
      (_tui: any, _theme: any, _kb: any, done: () => void) => {
        return {
          render() {
            return [`Error: ${errorMsg}`, "", "Press any key to exit..."];
          },
          handleInput() {
            done();
          },
          invalidate() {},
        };
      },
    );
    return;
  }

  const stdinExitHandler = (data: Buffer | string): void => {
    const input = typeof data === "string" ? data : data.toString("utf8");
    if (isBridgeExitInput(input)) {
      finishWebMode?.();
    }
  };

  process.stdin.on("data", stdinExitHandler);

  try {
    await ctx.ui.custom((tui: any, _theme: any, kb: any, done: () => void) => {
      let finishRequested = false;
      finishWebMode = () => {
        if (finishRequested) {
          return;
        }
        finishRequested = true;
        terminalView?.requestExit();
        done();
      };

      const view = createBridgeTerminalView(
        (handler: any) => bridgeController!.subscribe(handler),
        () => bridgeController!.getState(),
        () => bridgeController!.getClients(),
        config,
        () => tui.requestRender(),
      );
      terminalView = view;

      return {
        render() {
          return view.render();
        },
        handleInput(input: string) {
          view.handleInput(input);
          if (isBridgeExitInput(input, kb) || view.shouldExit()) {
            finishWebMode?.();
          }
        },
        shouldExit() {
          return view.shouldExit();
        },
        invalidate() {
          tui.requestRender();
        },
        dispose() {
          view.dispose();
          // Force a full redraw so the tall terminal view cannot leave stale lines behind.
          queueMicrotask(() => tui.requestRender(true));
        },
      };
    });
  } finally {
    finishWebMode = undefined;
    process.stdin.off("data", stdinExitHandler);
    terminalView?.dispose();
    if (bridgeController && bridgeController.getState().status !== "stopped") {
      await bridgeController.stop();
    }
  }
}

export default function registerWebBridge(pi: any, _state: any): void {
  pi.registerCommand("web", {
    description: "Start web bridge server for browser-based interaction",
    handler: async (args: string, ctx: any) => {
      await webBridgeHandler(args, ctx, pi);
    },
  });
}

export { webBridgeHandler };
