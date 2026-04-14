export interface TranscriptEntryLike {
  id?: string;
  role: string;
  content?: unknown;
  text?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export type ToolBlockStatus = "pending" | "success" | "error";

export interface TextContentBlock {
  kind: "text";
  text: string;
}

export interface ToolContentBlock {
  kind: "tool";
  toolName: string;
  toolArgs: unknown;
  argumentsText: string;
  resultText?: string;
  resultDetails?: unknown;
  toolStatus: ToolBlockStatus;
}

export interface ThinkingContentBlock {
  kind: "thinking";
  text: string;
}

export interface ImageContentBlock {
  kind: "image";
  text: string;
}

export type ContentBlock =
  | TextContentBlock
  | ToolContentBlock
  | ThinkingContentBlock
  | ImageContentBlock;

interface UnknownBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
  details?: unknown;
  isError?: boolean;
}

export function isErrorMessage(msg: TranscriptEntryLike): boolean {
  if (msg.role !== "assistant") return false;
  const stopReason = (msg as Record<string, unknown>).stopReason as
    | string
    | undefined;
  return stopReason === "error" || stopReason === "aborted";
}

export function errorMessageText(msg: TranscriptEntryLike): string {
  return ((msg as Record<string, unknown>).errorMessage as string) ?? "";
}

export function isAbortedMessage(msg: TranscriptEntryLike): boolean {
  return (
    (msg as Record<string, unknown>).stopReason === "aborted"
  );
}

export function isToolResultMessage(msg: TranscriptEntryLike): boolean {
  return msg.role === "toolResult" || msg.role === "tool";
}

