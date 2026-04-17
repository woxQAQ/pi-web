import type { TranscriptEntry, TreeEntry } from "../composables/useBridgeClient";

export interface MessageBranchVariantTarget {
  entryId: string;
  navigateEntryId: string;
}

export interface MessageBranchNavigator {
  total: number;
  currentIndex: number;
  previous?: MessageBranchVariantTarget;
  next?: MessageBranchVariantTarget;
}

const TREE_LABEL_PREFIX_RE = /^(?:\[[^\]]+\]\s*)+/;
const ROOT_PARENT_KEY = "__pi_web_root__";

function normalizeTreeLabel(label?: string): string {
  if (!label) return "";
  return label.replace(TREE_LABEL_PREFIX_RE, "").trim();
}

export function treeEntryMessageRole(
  entry: Pick<TreeEntry, "label" | "type">,
): "user" | "assistant" | null {
  const label = normalizeTreeLabel(entry.label).toLowerCase();
  if (label.startsWith("user:")) return "user";
  if (label.startsWith("assistant:")) return "assistant";
  return null;
}

export function treeEntryPreviewText(
  entry: Pick<TreeEntry, "label" | "type" | "id">,
): string {
  const label = normalizeTreeLabel(entry.label);
  if (!label) return entry.id;
  return label.replace(/^(?:user|assistant):\s*/i, "").trim() || label;
}

function parentKey(parentId: string | null | undefined): string {
  return parentId ?? ROOT_PARENT_KEY;
}

function parseTreeEntryTimestamp(timestamp?: string): number | null {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : null;
}

function buildEntryIndex(entries: readonly TreeEntry[]) {
  const byId = new Map<string, TreeEntry>();
  const childrenByParentId = new Map<string, TreeEntry[]>();
  const sourceOrder = new Map<string, number>();

  for (const [index, entry] of entries.entries()) {
    byId.set(entry.id, entry);
    sourceOrder.set(entry.id, index);
    const key = parentKey(entry.parentId);
    const siblings = childrenByParentId.get(key);
    if (siblings) {
      siblings.push(entry);
    } else {
      childrenByParentId.set(key, [entry]);
    }
  }

  return { byId, childrenByParentId, sourceOrder };
}

function sortBranchSiblings(
  siblings: readonly TreeEntry[],
  sourceOrder: ReadonlyMap<string, number>,
): TreeEntry[] {
  return [...siblings].sort((left, right) => {
    const leftTimestamp = parseTreeEntryTimestamp(left.timestamp);
    const rightTimestamp = parseTreeEntryTimestamp(right.timestamp);

    if (
      leftTimestamp !== null &&
      rightTimestamp !== null &&
      leftTimestamp !== rightTimestamp
    ) {
      return leftTimestamp - rightTimestamp;
    }

    return (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0);
  });
}

function preferredChild(children: readonly TreeEntry[]): TreeEntry | null {
  if (children.length === 0) return null;
  return children.find(child => child.isOnActivePath) ?? children[0] ?? null;
}

export function resolveTreeNavigationTarget(
  entries: readonly TreeEntry[],
  entryId: string,
): string {
  const { byId, childrenByParentId } = buildEntryIndex(entries);
  const entry = byId.get(entryId);
  if (!entry) return entryId;

  if (treeEntryMessageRole(entry) !== "user") {
    return entryId;
  }

  let current = entry;
  while (true) {
    const next = preferredChild(
      childrenByParentId.get(parentKey(current.id)) ?? [],
    );
    if (!next) return current.id;
    current = next;
  }
}

export function buildMessageBranchNavigators(
  entries: readonly TreeEntry[],
  messages: readonly TranscriptEntry[],
): Record<string, MessageBranchNavigator> {
  const { byId, childrenByParentId, sourceOrder } = buildEntryIndex(entries);
  const navigators: Record<string, MessageBranchNavigator> = {};

  for (const msg of messages) {
    if (msg.role !== "user" || typeof msg.id !== "string") continue;

    const currentEntry = byId.get(msg.id);
    if (!currentEntry || treeEntryMessageRole(currentEntry) !== "user") {
      continue;
    }

    const siblings = sortBranchSiblings(
      (childrenByParentId.get(parentKey(currentEntry.parentId)) ?? []).filter(
        entry => treeEntryMessageRole(entry) === "user",
      ),
      sourceOrder,
    );

    if (siblings.length <= 1) continue;

    const currentIndex = siblings.findIndex(entry => entry.id === msg.id);
    if (currentIndex < 0) continue;

    navigators[msg.id] = {
      total: siblings.length,
      currentIndex,
      previous:
        currentIndex > 0
          ? {
              entryId: siblings[currentIndex - 1].id,
              navigateEntryId: resolveTreeNavigationTarget(
                entries,
                siblings[currentIndex - 1].id,
              ),
            }
          : undefined,
      next:
        currentIndex < siblings.length - 1
          ? {
              entryId: siblings[currentIndex + 1].id,
              navigateEntryId: resolveTreeNavigationTarget(
                entries,
                siblings[currentIndex + 1].id,
              ),
            }
          : undefined,
    };
  }

  return navigators;
}
