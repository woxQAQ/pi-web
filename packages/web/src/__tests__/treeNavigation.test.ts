import { describe, expect, it } from "vitest";
import type {
  TranscriptEntry,
  TreeEntry,
} from "../composables/useBridgeClient";
import {
  buildMessageBranchNavigators,
  resolveTreeNavigationTarget,
  treeEntryMessageRole,
  treeEntryPreviewText,
} from "../utils/treeNavigation";

function messageEntry(
  id: string,
  label: string,
  parentId: string | null,
  options: Partial<TreeEntry> = {},
): TreeEntry {
  return {
    id,
    label,
    type: "message",
    parentId,
    ...options,
  };
}

function userMessage(id: string): TranscriptEntry {
  return {
    id,
    transcriptKey: id,
    role: "user",
    content: "message",
  };
}

describe("treeNavigation", () => {
  it("detects message roles even when labels have prefixes", () => {
    expect(
      treeEntryMessageRole({
        type: "message",
        label: "[bookmark] user: revised prompt",
      }),
    ).toBe("user");
    expect(
      treeEntryMessageRole({
        type: "message",
        label: "[saved] assistant: revised answer",
      }),
    ).toBe("assistant");
    expect(
      treeEntryMessageRole({ type: "message", label: "[tool: read]" }),
    ).toBeNull();
  });

  it("extracts clean preview text for sidebar jump items", () => {
    expect(
      treeEntryPreviewText({
        id: "entry-1",
        type: "message",
        label: "[bookmark] user: revised prompt",
      }),
    ).toBe("revised prompt");
    expect(
      treeEntryPreviewText({
        id: "entry-2",
        type: "message",
        label: "assistant: improved answer",
      }),
    ).toBe("improved answer");
  });

  it("resolves a user tree entry to the preferred descendant leaf", () => {
    const entries: TreeEntry[] = [
      messageEntry("root-user", "user: original", null, { isOnActivePath: true }),
      messageEntry("assistant-a", "assistant: answer a", "root-user", {
        isOnActivePath: false,
      }),
      messageEntry("assistant-b", "assistant: answer b", "root-user", {
        isOnActivePath: true,
      }),
      messageEntry("follow-up-a", "user: next a", "assistant-a"),
      messageEntry("assistant-a2", "assistant: deep a", "follow-up-a"),
      messageEntry("follow-up-b", "user: next b", "assistant-b", {
        isOnActivePath: true,
      }),
      messageEntry("assistant-b2", "assistant: deep b", "follow-up-b", {
        isOnActivePath: true,
      }),
    ];

    expect(resolveTreeNavigationTarget(entries, "root-user")).toBe(
      "assistant-b2",
    );
    expect(resolveTreeNavigationTarget(entries, "assistant-a")).toBe(
      "assistant-a",
    );
  });

  it("orders edited user-message variants by creation time instead of active-path order", () => {
    const entries: TreeEntry[] = [
      messageEntry("user-v2", "user: who exactly are you", null, {
        isOnActivePath: true,
        timestamp: "2026-04-17T10:00:02.000Z",
      }),
      messageEntry("assistant-v2", "assistant: v2", "user-v2", {
        isOnActivePath: true,
        timestamp: "2026-04-17T10:00:03.000Z",
      }),
      messageEntry("user-v1", "user: who are you", null, {
        timestamp: "2026-04-17T10:00:00.000Z",
      }),
      messageEntry("assistant-v1", "assistant: v1", "user-v1", {
        timestamp: "2026-04-17T10:00:01.000Z",
      }),
    ];
    const messages: TranscriptEntry[] = [userMessage("user-v2")];

    expect(buildMessageBranchNavigators(entries, messages)).toEqual({
      "user-v2": {
        total: 2,
        currentIndex: 1,
        previous: {
          entryId: "user-v1",
          navigateEntryId: "assistant-v1",
        },
      },
    });
  });

  it("skips messages that do not belong to a variant group", () => {
    const entries: TreeEntry[] = [
      messageEntry("user-1", "user: hello", null, { isOnActivePath: true }),
      messageEntry("assistant-1", "assistant: hi", "user-1", {
        isOnActivePath: true,
      }),
    ];

    expect(buildMessageBranchNavigators(entries, [userMessage("user-1")])).toEqual(
      {},
    );
  });
});
