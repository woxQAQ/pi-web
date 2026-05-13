import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStandaloneMainOptions } from "../standalone-main.js";

describe("standalone main", () => {
  it("parses the optional port override", () => {
    const options = parseStandaloneMainOptions(["--port", "8123"]);

    expect(options.cwd).toBe(process.cwd());
    expect(options.port).toBe(8123);
    expect(options.staticDir).toBe(join(process.cwd(), "web-dist"));
    expect(options.help).toBe(false);
  });

  it("accepts help flag", () => {
    const options = parseStandaloneMainOptions(["--help"]);
    expect(options.help).toBe(true);
  });

  it("throws on missing option value", () => {
    expect(() => parseStandaloneMainOptions(["--port"])).toThrow(
      "Missing value for --port",
    );
  });

  it("throws on unknown options", () => {
    expect(() => parseStandaloneMainOptions(["--cwd", "/tmp/project"])).toThrow(
      "Unknown option: --cwd",
    );
  });
});
