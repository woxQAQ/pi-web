import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startStandaloneBridge,
  type StandaloneBridgeController,
} from "@pi-web/bridge/standalone/server";
import { DEFAULT_BRIDGE_CONFIG } from "@pi-web/bridge/types";
import { app, BrowserWindow } from "electron";

const DEV_RENDERER_URL = "http://127.0.0.1:5173";
const DEV_BRIDGE_PORT = 8080;
const DEV_BRIDGE_HOST = "127.0.0.1";
const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));

let mainWindow: BrowserWindow | null = null;
let bridgeController: StandaloneBridgeController | null = null;
let shuttingDown = false;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveRendererUrl(): string | null {
  const raw = process.env.PI_WEB_ELECTRON_RENDERER_URL?.trim();
  if (raw) return raw;
  return app.isPackaged ? null : DEV_RENDERER_URL;
}

function resolveWorkspacePath(): string {
  const raw = process.env.PI_WEB_ELECTRON_WORKSPACE?.trim();
  if (raw) return raw;

  // Packaged builds need a safe default until a workspace picker is added.
  return app.isPackaged ? app.getPath("home") : projectRoot;
}

function resolveStaticDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "web-dist")
    : join(projectRoot, "web-dist");
}

async function ensureBridgeStarted(): Promise<StandaloneBridgeController> {
  if (bridgeController) {
    return bridgeController;
  }

  const staticDir = resolveStaticDir();
  const rendererUrl = resolveRendererUrl();
  const preferredPort = rendererUrl
    ? readIntEnv("PI_WEB_ELECTRON_BRIDGE_PORT", DEV_BRIDGE_PORT)
    : 0;

  bridgeController = await startStandaloneBridge(
    {
      ...DEFAULT_BRIDGE_CONFIG,
      host: DEV_BRIDGE_HOST,
      port: preferredPort,
      staticDir: existsSync(staticDir) ? staticDir : undefined,
    },
    {
      captureSigint: false,
      cwd: resolveWorkspacePath(),
    },
  );

  return bridgeController;
}

async function createMainWindow(): Promise<void> {
  const bridge = await ensureBridgeStarted();
  const bridgeUrl = bridge.getBridgeUrl();
  const rendererUrl = resolveRendererUrl() ?? bridgeUrl;

  if (!rendererUrl) {
    throw new Error("Bridge started without a reachable URL");
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(rendererUrl);
}

async function stopBridge(): Promise<void> {
  if (!bridgeController) {
    return;
  }

  const current = bridgeController;
  bridgeController = null;
  await current.stop();
}

app.whenReady().then(async () => {
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("before-quit", event => {
  if (shuttingDown || !bridgeController) {
    return;
  }

  shuttingDown = true;
  event.preventDefault();
  void stopBridge().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
