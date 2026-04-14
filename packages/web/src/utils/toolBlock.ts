import type { ToolBlockStatus, ToolContentBlock } from "./transcript";

export interface ToolCardSection {
  label: string;
  text: string;
}

export interface ToolCardModel {
  label: string;
  title: string;
  meta?: string;
  preview?: string;
  status: ToolBlockStatus;
  details: ToolCardSection[];
  diffStats?: { added: number; removed: number };
}

type ToolArgsRecord = Record<string, unknown>;

const TOOL_LABELS: Record<string, string> = {
  read: "Read file",
  bash: "Run command",
  edit: "Edit file",
  write: "Write file",
};

export function buildToolCardModel(block: ToolContentBlock): ToolCardModel {
  const args = asRecord(block.toolArgs);
  const title = formatToolTitle(block.toolName, args);
  const diffStats = buildDiffStats(
    block.toolName,
    args,
    block.resultDetails,
    block.toolStatus,
  );
  const meta = formatToolMeta(
    block.toolName,
    args,
    block.resultText,
    block.resultDetails,
    block.toolStatus,
  );
  const preview = formatToolPreview(
    block.toolName,
    args,
    block.resultText,
    block.resultDetails,
    block.toolStatus,
  );
  const details = buildToolDetails(block, args);

  return {
    label: TOOL_LABELS[block.toolName] ?? humanizeToolName(block.toolName),
    title,
    meta,
    preview,
    status: block.toolStatus,
    details,
    diffStats,
  };
}

function buildToolDetails(
  block: ToolContentBlock,
  args: ToolArgsRecord | undefined,
): ToolCardSection[] {
  const details: ToolCardSection[] = [];
  const resultText = block.resultText?.trim();
  const writeContent = stringValue(args, "content")?.trim();
  const resultDetails = asRecord(block.resultDetails);

  if (block.toolName === "edit") {
    const diffText = stringValue(resultDetails, "diff")?.trim();
    if (diffText) {
      return details;
    }
  }

  if (
    block.toolName === "write" &&
    writeContent &&
    block.toolStatus !== "error"
  ) {
    details.push({ label: "Content", text: writeContent });
    if (resultText) {
      details.push({ label: "Result", text: resultText });
    }
  } else if (resultText) {
    details.push({ label: resultLabel(block.toolName), text: resultText });
  }

  return details;
}

function formatToolTitle(
  toolName: string,
  args: ToolArgsRecord | undefined,
): string {
  switch (toolName) {
    case "read": {
      const path = stringValue(args, "path");
      if (!path) return "Read file";
      const offset = numberValue(args, "offset");
      const limit = numberValue(args, "limit");
      if (offset === undefined && limit === undefined) return path;
      const startLine = offset ?? 1;
      const endLine = limit !== undefined ? startLine + limit - 1 : undefined;
      return endLine !== undefined
        ? `${path}:${startLine}-${endLine}`
        : `${path}:${startLine}`;
    }
    case "bash": {
      const command = stringValue(args, "command");
      return command ? compactInline(command, 96) : "Run command";
    }
    case "edit": {
      const path = stringValue(args, "path");
      return path || "Edit file";
    }
    case "write": {
      const path = stringValue(args, "path");
      return path || "Write file";
    }
    default:
      return humanizeToolName(toolName);
  }
}

function formatToolMeta(
  toolName: string,
  args: ToolArgsRecord | undefined,
  resultText: string | undefined,
  resultDetails: unknown,
  status: ToolBlockStatus,
): string | undefined {
  switch (toolName) {
    case "bash": {
      const parts: string[] = [];
      const exitCode = bashExitCode(resultText, status);
      if (exitCode !== undefined) parts.push(`exit ${exitCode}`);
      const timeout = numberValue(args, "timeout");
      if (timeout !== undefined) parts.push(`timeout ${timeout}s`);
      return parts.join(" · ") || undefined;
    }
    case "edit":
      return undefined;
    case "write": {
      const content = stringValue(args, "content");
      if (!content) return undefined;
      const lines = content.replace(/\r/g, "").split("\n").length;
      return `${lines} line${lines === 1 ? "" : "s"}`;
    }
    default:
      return undefined;
  }
}

