// GSL-320 — unit tests for the permission tool_input reconciliation.
//
// The endpoint `POST /internal/permissions/post` used to expect the MCP-style shape
// (`{tool, params, message}`) but the real hook wiring (GSL-304) is Claude Code's native
// PermissionRequest event, where `tool_input` is the tool call's arguments directly:
//   Bash → `{command, description?}`, Edit → `{file_path, old_string, new_string}`, …
// The reconciler in `flattenToolInput` handles both shapes; these tests pin the behaviour so
// a future refactor cannot silently regress the run-06 fix.

import { describe, expect, it } from "bun:test";

import { flattenToolInput, encodeToolInputForStorage } from "../src/routes/internal.ts";

describe("flattenToolInput (GSL-320)", () => {
  it("uses the whole tool_input as params for a Bash PermissionRequest payload", () => {
    // Real Claude Code PermissionRequest event for a Bash call — this is the shape that used
    // to collapse to null and hide the command from the panel card.
    const input = {
      command: "gh pr create --title 'GSL-315 React to-do app' --body-file /tmp/pr.md",
      description: "Create the PR for the todo app",
    };
    expect(flattenToolInput(input)).toEqual(input);
  });

  it("uses the whole tool_input as params for an Edit PermissionRequest payload", () => {
    const input = {
      file_path: "/tmp/foo.ts",
      old_string: "const x = 1;",
      new_string: "const x = 2;",
    };
    expect(flattenToolInput(input)).toEqual(input);
  });

  it("uses .params for MCP-style payload with .tool present", () => {
    const input = {
      tool: "Bash",
      params: { command: "ls -la" },
      message: "list files",
    };
    expect(flattenToolInput(input)).toEqual({ command: "ls -la" });
  });

  it("uses .params for MCP-style payload with .params present but .tool absent", () => {
    const input = { params: { file_path: "/tmp/x" } };
    expect(flattenToolInput(input)).toEqual({ file_path: "/tmp/x" });
  });

  it("returns null when .params is explicitly null in the MCP shape", () => {
    // A caller that says "this permission has no params" should still be honoured, not
    // reinterpreted as a direct-args payload.
    const input = { tool: "SomeMcpTool", params: null };
    expect(flattenToolInput(input)).toBeNull();
  });

  it("collapses empty tool_input to null", () => {
    expect(flattenToolInput({})).toBeNull();
  });

  it("strips the reserved 'tool' / 'message' keys in the direct-args flow", () => {
    // Hypothetical mixed payload — no .params, but a stray "message" alongside real args.
    // We treat it as direct args and drop the metadata keys.
    const input = {
      command: "echo hi",
      message: "explain",
    };
    expect(flattenToolInput(input)).toEqual({ command: "echo hi" });
  });
});

describe("encodeToolInputForStorage (GSL-320)", () => {
  it("returns null for null / undefined input", () => {
    expect(encodeToolInputForStorage(null)).toBeNull();
    expect(encodeToolInputForStorage(undefined)).toBeNull();
  });

  it("json-serialises simple objects", () => {
    expect(encodeToolInputForStorage({ command: "ls" })).toEqual('{"command":"ls"}');
  });

  it("truncates payloads over 4 KB with a … suffix marker", () => {
    // Long Edit / Write payloads would otherwise bloat the row and slow the SPA render.
    const bigContent = "x".repeat(10_000);
    const encoded = encodeToolInputForStorage({ file_path: "/tmp/x", content: bigContent });
    expect(encoded).not.toBeNull();
    expect(encoded!.length).toBeLessThanOrEqual(4096);
    expect(encoded!.endsWith("…")).toBe(true);
  });

  it("returns null for an object that json-serialises to an empty string", () => {
    // JSON.stringify(undefined) is undefined — encoder collapses to null.
    expect(encodeToolInputForStorage(undefined)).toBeNull();
  });
});
