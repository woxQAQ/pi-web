import { describe, expect, it, vi } from "vitest";
import {
  applyGetStateResponse,
  applySessionSnapshotResponse,
  type GetStateResponseDeps,
  type SnapshotResponseDeps,
} from "../src/composables/bridgeStore.svelte";
import type { RpcSessionState, RpcTranscriptPage } from "@pi-web/bridge/types";

function makeSessionState(
  overrides: Partial<RpcSessionState> = {},
): RpcSessionState {
  return {
    sessionId: "test-session",
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "all",
    autoCompactionEnabled: false,
    messageCount: 0,
    pendingMessageCount: 0,
    ...overrides,
  };
}

function makeTranscriptPage(overrides: Partial<RpcTranscriptPage> = {}): RpcTranscriptPage {
  return {
    messages: [],
    hasOlder: false,
    ...overrides,
  };
}

function makeSnapshotDeps(overrides: Partial<SnapshotResponseDeps> = {}): SnapshotResponseDeps {
  return {
    getDisplayedSessionPath: () => null,
    getWorkspaceEntriesContextKey: () => null,
    applySessionTranscriptPage: vi.fn(),
    setLiveSessionPath: vi.fn(),
    applyTreeEntriesUpdate: vi.fn(),
    setActiveTreeSessionPath: vi.fn(),
    ensureWorkspaceSummary: vi.fn(),
    getSessionState: () => null,
    setSessionState: vi.fn(),
    resetGitRepoState: vi.fn(),
    setStreaming: vi.fn(),
    invalidateWorkspaceEntries: vi.fn(),
    sendCommand: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

function makeSnapshotData(overrides: Record<string, unknown> = {}) {
  return {
    transcript: makeTranscriptPage(),
    sessionId: "test-session",
    sessionPath: "/session/path",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<GetStateResponseDeps> = {}): GetStateResponseDeps {
  return {
    getDisplayedSessionPath: () => null,
    getWorkspaceEntriesContextKey: () => null,
    getActiveTreeSessionPath: () => null,
    getSessionState: () => null,
    ensureWorkspaceSummary: vi.fn(),
    updateCurrentModel: vi.fn(),
    normalizeThinkingLevel: (v) => (typeof v === "string" ? (v as never) : null),
    setSessionRunning: vi.fn(),
    setCompactionState: vi.fn(),
    resetGitRepoState: vi.fn(),
    invalidateWorkspaceEntries: vi.fn(),
    sendCommand: vi.fn().mockResolvedValue({ success: true }),
    setStreaming: vi.fn(),
    setLiveSessionPath: vi.fn(),
    setSessionState: vi.fn(),
    setActiveTreeSessionPath: vi.fn(),
    setThinkingLevel: vi.fn(),
    ...overrides,
  };
}

describe("applyGetStateResponse", () => {
  describe("workspace context key change", () => {
    it("sends get_commands when workspace changes", () => {
      let wpKey: string | null = "/project-a";
      const deps = makeDeps({
        getWorkspaceEntriesContextKey: () => wpKey,
        setSessionState: vi.fn((state: RpcSessionState) => {
          wpKey = state.workspacePath ?? null;
        }),
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applyGetStateResponse(makeSessionState({ workspacePath: "/project-b" }), deps);

      expect(deps.sendCommand).toHaveBeenCalledWith({ type: "get_commands" });
      expect(deps.invalidateWorkspaceEntries).toHaveBeenCalled();
    });

    it("does NOT send get_commands when workspace stays the same", () => {
      const deps = makeDeps({
        getWorkspaceEntriesContextKey: () => "/project-a",
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applyGetStateResponse(makeSessionState({ workspacePath: "/project-a" }), deps);

      expect(deps.sendCommand).not.toHaveBeenCalled();
      expect(deps.invalidateWorkspaceEntries).not.toHaveBeenCalled();
    });

    it("does NOT send get_commands when both workspace keys are null", () => {
      const deps = makeDeps({
        getWorkspaceEntriesContextKey: () => null,
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applyGetStateResponse(makeSessionState(), deps);

      expect(deps.sendCommand).not.toHaveBeenCalled();
      expect(deps.invalidateWorkspaceEntries).not.toHaveBeenCalled();
    });

    it("sends get_commands when switching from null to a workspace", () => {
      // getWorkspaceEntriesContextKey is called twice: before and after setSessionState.
      // The first call returns null, the second returns the new workspace path.
      let wpKey: string | null = null;
      const deps = makeDeps({
        getWorkspaceEntriesContextKey: () => wpKey,
        setSessionState: vi.fn((state: RpcSessionState) => {
          wpKey = state.workspacePath ?? null;
        }),
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applyGetStateResponse(makeSessionState({ workspacePath: "/new-project" }), deps);

      expect(deps.sendCommand).toHaveBeenCalledWith({ type: "get_commands" });
      expect(deps.invalidateWorkspaceEntries).toHaveBeenCalled();
    });

    it("sends get_commands when switching from a workspace to null", () => {
      let wpKey: string | null = "/project-a";
      const deps = makeDeps({
        getWorkspaceEntriesContextKey: () => wpKey,
        setSessionState: vi.fn(() => {
          wpKey = null;
        }),
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applyGetStateResponse(makeSessionState(), deps);

      expect(deps.sendCommand).toHaveBeenCalledWith({ type: "get_commands" });
      expect(deps.invalidateWorkspaceEntries).toHaveBeenCalled();
    });
  });

  describe("session state", () => {
    it("calls setSessionState with the data", () => {
      const deps = makeDeps();
      const data = makeSessionState({ sessionFile: "/session-1" });

      applyGetStateResponse(data, deps);

      expect(deps.setSessionState).toHaveBeenCalled();
      const passed = vi.mocked(deps.setSessionState).mock.calls[0]![0]!;
      expect(passed.sessionId).toBe("test-session");
    });

    it("calls updateCurrentModel with model from data", () => {
      const deps = makeDeps();
      const data = makeSessionState({ model: { id: "claude", provider: "anthropic" } });

      applyGetStateResponse(data, deps);

      expect(deps.updateCurrentModel).toHaveBeenCalledWith({ id: "claude", provider: "anthropic" });
    });

    it("sets streaming true when data.isStreaming is true", () => {
      const deps = makeDeps();
      applyGetStateResponse(makeSessionState({ isStreaming: true }), deps);
      expect(deps.setStreaming).toHaveBeenCalledWith(true);
    });

    it("sets streaming false when data.isStreaming is false", () => {
      const deps = makeDeps();
      applyGetStateResponse(makeSessionState({ isStreaming: false }), deps);
      expect(deps.setStreaming).toHaveBeenCalledWith(false);
    });
  });
});

describe("applySessionSnapshotResponse", () => {
  describe("workspace context key change", () => {
    it("sends get_commands when workspace changes", () => {
      let wpKey: string | null = "/project-a";
      const deps = makeSnapshotDeps({
        getWorkspaceEntriesContextKey: () => wpKey,
        setSessionState: vi.fn((state: RpcSessionState) => {
          wpKey = state.workspacePath ?? null;
        }),
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applySessionSnapshotResponse(
        makeSnapshotData({ workspacePath: "/project-b" }) as Parameters<typeof applySessionSnapshotResponse>[0],
        undefined,
        deps,
      );

      expect(deps.sendCommand).toHaveBeenCalledWith({ type: "get_commands" });
      expect(deps.invalidateWorkspaceEntries).toHaveBeenCalled();
    });

    it("does NOT send get_commands when workspace stays the same", () => {
      const deps = makeSnapshotDeps({
        getWorkspaceEntriesContextKey: () => "/project-a",
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applySessionSnapshotResponse(
        makeSnapshotData({ workspacePath: "/project-a" }) as Parameters<typeof applySessionSnapshotResponse>[0],
        undefined,
        deps,
      );

      expect(deps.sendCommand).not.toHaveBeenCalled();
      expect(deps.invalidateWorkspaceEntries).not.toHaveBeenCalled();
    });

    it("does NOT send get_commands when both keys are null", () => {
      const deps = makeSnapshotDeps({
        getWorkspaceEntriesContextKey: () => null,
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applySessionSnapshotResponse(
        makeSnapshotData() as Parameters<typeof applySessionSnapshotResponse>[0],
        undefined,
        deps,
      );

      expect(deps.sendCommand).not.toHaveBeenCalled();
      expect(deps.invalidateWorkspaceEntries).not.toHaveBeenCalled();
    });

    it("sends get_state when refreshState is true", () => {
      const deps = makeSnapshotDeps({
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applySessionSnapshotResponse(
        makeSnapshotData() as Parameters<typeof applySessionSnapshotResponse>[0],
        { refreshState: true },
        deps,
      );

      expect(deps.sendCommand).toHaveBeenCalledWith({ type: "get_state" });
    });

    it("does NOT send get_state when refreshState is not set", () => {
      const deps = makeSnapshotDeps({
        sendCommand: vi.fn().mockResolvedValue({ success: true }),
      });

      applySessionSnapshotResponse(
        makeSnapshotData() as Parameters<typeof applySessionSnapshotResponse>[0],
        undefined,
        deps,
      );

      expect(deps.sendCommand).not.toHaveBeenCalled();
    });

    it("returns false when data has no transcript", () => {
      const deps = makeSnapshotDeps();
      const result = applySessionSnapshotResponse(
        {} as Parameters<typeof applySessionSnapshotResponse>[0],
        undefined,
        deps,
      );
      expect(result).toBe(false);
    });

    it("returns true when data has transcript", () => {
      const deps = makeSnapshotDeps();
      const result = applySessionSnapshotResponse(
        makeSnapshotData() as Parameters<typeof applySessionSnapshotResponse>[0],
        undefined,
        deps,
      );
      expect(result).toBe(true);
    });
  });
});
