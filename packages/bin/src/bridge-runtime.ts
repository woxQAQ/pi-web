import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_BRIDGE_CONFIG as STATIC_DEFAULT_BRIDGE_CONFIG,
  type BridgeConfig,
} from "@pi-web/bridge/types";
import type { WsRpcAdapterContext } from "@pi-web/bridge/ws-rpc-adapter";
import { createJiti } from "jiti/static";
import { resolveBridgeDevWatchPath } from "./dev-bridge-reload.js";
import {
  startBridge as staticStartBridge,
  type BridgeController,
  type BridgeDoneCallback,
  type StartBridgeOptions,
} from "./lifecycle.js";

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
});

export interface BridgeRuntime {
  DEFAULT_BRIDGE_CONFIG: BridgeConfig;
  startBridge: (
    config: BridgeConfig,
    context: WsRpcAdapterContext,
    done: BridgeDoneCallback,
    options?: StartBridgeOptions,
  ) => Promise<BridgeController>;
}

const staticRuntime: BridgeRuntime = {
  DEFAULT_BRIDGE_CONFIG: STATIC_DEFAULT_BRIDGE_CONFIG,
  startBridge: staticStartBridge,
};

export async function loadBridgeRuntime(
  extensionEntryFile: string,
): Promise<BridgeRuntime> {
  if (!resolveBridgeDevWatchPath(extensionEntryFile)) {
    return staticRuntime;
  }

  const runtimeEntryPath = join(
    dirname(resolve(extensionEntryFile)),
    "runtime-bridge-entry.ts",
  );

  return jiti.import(runtimeEntryPath, { default: true });
}
