import { describe, expect, it } from "vitest";
import type { RpcTreeEntry } from "../shared-types";
import {
  filterTreeEntries,
  getTreeEntryDisplayParts,
} from "../utils/treeOutline";

const baseEntries: RpcTreeEntry[] = [
  {
    id: "root",
    label: "user: Start",
    type: "message",
    parentId: null,
    depth: 0,
    trackColumns: [],
    isActive: false,
    isOnActivePath: true,
    role: "user",
    previewText: "Start",
    searchText: "user start",
    isSettingsEntry: false,
    isLabeled: false,
    isToolOnlyAssistant: false,
  },
  {
    id: "model",
    label: "[model: gpt-4.1]",
    type: "model_change",
    parentId: "root",
    depth: 0,
    trackColumns: [],
    isActive: false,
    isOnActivePath: true,
    role: "meta",
    previewText: "[model: gpt-4.1]",
    searchText: "model gpt-4.1",
    isSettingsEntry: true,
    isLabeled: false,
    isToolOnlyAssistant: false,
  },
  {
    id: "assistant-tool-only",
    label: "assistant: (no content)",
    type: "message",
    parentId: "model",
    depth: 0,
    trackColumns: [],
    isActive: false,
    isOnActivePath: true,
    role: "assistant",
    previewText: "(no content)",
    searchText: "assistant no content",
    isSettingsEntry: false,
    isLabeled: false,
    isToolOnlyAssistant: true,
  },
  {
    id: "leaf",
    label: "user: Final",
    type: "message",
    parentId: "assistant-tool-only",
    depth: 0,
    trackColumns: [],
    isActive: true,
    isOnActivePath: true,
    role: "user",
    previewText: "Final",
    searchText: "user final",
    isSettingsEntry: false,
    isLabeled: false,
    isToolOnlyAssistant: false,
  },
  {
    id: "tool",
    label: "[tool: read]",
    type: "message",
    parentId: "root",
    depth: 1,
    trackColumns: ["branch"],
    isActive: false,
    isOnActivePath: false,
    role: "tool",
    previewText: "[tool: read]",
    searchText: "tool read",
    isSettingsEntry: false,
    isLabeled: false,
    isToolOnlyAssistant: false,
  },
  {
    id: "alt",
    label: "[checkpoint] user: Draft",
    type: "message",
    parentId: "root",
    depth: 1,
    trackColumns: ["branch-last"],
    isActive: false,
    isOnActivePath: false,
    role: "user",
    labelTag: "checkpoint",
    previewText: "Draft",
    searchText: "checkpoint user draft",
    isSettingsEntry: false,
    isLabeled: true,
    isToolOnlyAssistant: false,
  },
];

describe("treeOutline utils", () => {
  it("hides settings entries and tool-only assistant nodes in default mode", () => {
    const filtered = filterTreeEntries(baseEntries, "default", "");

    expect(filtered.map(entry => entry.id)).toEqual([
      "root",
      "leaf",
      "tool",
      "alt",
    ]);
    expect(filtered.map(entry => entry.depth)).toEqual([0, 1, 1, 1]);
    expect(filtered[1]).toMatchObject({
      id: "leaf",
      parentId: "root",
      trackColumns: ["branch"],
    });
    expect(filtered[3]).toMatchObject({
      id: "alt",
      parentId: "root",
      trackColumns: ["branch-last"],
    });
  });

  it("removes tool nodes in no-tools mode", () => {
    const filtered = filterTreeEntries(baseEntries, "no-tools", "");

    expect(filtered.map(entry => entry.id)).toEqual(["root", "leaf", "alt"]);
  });

  it("keeps the active leaf visible in labeled-only mode", () => {
    const filtered = filterTreeEntries(baseEntries, "labeled-only", "");

    expect(filtered.map(entry => entry.id)).toEqual(["leaf", "alt"]);
    expect(filtered.map(entry => entry.depth)).toEqual([0, 0]);
  });

  it("keeps the active leaf visible even when search only matches another node", () => {
    const filtered = filterTreeEntries(baseEntries, "default", "draft");

    expect(filtered.map(entry => entry.id)).toEqual(["leaf", "alt"]);
  });

  it("builds display parts with role labels and label chips", () => {
    expect(getTreeEntryDisplayParts(baseEntries[1])).toEqual({
      role: "meta",
      roleLabel: "model",
      labelTag: null,
      previewText: "[model: gpt-4.1]",
      title: "[model: gpt-4.1]",
    });

    expect(getTreeEntryDisplayParts(baseEntries[5])).toEqual({
      role: "user",
      roleLabel: "user",
      labelTag: "checkpoint",
      previewText: "Draft",
      title: "[checkpoint] Draft",
    });
  });
});
