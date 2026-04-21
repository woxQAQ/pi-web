import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { WebSocket } from "ws";
import { BridgeEventBus } from "../packages/bridge/bridge-event-bus.js";
import { DEFAULT_BRIDGE_CONFIG, type ServerMessage } from "../packages/bridge/types.js";
import { WsRpcAdapter, type WsRpcAdapterContext } from "../packages/bridge/ws-rpc-adapter.js";

const WORKSPACE_COUNT = 8;
const SESSIONS_PER_WORKSPACE = 60;
const MESSAGES_PER_SESSION = 18;
const REPEATS = Number.parseInt(process.env.SESSION_LIST_REPEATS ?? "7", 10);

type Handler = (...args: unknown[]) => void;

class MockSocket {
  readonly handlers = new Map<string, Handler[]>();
  readonly sent: string[] = [];
  readyState = 1;

  on(event: string, handler: Handler): this {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  trigger(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

function isoFromIndex(index: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
}

function writeSessionFile(
  filePath: string,
  workspacePath: string,
  workspaceIndex: number,
  sessionIndex: number,
): void {
  const id = `session-${workspaceIndex}-${sessionIndex}`;
  const createdAt = isoFromIndex(workspaceIndex * SESSIONS_PER_WORKSPACE + sessionIndex);
  const entries: unknown[] = [
    {
      type: "session",
      version: 3,
      id,
      timestamp: createdAt,
      cwd: workspacePath,
    },
  ];

  let parentId: string | null = null;
  for (let messageIndex = 0; messageIndex < MESSAGES_PER_SESSION; messageIndex += 1) {
    const entryId = `${id}-message-${messageIndex}`;
    const role = messageIndex % 2 === 0 ? "user" : "assistant";
    entries.push({
      type: "message",
      id: entryId,
      parentId,
      timestamp: isoFromIndex(messageIndex),
      message: {
        role,
        content:
          role === "user"
            ? `Open benchmark session ${sessionIndex} in workspace ${workspaceIndex}`
            : [
                {
                  type: "text",
                  text: `Assistant response ${messageIndex} for ${id}`,
                },
              ],
        timestamp: Date.parse(createdAt) + messageIndex,
        provider: role === "assistant" ? "openai" : undefined,
        model: role === "assistant" ? "gpt-4.1" : undefined,
        usage:
          role === "assistant"
            ? {
                input: 1000 + messageIndex,
                output: 200 + messageIndex,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 1200 + messageIndex * 2,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              }
            : undefined,
      },
    });
    parentId = entryId;
  }

  fs.writeFileSync(filePath, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
}

function createCorpus(): { root: string; liveSessionFile: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-session-list-bench-"));
  let liveSessionFile = "";

  for (let workspaceIndex = 0; workspaceIndex < WORKSPACE_COUNT; workspaceIndex += 1) {
    const workspacePath = path.join(root, `workspace-${workspaceIndex}`);
    const sessionDir = path.join(root, `--workspace-${workspaceIndex}--`);
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(sessionDir, { recursive: true });

    for (let sessionIndex = 0; sessionIndex < SESSIONS_PER_WORKSPACE; sessionIndex += 1) {
      const filePath = path.join(
        sessionDir,
        `2026-01-01T00-${String(sessionIndex).padStart(2, "0")}-00-000Z_session-${workspaceIndex}-${sessionIndex}.jsonl`,
      );
      writeSessionFile(filePath, workspacePath, workspaceIndex, sessionIndex);
      if (workspaceIndex === 0 && sessionIndex === SESSIONS_PER_WORKSPACE - 1) {
        liveSessionFile = filePath;
      }
    }
  }

  return { root, liveSessionFile };
}

function createContext(liveSessionFile: string): WsRpcAdapterContext {
  const sessionManager = SessionManager.open(liveSessionFile);
  const model = {
    id: "gpt-4.1",
    name: "GPT-4.1",
    api: "openai-responses",
    provider: "openai",
    reasoning: true,
    contextWindow: 128000,
    maxTokens: 8192,
  };

  const pi = {
    on: () => {},
    getThinkingLevel: () => "medium",
    getCommands: () => [],
    setThinkingLevel: () => {},
    setModel: async () => true,
    sendUserMessage: async () => {},
  } as unknown as ExtensionAPI;

  const ctx = {
    sessionManager,
    model,
    modelRegistry: { getAvailable: () => [model] },
    isIdle: () => true,
    signal: undefined,
    abort: () => {},
    compact: async () => {},
    shutdown: () => {},
    hasPendingMessages: () => false,
    getContextUsage: () => ({ tokens: 1200, contextWindow: 128000, percent: 0.9 }),
    getSystemPrompt: () => "",
    cwd: sessionManager.getCwd() ?? process.cwd(),
    ui: { custom: async () => undefined },
    hasUI: true,
    waitForIdle: async () => {},
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    navigateTree: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    reload: async () => {},
  } as unknown as ExtensionCommandContext;

  return { pi, ctx };
}

async function measureListSessions(liveSessionFile: string, index: number): Promise<number> {
  const ws = new MockSocket();
  const context = createContext(liveSessionFile);
  const adapter = new WsRpcAdapter(
    { id: `bench-client-${index}`, seq: index, connectedAt: new Date().toISOString() },
    ws as unknown as WebSocket,
    context,
    DEFAULT_BRIDGE_CONFIG,
    new BridgeEventBus(DEFAULT_BRIDGE_CONFIG),
    () => {},
  );

  const commandId = `list-${index}`;
  const responsePromise = new Promise<ServerMessage>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for list_sessions")), 10_000);
    const originalSend = ws.send.bind(ws);
    ws.send = (data: string) => {
      originalSend(data);
      const message = JSON.parse(data) as ServerMessage;
      if (
        message.type === "response" &&
        message.payload.command === "list_sessions" &&
        message.payload.id === commandId
      ) {
        clearTimeout(timeout);
        resolve(message);
      }
    };
  });

  const start = performance.now();
  ws.trigger(
    "message",
    Buffer.from(
      JSON.stringify({
        type: "command",
        payload: { id: commandId, type: "list_sessions" },
      }),
    ),
  );
  const response = await responsePromise;
  const elapsed = performance.now() - start;

  if (response.type !== "response" || !response.payload.success) {
    throw new Error("list_sessions failed");
  }
  const sessionCount = (response.payload.data as { sessions?: unknown[] }).sessions?.length ?? 0;
  if (sessionCount !== WORKSPACE_COUNT * SESSIONS_PER_WORKSPACE) {
    throw new Error(`expected ${WORKSPACE_COUNT * SESSIONS_PER_WORKSPACE} sessions, got ${sessionCount}`);
  }

  adapter.dispose();
  return elapsed;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main(): Promise<void> {
  const { root, liveSessionFile } = createCorpus();
  process.env.PI_WEB_SESSIONS_ROOT = root;

  try {
    const timings: number[] = [];
    for (let index = 0; index < REPEATS; index += 1) {
      timings.push(await measureListSessions(liveSessionFile, index));
    }

    const medianMs = median(timings);
    const bestMs = Math.min(...timings);
    const worstMs = Math.max(...timings);
    const sessionCount = WORKSPACE_COUNT * SESSIONS_PER_WORKSPACE;
    const entriesPerSession = MESSAGES_PER_SESSION + 1;
    console.log(`timings_ms=${timings.map(value => value.toFixed(2)).join(",")}`);
    console.log(`METRIC session_list_ms=${medianMs.toFixed(3)}`);
    console.log(`METRIC best_ms=${bestMs.toFixed(3)}`);
    console.log(`METRIC worst_ms=${worstMs.toFixed(3)}`);
    console.log(`METRIC session_count=${sessionCount}`);
    console.log(`METRIC entries_per_session=${entriesPerSession}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.PI_WEB_SESSIONS_ROOT;
  }
}

await main();
