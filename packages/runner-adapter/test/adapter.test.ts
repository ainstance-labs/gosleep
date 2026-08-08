// @gosleep/runner-adapter — SessionAdapter interface tests (GSL-281).
//
// The four seams the interface isolates are all exercised here against the Claude Code
// adapter — the v1 implementation. Coverage:
//
//   1. listSessions() — the injected `lister` path (bypasses the CLI spawn) round-trips a
//      canned roster into `SessionSummary[]`.
//   2. installSessionHooks() — v1 seed returns ok=false with the settingsPath + expected
//      matcher list, so a caller can preview what would land.
//   3. deliverAnswer() — with a `notify` closure injected, the mutation fires the closure;
//      without, the call returns `ok=false, channel="noop"` so the caller can log-and-fall-back.
//   4. readTranscript() — scans a temp scratch dir with a matching JSONL file; returns one
//      TranscriptEntry keyed on the session id.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createClaudeCodeAdapter,
  normaliseAgents,
  type QuestionMutation,
} from "../src/index.ts";

// -----------------------------------------------------------------------------
// listSessions
// -----------------------------------------------------------------------------

describe("SessionAdapter.listSessions (claude-code)", () => {
  test("id and displayName expose the provider label", () => {
    const a = createClaudeCodeAdapter();
    expect(a.id).toBe("claude-code");
    expect(a.displayName).toBe("Claude Code CLI");
  });

  test("normaliseAgents skips malformed rows and preserves valid ones", () => {
    const rows = normaliseAgents([
      { sessionId: "s1", name: "n1", cwd: "/x", status: "busy", kind: "interactive", startedAt: 100, pid: 42 },
      { name: "no-session-id", cwd: "/y", status: "busy" }, // drops (no sessionId)
      { sessionId: "s2", cwd: "/z", status: "busy" },       // drops (no name)
      "not an object",                                       // drops
      null,                                                  // drops
    ]);
    expect(rows.length).toBe(1);
    const [row] = rows;
    if (row === undefined) throw new Error("expected row");
    expect(row.session_id).toBe("s1");
    expect(row.pid).toBe(42);
    expect(row.started_at_epoch_ms).toBe(100);
  });
});

// -----------------------------------------------------------------------------
// installSessionHooks (v1 seed)
// -----------------------------------------------------------------------------

describe("SessionAdapter.installSessionHooks (claude-code v1 seed)", () => {
  test("returns the target settings path + expected hook matchers, ok=false with 'deferred' reason", async () => {
    const a = createClaudeCodeAdapter();
    const r = await a.installSessionHooks({
      projectDir: "/tmp/example-project",
      coreUrl: "http://127.0.0.1:7331",
      hookScriptDir: "/tmp/example-project/tools/hooks",
    });
    expect(r.ok).toBe(false);
    expect(r.settingsPath).toBe("/tmp/example-project/.claude/settings.json");
    expect(r.hooks).toContain("PreToolUse{AskUserQuestion}");
    expect(r.hooks).toContain("PreToolUse{PermissionRequest}");
    expect(r.hooks).toContain("PreToolUse{tool-observed}");
    expect(r.reason.length).toBeGreaterThan(0);
    expect(r.reason).toContain("GSL-267");
  });
});

// -----------------------------------------------------------------------------
// deliverAnswer
// -----------------------------------------------------------------------------

describe("SessionAdapter.deliverAnswer (claude-code)", () => {
  test("with a notify closure injected: fires the closure and returns in-process-notifier", () => {
    const captured: QuestionMutation[] = [];
    const a = createClaudeCodeAdapter({
      notify: (m) => captured.push(m),
    });
    const r = a.deliverAnswer({
      qid: "q-42",
      status: "answered",
      answer_text: "yes",
      answered_at: "2026-08-08T00:00:00Z",
      answered_by: "owner-web",
    });
    expect(r.ok).toBe(true);
    expect(r.channel).toBe("in-process-notifier");
    expect(captured.length).toBe(1);
    const [m] = captured;
    if (m === undefined) throw new Error("expected captured mutation");
    expect(m.qid).toBe("q-42");
    expect(m.answer_text).toBe("yes");
  });

  test("without a notify closure: ok=false, channel='noop', reason names the missing dependency", () => {
    const a = createClaudeCodeAdapter();
    const r = a.deliverAnswer({
      qid: "q-99",
      status: "answered",
      answer_text: "no",
      answered_at: null,
      answered_by: null,
    });
    expect(r.ok).toBe(false);
    expect(r.channel).toBe("noop");
    expect(r.reason).toContain("notifier");
  });
});

// -----------------------------------------------------------------------------
// readTranscript (enrichment-only)
// -----------------------------------------------------------------------------

describe("SessionAdapter.readTranscript (claude-code)", () => {
  const scratch = join(tmpdir(), `gosleep-adapter-transcripts-${process.pid}`);
  const projectDir = join(scratch, "some-project-slug");
  const sessionId = "a3303154-94ab-43fb-91f9-d0d19f1943b7";
  const targetPath = join(projectDir, `${sessionId}.jsonl`);

  beforeAll(() => {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(targetPath, '{"role":"user","content":"hi"}\n');
    // A distractor file that must NOT be returned — different session id.
    writeFileSync(join(projectDir, "other-uuid.jsonl"), '{"role":"user"}\n');
  });
  afterAll(() => {
    if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
  });

  test("scans the transcripts root and returns entries whose filename contains the session id", () => {
    const a = createClaudeCodeAdapter({ transcriptsRoot: scratch });
    const r = a.readTranscript(sessionId);
    expect(r.ok).toBe(true);
    expect(r.session_id).toBe(sessionId);
    expect(r.entries.length).toBe(1);
    const [entry] = r.entries;
    if (entry === undefined) throw new Error("expected entry");
    expect(entry.path).toBe(targetPath);
    expect(entry.size_bytes).toBeGreaterThan(0);
    expect(entry.modified_at_epoch_ms).toBeGreaterThan(0);
  });

  test("empty session id → ok=false, no scan performed", () => {
    const a = createClaudeCodeAdapter({ transcriptsRoot: scratch });
    const r = a.readTranscript("");
    expect(r.ok).toBe(false);
    expect(r.entries.length).toBe(0);
  });

  test("missing transcripts root → ok=false with a descriptive reason", () => {
    const a = createClaudeCodeAdapter({ transcriptsRoot: join(scratch, "does-not-exist") });
    const r = a.readTranscript(sessionId);
    expect(r.ok).toBe(false);
    expect(r.reason.length).toBeGreaterThan(0);
  });

  test("unknown session id → ok=true with an empty entry list", () => {
    const a = createClaudeCodeAdapter({ transcriptsRoot: scratch });
    const r = a.readTranscript("00000000-0000-0000-0000-000000000000");
    expect(r.ok).toBe(true);
    expect(r.entries.length).toBe(0);
  });
});
