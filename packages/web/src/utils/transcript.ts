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

export type ToolResultBlock = TextContentBlock | ImageContentBlock;

export interface ToolContentBlock {
  kind: "tool";
  toolName: string;
  toolArgs: unknown;
  argumentsText: string;
  resultText?: string;
  resultBlocks?: ToolResultBlock[];
  resultDetails?: unknown;
  toolStatus: ToolBlockStatus;
}

export interface ThinkingContentBlock {
  kind: "thinking";
  text: string;
}

export interface ImageContentBlock {
  kind: "image";
  src: string;
  alt: string;
  mimeType?: string;
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
  content?: unknown;
  data?: string;
  mimeType?: string;
  url?: string;
  image_url?: string | { url?: string };
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
  return (msg as Record<string, unknown>).stopReason === "aborted";
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
        if (typedBlock.type === "toolResult") {
          return toolResultText(typedBlock);
        }
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
      const resultBlocks =
        typedNextBlock?.type === "toolResult"
          ? toolResultBlocks(typedNextBlock)
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
        resultBlocks,
        resultDetails,
        toolStatus: toolStatusFromResult(
          resultText,
          resultBlocks,
          resultIsError,
        ),
      });

      if (typedNextBlock?.type === "toolResult") {
        index++;
      }
      continue;
    }

    if (type === "toolResult") {
      blocks.push(...toolResultBlocks(typedBlock));
      continue;
    }

    if (type === "image" || type === "image_url") {
      const src = imageBlockSource(typedBlock);
      if (src) {
        blocks.push({
          kind: "image",
          src,
          alt: typedBlock.text || "Image attachment",
          mimeType:
            typeof typedBlock.mimeType === "string"
              ? typedBlock.mimeType
              : undefined,
        });
      } else {
        blocks.push({ kind: "text", text: "[image]" });
      }
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
    content: cloneContent(toolResultMessage.content),
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
  if (Array.isArray(block.content)) {
    return block.content
      .map(item => {
        if (typeof item === "string") return item;
        if (typeof item !== "object" || item === null) return "";
        const typedItem = item as UnknownBlock;
        if (typedItem.type === "text" && typeof typedItem.text === "string") {
          return typedItem.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof block.text === "string") return block.text;
  return JSON.stringify(block, null, 2);
}

function toolResultBlocks(block: UnknownBlock): ToolResultBlock[] {
  if (Array.isArray(block.content)) {
    const blocks: ToolResultBlock[] = [];
    for (const item of block.content) {
      if (typeof item === "string") {
        blocks.push({ kind: "text", text: item });
        continue;
      }
      if (typeof item !== "object" || item === null) continue;
      const typedItem = item as UnknownBlock;
      if (typedItem.type === "text" && typeof typedItem.text === "string") {
        blocks.push({ kind: "text", text: typedItem.text });
        continue;
      }
      if (typedItem.type === "image" || typedItem.type === "image_url") {
        const src = imageBlockSource(typedItem);
        if (src) {
          blocks.push({
            kind: "image",
            src,
            alt: typedItem.text || "Image attachment",
            mimeType:
              typeof typedItem.mimeType === "string"
                ? typedItem.mimeType
                : undefined,
          });
        }
      }
    }

    if (blocks.length > 0) return blocks;
  }

  const text = toolResultText(block);
  return text ? [{ kind: "text", text }] : [];
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
  resultBlocks: ToolResultBlock[] | undefined,
  isError: boolean | undefined,
): ToolBlockStatus {
  const hasText =
    typeof resultText === "string" && resultText.trim().length > 0;
  const hasBlocks = Array.isArray(resultBlocks) && resultBlocks.length > 0;
  if (!hasText && !hasBlocks) return "pending";
  return isError ? "error" : "success";
}

function imageBlockSource(block: UnknownBlock): string | null {
  if (typeof block.data === "string" && typeof block.mimeType === "string") {
    return `data:${block.mimeType};base64,${block.data}`;
  }

  if (typeof block.url === "string") {
    return block.url;
  }

  if (typeof block.image_url === "string") {
    return block.image_url;
  }

  if (
    typeof block.image_url === "object" &&
    block.image_url !== null &&
    typeof block.image_url.url === "string"
  ) {
    return block.image_url.url;
  }

  return null;
}
