// @gosleep/core — spawn helper for the write-action tools (GSL-268).
//
// Every POST /actions/* endpoint spawns a bash tool from tools/lab/. This helper wraps
// Bun.spawn with the two properties that matter for the write path:
//
//   1. TIMEOUT. A lab-emit call is normally <200 ms; a tick is normally <5 s. Anything longer
//      is a bug in the tool, not a signal the request should be held open — so we time out
//      hard and return the partial stdout/stderr in the error path. Tick uses a longer ceiling
//      than the other tools because it composes several sub-tools.
//   2. ENV PASS-THROUGH. GOSLEEP_LAB_DIR MUST propagate — the smoke fixture (`GOSLEEP_LAB_DIR`
//      pointing at .artifacts/action-smoke/lab) is the only thing keeping this task's live-proof
//      out of the production docs/lab tree. `PATH` and `HOME` also propagate so bash / python3
//      find their normal binaries; nothing else leaks by default.
//
// Fire-and-forget mode (`background: true`) is used for POST /actions/tick — the tick is a
// long, multi-step spawn that would time out the HTTP response if awaited; the caller returns
// immediately with the intent_id and the tick's own ledger event surfaces later via SSE.

import { spawn as bunSpawn } from "bun";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../../..");

export interface SpawnResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  elapsedMs: number;
}

export interface SpawnOptions {
  /** Command + args (the first element is the executable, rest are args). */
  cmd: string[];
  /** Cwd for the spawn (default: repo root). */
  cwd?: string;
  /** Milliseconds after which we kill the process and return `timedOut: true`. */
  timeoutMs?: number;
  /**
   * Extra env vars to inject. GOSLEEP_LAB_DIR is auto-forwarded from process.env if set —
   * callers do not need to duplicate it. PATH and HOME are always forwarded from the parent so
   * bash/python3 resolve normally under launchd's sanitised env.
   */
  env?: Record<string, string>;
}

/**
 * Spawn synchronously (await the process to exit) with a timeout ceiling. Returns the full
 * stdout/stderr and an ok flag; a timed-out process is killed with SIGTERM (then SIGKILL after
 * 500 ms) and returned as `timedOut: true, ok: false`.
 */
export async function spawnAwait(opts: SpawnOptions): Promise<SpawnResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin",
    HOME: process.env.HOME ?? "",
  };
  // Auto-forward GOSLEEP_LAB_DIR (the smoke fixture depends on this) and GOSLEEP_RUN_ID (the
  // event envelope tags every emitted line with it).
  if (typeof process.env.GOSLEEP_LAB_DIR === "string" && process.env.GOSLEEP_LAB_DIR.length > 0) {
    env.GOSLEEP_LAB_DIR = process.env.GOSLEEP_LAB_DIR;
  }
  if (typeof process.env.GOSLEEP_RUN_ID === "string" && process.env.GOSLEEP_RUN_ID.length > 0) {
    env.GOSLEEP_RUN_ID = process.env.GOSLEEP_RUN_ID;
  }
  for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = v;

  const proc = bunSpawn({
    cmd: opts.cmd,
    cwd: opts.cwd ?? REPO_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      /* proc may already be dead */
    }
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 500);
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(killTimer);

  return {
    ok: !timedOut && exitCode === 0,
    code: exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    timedOut,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Fire the spawn and return immediately. The caller is responsible for stashing the intent_id
 * so a later SSE event can be correlated to the spawn.
 *
 * We DO NOT lose stdout/stderr — they get drained into the passed-in `onExit` callback so a
 * follow-up ledger entry can note the outcome. If `onExit` throws, the failure only lands in
 * the process error log; the HTTP response has long since returned.
 */
export function spawnDetached(
  opts: SpawnOptions,
  onExit?: (result: SpawnResult) => void,
): void {
  // Fire-and-forget: run in the background via the awaiter, and pipe the result to onExit if
  // the caller wants it. The IIFE returns a promise the runtime forgets about — the try/catch
  // guards against an unhandled rejection crashing the process.
  void (async (): Promise<void> => {
    try {
      const r = await spawnAwait(opts);
      onExit?.(r);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.spawn_detached_error",
          cmd: opts.cmd.join(" "),
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  })();
}
