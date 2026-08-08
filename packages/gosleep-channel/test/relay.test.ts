// @gosleep/channel — relay client unit tests (GSL-282). Exercises the
// fail-open + happy-path branches of relayPermissionRequest + waitForDecision
// with a mock fetch, no live core needed.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { relayPermissionRequest, waitForDecision, type FetchFn } from "../src/relay.ts";

// Save/restore process.env keys we manipulate so tests don't leak.
const SECRET_KEY = "GOSLEEP_INTERNAL_SECRET";
let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env[SECRET_KEY];
  process.env[SECRET_KEY] = "test-secret";
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = originalSecret;
});

describe("relayPermissionRequest", () => {
  it("fails open when GOSLEEP_INTERNAL_SECRET is unset", async () => {
    delete process.env[SECRET_KEY];
    const req = { request_id: "r1", tool_name: "Bash", description: "", input_preview: "" };
    const stub: FetchFn = async () => new Response("should not be called", { status: 500 });
    const result = await relayPermissionRequest(req, stub);
    expect(result.ok).toBe(false);
    expect(result.failedOpen).toBe(true);
  });

  it("fails open on 503 (core /internal off)", async () => {
    const req = { request_id: "r2", tool_name: "Bash", description: "", input_preview: "" };
    const stub: FetchFn = async () => new Response("{}", { status: 503 });
    const result = await relayPermissionRequest(req, stub);
    expect(result.ok).toBe(false);
    expect(result.failedOpen).toBe(true);
  });

  it("fails open on network error", async () => {
    const req = { request_id: "r3", tool_name: "Bash", description: "", input_preview: "" };
    const stub: FetchFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await relayPermissionRequest(req, stub);
    expect(result.ok).toBe(false);
    expect(result.failedOpen).toBe(true);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns qid on a happy 200", async () => {
    const req = {
      request_id: "r4",
      tool_name: "Bash",
      description: "run ls",
      input_preview: "ls -la",
    };
    let capturedBody: string | undefined;
    const stub: FetchFn = async (_url, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({ ok: true, qid: "p-20260808-abc", opened_at: "2026-08-08T00:00:00Z" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const result = await relayPermissionRequest(req, stub);
    expect(result.ok).toBe(true);
    expect(result.qid).toBe("p-20260808-abc");
    // Confirms we translated the channel payload into the same shape /internal/permissions/post
    // already accepts (from GSL-284), so the shared UI + storage keeps working.
    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody as string) as {
      tool_use_id: string;
      tool_input: { tool: string; message: string };
    };
    expect(parsed.tool_use_id).toBe("r4");
    expect(parsed.tool_input.tool).toBe("Bash");
    expect(parsed.tool_input.message).toContain("ls -la");
  });

  it("returns error on schema mismatch from core", async () => {
    const req = { request_id: "r5", tool_name: "Bash", description: "", input_preview: "" };
    const stub: FetchFn = async () =>
      new Response(JSON.stringify({ ok: "yes", qid: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const result = await relayPermissionRequest(req, stub);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("schema");
  });
});

describe("waitForDecision", () => {
  it("returns behavior on a 200 with allow", async () => {
    const stub: FetchFn = async () =>
      new Response(
        JSON.stringify({ ok: true, qid: "p-1", behavior: "allow", answered_by: "web" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    const result = await waitForDecision("p-1", 5, stub);
    expect(result.behavior).toBe("allow");
    expect(result.answered_by).toBe("web");
  });

  it("returns timeout on 204", async () => {
    const stub: FetchFn = async () => new Response(null, { status: 204 });
    const result = await waitForDecision("p-2", 5, stub);
    expect(result.timeout).toBe(true);
  });

  it("returns error on 404", async () => {
    const stub: FetchFn = async () => new Response("not found", { status: 404 });
    const result = await waitForDecision("p-3", 5, stub);
    expect(result.error).toBe("unknown qid");
  });

  it("fails open on 503", async () => {
    const stub: FetchFn = async () => new Response("nope", { status: 503 });
    const result = await waitForDecision("p-4", 5, stub);
    expect(result.failedOpen).toBe(true);
  });
});
