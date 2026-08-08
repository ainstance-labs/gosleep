// @gosleep/runner-adapter — Claude Code CLI adapter (GSL-276; SessionAdapter wrapper GSL-281).
//
// The ONE place the harness process shells to `claude`. Kept in packages/runner-adapter so:
//   1. `apps/core/` imports nothing that hard-codes the CLI shape — the day the harness
//      switches to a different runner (a remote SessionAdapter per rev-3 addendum Delta 10,
//      an in-process SDK, a different local agent host), only THIS file changes.
//   2. Unit tests for the fleet-poll worker mock a single import surface
//      (`listClaudeAgents` today; `SessionAdapter.listSessions()` post-GSL-281) instead of
//      stubbing `Bun.spawn` inside every test.
//
// LOW-LEVEL: `listClaudeAgents` shells to the CLI and returns the parsed roster verbatim.
// Kept exported for backward compatibility with tests that already know this shape.
//
// HIGH-LEVEL: `createClaudeCodeAdapter()` returns a `SessionAdapter` whose four methods are
// the seam the rest of the codebase talks to. This is the surface the GSL-281 acceptance
// tripwire requires — `apps/core/src/**` must never mention `claude agents` directly.
//
// CONTRACT for the CLI. `claude agents --json` on a Tahoe-26.x + Claude Code 2.6.x host prints
// a JSON array of live agent sessions. Each entry carries (verified 2026-08-07 against the
// running host):
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
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

import type {
  DeliverAnswerInput,
  DeliverAnswerResult,
  InstallHooksContext,
  InstallHooksResult,
  ListSessionsOptions,
  ListSessionsResult,
  QuestionMutation,
  ReadTranscriptResult,
  SessionAdapter,
  SessionSummary,
  TranscriptEntry,
} from "./session-adapter.ts";

// -----------------------------------------------------------------------------
// low-level CLI shell (kept exported for backward compat)
// -----------------------------------------------------------------------------

/**
 * The row shape the Claude Code CLI prints. Only fields we consume are typed; unknown
 * future fields survive the JSON.parse and are ignored.
 *
 * Historical alias: `ClaudeAgent` matches the pre-GSL-281 export name that the fleet-poll
 * worker + test suite already consume. Kept as-is so this migration touches call-sites, not
 * their type imports.
 */
export interface ClaudeAgent extends SessionSummary {}