function formatToolPreview(
  toolName: string,
  args: ToolArgsRecord | undefined,
  resultText: string | undefined,
  resultDetails: unknown,
  status: ToolBlockStatus,
): string | undefined {
  if (status === "pending") {
    return pendingText(toolName);
  }

  if (toolName === "bash") {
    return tailPreviewText(resultText);
  }

  if (toolName === "edit") {
    const diffText = blockResultDiff(resultDetails)?.trim();
    if (diffText) {
      return diffText;
    }
  }

  if (status === "error") {
    return previewText(resultText);
  }

  if (toolName === "write") {
    const content = stringValue(args, "content");
    if (content?.trim()) {
      return previewText(content);
    }
  }

  if (toolName === "edit") {
    const edits = Array.isArray(args?.edits) ? args.edits.length : undefined;
    const stats = editDiffStats(args, blockResultDiff(resultDetails));
    if (stats) {
      const blockCount = edits ?? 1;
      return `+${stats.added} -${stats.removed} across ${blockCount} block${blockCount === 1 ? "" : "s"}`;
    }
    if (resultText?.trim()) {
      return previewText(resultText);
    }
    if (edits !== undefined) {
      return `${edits} edit${edits === 1 ? "" : "s"}`;
    }
  }

  return previewText(resultText);
}

function resultLabel(toolName: string): string {
  switch (toolName) {
    case "bash":
      return "Output";
    case "edit":
      return "Result";
    case "read":
      return "Contents";
    default:
      return "Result";
  }
}

function pendingText(toolName: string): string {
  switch (toolName) {
    case "read":
      return "Waiting for file contents...";
    case "bash":
      return "Running command...";
    case "edit":
      return "Applying edit...";
    case "write":
      return "Writing file...";
    default:
      return "Running tool...";
  }
}

function previewText(
  text: string | undefined,
  maxLines: number = 8,
): string | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return undefined;
  const lines = normalized.split("\n");
  if (lines.length <= maxLines) return normalized;
  const remaining = lines.length - maxLines;
  return `${lines.slice(0, maxLines).join("\n")}\n... ${remaining} more line${remaining === 1 ? "" : "s"}`;
}

function tailPreviewText(
  text: string | undefined,
  maxLines: number = 6,
): string | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return undefined;
  const lines = normalized.split("\n");
  if (lines.length <= maxLines) return normalized;
  const remaining = lines.length - maxLines;
  return `... ${remaining} earlier line${remaining === 1 ? "" : "s"}\n${lines.slice(-maxLines).join("\n")}`;
}

function compactInline(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function humanizeToolName(toolName: string): string {
  if (!toolName) return "Tool";
  return toolName
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function asRecord(value: unknown): ToolArgsRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as ToolArgsRecord;
}

function stringValue(
  args: ToolArgsRecord | undefined,
  key: string,
): string | undefined {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberValue(
  args: ToolArgsRecord | undefined,
  key: string,
): number | undefined {
  const value = args?.[key];
  return typeof value === "number" ? value : undefined;
}

function bashExitCode(
  resultText: string | undefined,
  status: ToolBlockStatus,
): number | undefined {
  if (!resultText) return status === "success" ? 0 : undefined;
  const match = resultText.match(/Command exited with code (\d+)/i);
  if (match) return Number(match[1]);
  return status === "success" ? 0 : undefined;
}

function editDiffStats(
  args: ToolArgsRecord | undefined,
  diffText: string | undefined,
): { added: number; removed: number } | undefined {
  const fromDiff = diffStatsFromDiff(diffText);
  if (fromDiff) return fromDiff;
  if (!Array.isArray(args?.edits)) return undefined;
  let added = 0;
  let removed = 0;
  let sawEdit = false;

  for (const edit of args.edits) {
    if (!edit || typeof edit !== "object") continue;
    const record = edit as Record<string, unknown>;
    const oldText = typeof record.oldText === "string" ? record.oldText : "";
    const newText = typeof record.newText === "string" ? record.newText : "";
    removed += countLines(oldText);
    added += countLines(newText);
    sawEdit = true;
  }

  return sawEdit ? { added, removed } : undefined;
}

function countLines(text: string): number {
  if (!text) return 0;
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

function blockResultDiff(resultDetails: unknown): string | undefined {
  const details = asRecord(resultDetails);
  return stringValue(details, "diff");
}

function diffStatsFromDiff(
  diffText: string | undefined,
): { added: number; removed: number } | undefined {
  if (!diffText) return undefined;
  let added = 0;
  let removed = 0;

  for (const line of diffText.replace(/\r/g, "").split("\n")) {
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("@@")
    )
      continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }

  if (added === 0 && removed === 0) return undefined;
  return { added, removed };
}

function buildDiffStats(
  toolName: string,
  args: ToolArgsRecord | undefined,
  resultDetails: unknown,
  status: ToolBlockStatus,
): { added: number; removed: number } | undefined {
  if (toolName !== "edit" || status !== "success") return undefined;
  return editDiffStats(args, blockResultDiff(resultDetails));
}
