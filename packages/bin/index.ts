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
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { isBridgeExitInput } from "../bridge/exit-input.js";
import { startBridge, type BridgeController } from "../bridge/lifecycle.js";
import { createBridgeTerminalView } from "../bridge/terminal-log-view.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeConfig } from "../bridge/types.js";
import type { WsRpcAdapterContext } from "../bridge/ws-rpc-adapter.js";

async function webBridgeHandler(
  _args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
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
    bridgeController = await startBridge(
      config,
      adapterContext,
      () => {
        terminalView?.requestExit();
        finishWebMode?.();
      },
      {
        // Ctrl+C is already handled by the Pi custom view + stdin bridge-exit
        // detection. Avoid registering another process-level SIGINT handler here,
        // which can leave Pi in a bad state after exiting /web.
        captureSigint: false,
      },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await ctx.ui.custom<void>((_tui, _theme, _kb, done) => {
      return {
        render() {
          return [`Error: ${errorMsg}`, "", "Press any key to exit..."];
        },
        handleInput() {
          done();
        },
        invalidate() {},
      };
    });
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
    await ctx.ui.custom<void>((tui, _theme, kb, done) => {
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
        handler => bridgeController!.subscribe(handler),
        () => bridgeController!.getState(),
        () => bridgeController!.getClients(),
        config,
        force => tui.requestRender(force),
      );
      terminalView = view;

      return {
        render() {
          return view.render();
        },
        handleInput(input: string) {
          view.handleInput(input);
          if (
            isBridgeExitInput(input, {
              matches: (candidate, action) => {
                if (action !== "selectCancel" && action !== "copy") {
                  return false;
                }
                return kb.matches(
                  candidate,
                  action as unknown as Parameters<typeof kb.matches>[1],
                );
              },
            }) ||
            view.shouldExit()
          ) {
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

export default function registerWebBridge(
  pi: ExtensionAPI,
  _state: unknown,
): void {
  pi.registerCommand("web", {
    description: "Start web bridge server for browser-based interaction",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await webBridgeHandler(args, ctx, pi);
    },
  });
}

export { webBridgeHandler };
