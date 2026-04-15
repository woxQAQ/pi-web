import { describe, expect, it } from "vitest";
import { userMessageCopyText } from "../utils/messageCopy";

describe("userMessageCopyText", () => {
  it("returns the original user message when full bubble selection has extra newlines", () => {
    expect(
      userMessageCopyText(
        { role: "user", content: "Run tests" },
        "Run tests\n\n",
        "Run tests",
      ),
    ).toBe("Run tests");
  });

  it("returns markdown source when the rendered full selection differs", () => {
    expect(
      userMessageCopyText(
        { role: "user", content: "**Run tests**" },
        "Run tests",
        "Run tests",
      ),
    ).toBe("**Run tests**");
  });

  it("does not override partial selections", () => {
    expect(
      userMessageCopyText(
        { role: "user", content: "Run all tests" },
        "Run all",
        "Run all tests",
      ),
    ).toBeNull();
  });

  it("does not override assistant selections", () => {
    expect(
      userMessageCopyText(
        { role: "assistant", content: "Run tests" },
        "Run tests\n\n",
        "Run tests",
      ),
    ).toBeNull();
  });
});
