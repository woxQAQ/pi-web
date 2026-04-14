import { describe, expect, it } from "vitest";
import { readInitialDebugMode } from "../utils/debugMode";

describe("debugMode utils", () => {
  it("uses cached state before query params when debug mode is available", () => {
    expect(readInitialDebugMode(true, "true", "")).toBe(true);
    expect(readInitialDebugMode(true, "false", "?debug=1")).toBe(false);
    expect(readInitialDebugMode(true, null, "?debug=1")).toBe(true);
  });

  it("stays disabled when debug mode is not available", () => {
    expect(readInitialDebugMode(false, "true", "?debug=1")).toBe(false);
  });
});
