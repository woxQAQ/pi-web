import { describe, expect, it } from "vitest";
import {
  DEFAULT_THINKING_LEVEL,
  getNextThinkingLevel,
  getPreviousThinkingLevel,
} from "../utils/thinkingLevels";

describe("thinkingLevels", () => {
  it("cycles through the configured thinking levels", () => {
    expect(getNextThinkingLevel("off")).toBe("minimal");
    expect(getNextThinkingLevel("minimal")).toBe("low");
    expect(getNextThinkingLevel("low")).toBe("medium");
    expect(getNextThinkingLevel("medium")).toBe("high");
    expect(getNextThinkingLevel("high")).toBe("xhigh");
    expect(getNextThinkingLevel("xhigh")).toBe("off");
  });

  it("cycles backwards through the configured thinking levels", () => {
    expect(getPreviousThinkingLevel("off")).toBe("xhigh");
    expect(getPreviousThinkingLevel("minimal")).toBe("off");
    expect(getPreviousThinkingLevel("low")).toBe("minimal");
    expect(getPreviousThinkingLevel("medium")).toBe("low");
    expect(getPreviousThinkingLevel("high")).toBe("medium");
    expect(getPreviousThinkingLevel("xhigh")).toBe("high");
  });

  it("falls back to the default level when the current level is missing", () => {
    expect(DEFAULT_THINKING_LEVEL).toBe("off");
    expect(getNextThinkingLevel(null)).toBe("minimal");
    expect(getNextThinkingLevel(undefined)).toBe("minimal");
    expect(getPreviousThinkingLevel(null)).toBe("xhigh");
    expect(getPreviousThinkingLevel(undefined)).toBe("xhigh");
  });
});
