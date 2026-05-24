import { vi } from "vitest";

// Stub browser globals for Node.js test environment
vi.stubGlobal("location", {
  protocol: "http:",
  host: "localhost:5173",
  hostname: "localhost",
  port: "5173",
  pathname: "/",
  search: "",
  hash: "",
  href: "http://localhost:5173/",
  origin: "http://localhost:5173",
  ancestorOrigins: {} as DOMStringList,
  assign: vi.fn(),
  reload: vi.fn(),
  replace: vi.fn(),
  toString: () => "http://localhost:5173/",
});

vi.stubGlobal("history", {
  length: 1,
  scrollRestoration: "auto" as ScrollRestoration,
  state: null,
  back: vi.fn(),
  forward: vi.fn(),
  go: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
});
