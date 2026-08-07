// @gosleep/runner-adapter — Claude Code CLI adapter (GSL-276).
//
// The ONE place the harness process shells to `claude`. Kept in packages/runner-adapter so:
//   1. apps/core/ imports nothing that hard-codes the CLI shape — the day the harness switches
//      to a different runner (a remote SessionAdapter per rev-3 addendum Delta 10, an in-process
//      SDK, a different local agent host), only THIS file changes.
//   2. Unit tests for the fleet-poll worker mock a single import surface (`listClaudeAgents`)
//      instead of stubbing `Bun.spawn` inside every test.
//
// CONTRACT. `claude agents --json` on a Tahoe-26.x + Claude Code 2.6.x host prints a JSON array
// of live agent sessions. Each entry carries (verified 2026-08-07 against the running host):
//
//   [
//     {
//       "pid": 27169,
//       "cwd": "/Users/romanlidovskyi/Documents/dev/harness/gosleep",
//       "kind": "interactive",
//       "startedAt": 1786027921831,
//       "sessionId": "a3303154-94ab-43fb-91f9-d0d19f1943b7",
//       "name": "gosleep-93",
//       "status": "busy"
//     },
//     ...
//   ]
//
// FIELDS WE DO NOT GET FROM THE CLI. `model`, `cycle`, `context_pct`, `current_tool`,
// `current_intent` — those come from the PreToolUse shim (context_pct/current_tool) or from
// the harness (cycle parsed from name, model from settings.local.json). The adapter surfaces
// only what the CLI natively knows; the worker layer fills the rest.
//
// TIMEOUT. The CLI is normally <200 ms; a hung poll is a bug in the CLI, not a signal the
// server should hold a socket open. Hard 5 s ceiling. On timeout / non-zero exit we return
// an empty list and log — the fleet-poll worker treats that as "nothing to reconcile this
// tick" (better than pretending every session ended, which would fire spurious ended_at).

import { spawn as bunSpawn } from "bun";

/**
 * The row shape `claude agents --json` prints. Only fields we consume are typed; unknown
 * future fields survive the JSON.parse and are ignored.
 */
export interface ClaudeAgent {
  session_id: string;
  name: string;
  kind: string;
  pid: number | null;
  cwd: string;
  status: string;
  /** Epoch ms from CLI. Converted to ISO in the caller — we surface the CLI shape verbatim. */
  started_at_epoch_ms: number;
}

export interface ListAgentsOptions {
  /** Override the `claude` binary path (default: the one on PATH). Test hook. */
  claudeBin?: string;
  /** Milliseconds after which we give up. Default 5000. */
  timeoutMs?: number;
}

export interface ListAgentsResult {
  ok: boolean;
  agents: ClaudeAgent[];
  /** Millisecond wall-clock of the spawn — surfaced to the fleet-poll worker for /metrics. */
  elapsedMs: number;
  /** Non-empty when ok=false: `"timeout"`, `"exit=N"`, `"parse: <msg>"`, `"spawn: <msg>"`. */
  reason: string;
}

/**
 * Spawn `claude agents --json`, parse the resulting JSON array, and normalise into
 * `ClaudeAgent[]`. Never throws — a spawn failure, a timeout, or a JSON parse error all
 * return `{ ok: false, agents: [] }` with a descriptive `reason`.
 */
export async function listClaudeAgents(
  opts: ListAgentsOptions = {},
): Promise<ListAgentsResult> {
  const claudeBin = opts.claudeBin ?? "claude";
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const started = Date.now();

  let proc: ReturnType<typeof bunSpawn>;
  try {
    proc = bunSpawn({
      cmd: [claudeBin, "agents", "--json"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin",
        HOME: process.env.HOME ?? "",
      },
    });
  } catch (err) {
    return {
      ok: false,
      agents: [],
      elapsedMs: Date.now() - started,
      reason: `spawn: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 200);
  }, timeoutMs);

  // `stdout: "pipe"` above narrows this to a ReadableStream; Bun's typings still union it
  // with `number | undefined` for the other stdio modes.
  const stdoutStream = proc.stdout as ReadableStream<Uint8Array>;
  const [stdout, exitCode] = await Promise.all([
    new Response(stdoutStream).text(),
    proc.exited,
  ]);
  clearTimeout(killTimer);
  const elapsedMs = Date.now() - started;

  if (timedOut) {
    return { ok: false, agents: [], elapsedMs, reason: "timeout" };
  }
  if (exitCode !== 0) {
    return { ok: false, agents: [], elapsedMs, reason: `exit=${exitCode}` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch (err) {
    return {
      ok: false,
      agents: [],
      elapsedMs,
      reason: `parse: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const agents = normaliseAgents(raw);
  return { ok: true, agents, elapsedMs, reason: "" };
}

/**
 * Exported for unit tests — turns an unknown blob (an array from `claude agents --json`) into
 * a strongly-typed `ClaudeAgent[]`, dropping entries missing required fields (session_id, name,
 * cwd, status). NEVER throws: a malformed row is skipped, not a hard failure.
 */
export function normaliseAgents(raw: unknown): ClaudeAgent[] {
  if (!Array.isArray(raw)) return [];
  const out: ClaudeAgent[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : null;
    const name = typeof rec.name === "string" ? rec.name : null;
    const cwd = typeof rec.cwd === "string" ? rec.cwd : null;
    const kind = typeof rec.kind === "string" ? rec.kind : "unknown";
    const status = typeof rec.status === "string" ? rec.status : "unknown";
    const startedAt =
      typeof rec.startedAt === "number" && Number.isFinite(rec.startedAt)
        ? rec.startedAt
        : Date.now();
    const pid =
      typeof rec.pid === "number" && Number.isFinite(rec.pid) ? Math.trunc(rec.pid) : null;
    if (sessionId === null || sessionId.length === 0) continue;
    if (name === null || name.length === 0) continue;
    if (cwd === null || cwd.length === 0) continue;
    out.push({
      session_id: sessionId,
      name,
      kind,
      pid,
      cwd,
      status,
      started_at_epoch_ms: startedAt,
    });
  }
  return out;
}
