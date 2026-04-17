/**
 * Persistent plugin state stored in ~/.pi/agent/pi-web.json.
 *
 * Survives /web restarts and keeps state on the Pi side instead of
 * depending on browser storage.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const STATE_FILE = path.join(os.homedir(), ".pi", "agent", "pi-web.json");

import type { RpcPluginStateValue } from "./types.js";

let cache: Record<string, RpcPluginStateValue> | null = null;

function readStateFile(): Record<string, RpcPluginStateValue> {
  if (cache !== null) return cache;
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    cache = JSON.parse(raw);
  } catch {
    cache = {};
  }
  return cache!;
}

function writeStateFile(state: Record<string, RpcPluginStateValue>): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
  cache = state;
}

/**
 * Get a persisted value by key. Returns `undefined` when absent.
 */
export function getPluginState(key: string): RpcPluginStateValue | undefined {
  return readStateFile()[key];
}

/**
 * Set a persisted value by key. Merges into the existing file.
 */
export function setPluginState(key: string, value: RpcPluginStateValue): void {
  const state = { ...readStateFile(), [key]: value };
  writeStateFile(state);
}
