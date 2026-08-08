// @gosleep/channel — server (JSON-RPC dispatcher) unit tests (GSL-282). Uses
// the in-memory createServer() so we don't need a real stdio pipe.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createServer } from "../src/server.ts";

const SECRET_KEY = "GOSLEEP_INTERNAL_SECRET";
let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env[SECRET_KEY];
  // The server layer never TOUCHES fetch when GOSLEEP_INTERNAL_SECRET is
  // unset (relay.ts short-circuits with failedOpen), so we can prove the
  // "fail open silently, emit no channel reply" branch without stubbing.
  delete process.env[SECRET_KEY];
});
afterEach(() => {
  if (originalSecret !== undefined) process.env[SECRET_KEY] = originalSecret;
});

describe("createServer", () => {
  it("initialize returns the claude/channel/permission capability", async () => {
    const emitted: string[] = [];
    const server = createServer((line) => emitted.push(line));
    const res = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(res).not.toBeNull();
    expect(res?.id).toBe(1);
    const result = res?.result as { capabilities: Record<string, unknown>; serverInfo: { name: string } };
    expect(result.capabilities).toHaveProperty("claude/channel/permission");
    expect(result.serverInfo.name).toBe("@gosleep/channel");
    expect(emitted).toHaveLength(0); // initialize returns a response, not a notification
  });

  it("permission_request without secret set — no channel reply, no throw", async () => {
    const emitted: string[] = [];
    const server = createServer((line) => emitted.push(line));
    const res = await server.handle({
      jsonrpc: "2.0",
      method: "notifications/claude/channel/permission_request",
      params: {
        request_id: "r1",
        tool_name: "Bash",
        description: "run ls",
        input_preview: "ls",
      },
    });
    // Notifications never return a JSON-RPC response.
    expect(res).toBeNull();
    // Fail-open: no outbound notification either — the local TUI wins.
    expect(emitted).toHaveLength(0);
  });

  it("bad permission_request payload is dropped (schema rejection), does not crash", async () => {
    const emitted: string[] = [];
    const server = createServer((line) => emitted.push(line));
    // Missing request_id — should be caught by the zod parser.
    const res = await server.handle({
      jsonrpc: "2.0",
      method: "notifications/claude/channel/permission_request",
      params: { tool_name: "Bash" },
    });
    expect(res).toBeNull();
    expect(emitted).toHaveLength(0);
  });

  it("unknown method returns -32601 for a request (id present)", async () => {
    const emitted: string[] = [];
    const server = createServer((line) => emitted.push(line));
    const res = await server.handle({ jsonrpc: "2.0", id: 2, method: "does/not/exist" });
    expect(res).not.toBeNull();
    expect(res?.error?.code).toBe(-32601);
  });

  it("unknown method returns null for a notification (no id)", async () => {
    const emitted: string[] = [];
    const server = createServer((line) => emitted.push(line));
    const res = await server.handle({ jsonrpc: "2.0", method: "does/not/exist" });
    expect(res).toBeNull();
    expect(emitted).toHaveLength(0);
  });

  it("steer_drain without secret — no channel messages, no throw", async () => {
    const emitted: string[] = [];
    const server = createServer((line) => emitted.push(line));
    const res = await server.handle({
      jsonrpc: "2.0",
      method: "notifications/claude/channel/steer_drain",
      params: { session_id: "s-1" },
    });
    expect(res).toBeNull();
    expect(emitted).toHaveLength(0);
  });
});
