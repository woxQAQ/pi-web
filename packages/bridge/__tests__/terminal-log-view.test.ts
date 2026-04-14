import { describe, expect, it, vi } from "vitest";
import { createBridgeTerminalView } from "../terminal-log-view.js";
import { DEFAULT_BRIDGE_CONFIG, type BridgeEvent } from "../types.js";

describe("createBridgeTerminalView", () => {
  it("requests exit when Ctrl+C input is received", () => {
    const view = createBridgeTerminalView(
      () => () => {},
      () => ({ status: "running", host: "127.0.0.1", port: 3000 }),
      () => [],
      DEFAULT_BRIDGE_CONFIG,
    );

    expect(view.shouldExit()).toBe(false);
    view.handleInput("\u0003");
    expect(view.shouldExit()).toBe(true);
  });

  it("calls onUpdate when bridge events arrive", () => {
    let handler: ((event: BridgeEvent) => void) | undefined;
    const onUpdate = vi.fn();
    const unsubscribe = vi.fn();

    const view = createBridgeTerminalView(
      eventHandler => {
        handler = eventHandler;
        return unsubscribe;
      },
      () => ({ status: "running", host: "127.0.0.1", port: 3000 }),
      () => [],
      DEFAULT_BRIDGE_CONFIG,
      onUpdate,
    );

    handler?.({ type: "server_start", host: "127.0.0.1", port: 3000 });

    expect(onUpdate).toHaveBeenCalled();
    view.dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