export interface ListAgentsOptions extends ListSessionsOptions {
  /** Override the `claude` binary path (default: the one on PATH). Test hook. */
  claudeBin?: string;
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
 * Exported for unit tests — turns an unknown blob (an array from the Claude Code CLI) into
 * a strongly-typed `ClaudeAgent[]`, dropping entries missing required fields (session_id,
 * name, cwd, status). NEVER throws: a malformed row is skipped, not a hard failure.
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

// -----------------------------------------------------------------------------
// high-level SessionAdapter implementation
// -----------------------------------------------------------------------------

export interface CreateClaudeCodeAdapterOptions {
  /** Injected by `apps/core/` so `deliverAnswer` routes into the in-process notifier.
   *  Left undefined in tests that only exercise `listSessions()` / `readTranscript()`. */
  notify?: (mutation: QuestionMutation) => void;
  /** Override the `claude` binary path (test hook). */
  claudeBin?: string;
  /** Override the transcripts root (default: `~/.claude/projects`). Test hook. */
  transcriptsRoot?: string;
  /** Override the default list timeout (ms). */
  listTimeoutMs?: number;
}

/**
 * Build a SessionAdapter backed by the Claude Code CLI + the in-process question notifier.
 * v1 seed — see references in the SessionAdapter interface docstring.
 */
export function createClaudeCodeAdapter(
  opts: CreateClaudeCodeAdapterOptions = {},
): SessionAdapter {
  const claudeBin = opts.claudeBin;
  const listTimeoutMs = opts.listTimeoutMs;
  const notify = opts.notify;
  const transcriptsRoot = opts.transcriptsRoot ?? defaultTranscriptsRoot();

  return {
    id: "claude-code",
    displayName: "Claude Code CLI",

    async listSessions(callOpts?: ListSessionsOptions): Promise<ListSessionsResult> {
      const cliOpts: ListAgentsOptions = {};
      if (claudeBin !== undefined) cliOpts.claudeBin = claudeBin;
      const timeout = callOpts?.timeoutMs ?? listTimeoutMs;
      if (timeout !== undefined) cliOpts.timeoutMs = timeout;
      const r = await listClaudeAgents(cliOpts);
      return {
        ok: r.ok,
        sessions: r.agents,
        elapsedMs: r.elapsedMs,
        reason: r.reason,
      };
    },

    async installSessionHooks(ctx: InstallHooksContext): Promise<InstallHooksResult> {
      // v1 seed: the interface is alive, the concrete install body lands in GSL-267 per
      // the GSL-281 Jira scope. We compute the target path and the matcher list so a caller
      // can render a "here's what would land" preview without actually writing.
      const settingsPath = join(ctx.projectDir, ".claude", "settings.json");
      const hooks = [
        "PreToolUse{AskUserQuestion}",
        "PreToolUse{PermissionRequest}",
        "PreToolUse{tool-observed}",
      ];
      return {
        ok: false,
        settingsPath,
        hooks,
        reason:
          "install-body deferred to GSL-267 per GSL-281 scope — this v1 seed exposes the seam only",
      };
    },

    deliverAnswer(input: DeliverAnswerInput): DeliverAnswerResult {
      if (notify === undefined) {
        return {
          ok: false,
          channel: "noop",
          reason: "no notifier injected — construct the adapter with { notify } to enable delivery",
        };
      }
      // The Claude Code delivery mechanism is: in-process EventEmitter wakes the hook's
      // long-poll GET /internal/questions/:qid/answer-wait (see apps/core/src/routes/internal.ts).
      // The notifier itself lives in apps/core so the adapter package stays runtime-agnostic;
      // production wires `notify: (m) => questionNotifier.notify(m)` at construction time.
      notify({
        qid: input.qid,
        status: input.status,
        answer_text: input.answer_text,
        answered_at: input.answered_at,
        answered_by: input.answered_by,
      });
      return { ok: true, channel: "in-process-notifier", reason: "" };
    },

    readTranscript(sessionId: string): ReadTranscriptResult {
      // ENRICHMENT-ONLY per rev-3 addendum Delta 3. This method is provided so a future
      // enrichment worker can walk the transcripts on demand; the tail indexer must never
      // call it (would break the "no transcript on the live path" guarantee).
      if (sessionId.length === 0) {
        return { ok: false, session_id: sessionId, entries: [], reason: "empty session id" };
      }
      if (!existsSync(transcriptsRoot)) {
        return {
          ok: false,
          session_id: sessionId,
          entries: [],
          reason: `transcripts root missing: ${transcriptsRoot}`,
        };
      }
      const entries: TranscriptEntry[] = [];
      // Two-level scan: `<root>/<project-slug>/<file>.jsonl`. Claude Code names files with
      // the session UUID as a prefix; we match by substring for robustness against version
      // drift in the filename format.
      let projectDirs: string[];
      try {
        projectDirs = readdirSync(transcriptsRoot);
      } catch (err) {
        return {
          ok: false,
          session_id: sessionId,
          entries: [],
          reason: `readdir root: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      for (const projectSlug of projectDirs) {
        const projectPath = join(transcriptsRoot, projectSlug);
        let stat;
        try {
          stat = statSync(projectPath);
        } catch {
          continue;
        }
        if (!stat.isDirectory()) continue;
        let files: string[];
        try {
          files = readdirSync(projectPath);
        } catch {
          continue;
        }
        for (const file of files) {
          if (extname(file) !== ".jsonl") continue;
          if (!basename(file).includes(sessionId)) continue;
          const filePath = join(projectPath, file);
          try {
            const fstat = statSync(filePath);
            entries.push({
              path: filePath,
              session_id: sessionId,
              size_bytes: fstat.size,
              modified_at_epoch_ms: fstat.mtimeMs,
            });
          } catch {
            /* skip unreadable file */
          }
        }
      }
      return { ok: true, session_id: sessionId, entries, reason: "" };
    },
  };
}

function defaultTranscriptsRoot(): string {
  const home = homedir();
  return join(home, ".claude", "projects");
}