export function messageContent(
  msg: Pick<TranscriptEntryLike, "content" | "text">,
): string {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (typeof msg.text === "string") return msg.text;
  if (Array.isArray(content)) {
    return content
      .map((block: unknown) => {
        if (typeof block === "string") return block;
        const typedBlock = block as UnknownBlock;
        if (typedBlock.type === "text" && typeof typedBlock.text === "string")
          return typedBlock.text;
        if (
          typedBlock.type === "toolResult" &&
          typeof typedBlock.text === "string"
        )
          return typedBlock.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function contentBlocks(msg: TranscriptEntryLike): ContentBlock[] {
  const content = msg.content;
  const blocks: ContentBlock[] = [];

  if (typeof content === "string") {
    blocks.push({ kind: "text", text: content });
    return blocks;
  }

  if (typeof msg.text === "string") {
    blocks.push({ kind: "text", text: msg.text });
    return blocks;
  }

  if (!Array.isArray(content)) return blocks;

  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (typeof block === "string") {
      blocks.push({ kind: "text", text: block });
      continue;
    }

    const typedBlock = block as UnknownBlock;
    const type = typedBlock.type;

    if (type === "text" && typeof typedBlock.text === "string") {
      blocks.push({ kind: "text", text: typedBlock.text });
      continue;
    }

    if (type === "thinking" && typeof typedBlock.thinking === "string") {
      const thinkingText = typedBlock.thinking.trim();
      if (thinkingText) {
        blocks.push({ kind: "thinking", text: thinkingText });
      }
      continue;
    }

    if (type === "toolCall") {
      const nextBlock = content[index + 1];
      const typedNextBlock =
        typeof nextBlock === "object" && nextBlock !== null
          ? (nextBlock as UnknownBlock)
          : undefined;
      const resultText =
        typedNextBlock?.type === "toolResult"
          ? toolResultText(typedNextBlock)
          : undefined;
      const resultDetails =
        typedNextBlock?.type === "toolResult"
          ? typedNextBlock.details
          : undefined;
      const resultIsError =
        typedNextBlock?.type === "toolResult"
          ? toolResultIsError(typedNextBlock)
          : undefined;

      blocks.push({
        kind: "tool",
        toolName:
          typeof typedBlock.name === "string" ? typedBlock.name : "unknown",
        toolArgs: parseToolArguments(typedBlock.arguments),
        argumentsText: toolArgumentsText(typedBlock.arguments),
        resultText,
        resultDetails,
        toolStatus: toolStatusFromResult(resultText, resultIsError),
      });

      if (typedNextBlock?.type === "toolResult") {
        index++;
      }
      continue;
    }

    if (type === "toolResult") {
      blocks.push({ kind: "text", text: toolResultText(typedBlock) });
      continue;
    }

    if (type === "image" || type === "image_url") {
      blocks.push({ kind: "image", text: "[image]" });
    }
  }

  return blocks;
}

export function normalizeTranscript(
  messages: readonly TranscriptEntryLike[],
): TranscriptEntryLike[] {
  const normalized: TranscriptEntryLike[] = [];

  for (const message of messages) {
    if (isToolResultMessage(message)) {
      const merged = appendToolResultToPreviousAssistant(normalized, message);
      if (!merged) {
        normalized.push(cloneMessage(message));
      }
      continue;
    }

    normalized.push(cloneMessage(message));
  }

  return normalized;
}

function appendToolResultToPreviousAssistant(
  normalized: TranscriptEntryLike[],
  toolResultMessage: TranscriptEntryLike,
): boolean {
  for (let index = normalized.length - 1; index >= 0; index--) {
    const candidate = normalized[index];
    if (candidate.role !== "assistant") continue;

    const mergedContent = mergeToolResultIntoContent(
      candidate.content,
      toolResultMessage,
    );
    if (!mergedContent) continue;

    normalized[index] = {
      ...candidate,
      content: mergedContent,
    };
    return true;
  }

  return false;
}

function mergeToolResultIntoContent(
  content: unknown,
  toolResultMessage: TranscriptEntryLike,
): unknown[] | null {
  if (!Array.isArray(content)) return null;

  const cloned = content.map(cloneBlock);
  const targetIndex = findNextUnmatchedToolCallIndex(cloned);
  if (targetIndex === -1) return null;

  cloned.splice(targetIndex + 1, 0, {
    type: "toolResult",
    text: messageContent(toolResultMessage),
    details: toolResultMessage.details,
    isError:
      typeof toolResultMessage.isError === "boolean"
        ? toolResultMessage.isError
        : undefined,
  });
  return cloned;
}

function findNextUnmatchedToolCallIndex(content: unknown[]): number {
  const unmatchedToolCallIndexes: number[] = [];

  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (typeof block !== "object" || block === null) continue;
    const typedBlock = block as UnknownBlock;
    if (typedBlock.type === "toolCall") {
      unmatchedToolCallIndexes.push(index);
      continue;
    }
    if (
      typedBlock.type === "toolResult" &&
      unmatchedToolCallIndexes.length > 0
    ) {
      unmatchedToolCallIndexes.shift();
    }
  }

  return unmatchedToolCallIndexes[0] ?? -1;
}

function cloneMessage(message: TranscriptEntryLike): TranscriptEntryLike {
  return {
    ...message,
    content: cloneContent(message.content),
  };
}

function cloneContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map(cloneBlock);
}

function cloneBlock(block: unknown): unknown {
  if (typeof block !== "object" || block === null) return block;
  return { ...(block as Record<string, unknown>) };
}

function toolResultText(block: UnknownBlock): string {
  if (typeof block.text === "string") return block.text;
  return JSON.stringify(block, null, 2);
}

function toolResultIsError(block: UnknownBlock): boolean | undefined {
  return typeof block.isError === "boolean" ? block.isError : undefined;
}

function parseToolArguments(args: unknown): unknown {
  if (typeof args !== "string") return args;
  const trimmed = args.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return args;
  }
}

function toolArgumentsText(args: unknown): string {
  if (typeof args === "string") return args;
  return JSON.stringify(args ?? "", null, 2);
}

function toolStatusFromResult(
  resultText: string | undefined,
  isError: boolean | undefined,
): ToolBlockStatus {
  if (!resultText) return "pending";
  return isError ? "error" : "success";
}
