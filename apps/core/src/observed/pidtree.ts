// @gosleep/core — pid-tree correlation (GSL-350 M1 follow-up).
//
// Walks the parent-PID tree to resolve a Claude process's owning tmux pane.
//
// The tmux collector records `pane_pid` for every pane on the server. A shell (bash / zsh)
// running inside the pane forks child processes; a `claude` binary launched in that shell is
// one such descendant. To map "which pane owns this Claude session?" we walk up the PID chain
// from the Claude process until we hit an ancestor whose PID matches any known pane_pid.
//
// The Claude PID itself is discovered indirectly: transcripts under `~/.claude/projects/*.jsonl`
// are held open by the process writing them; `lsof -t <path>` returns the PID(s) holding a
// given file. We look up the pid, then walk ancestors bounded by MAX_DEPTH.
//
// Side-effects declared (for the sentinel review — R14.1):
//   - READS: /proc/*/stat (Linux) or `ps -o ppid=` (macOS) via Bun.spawnSync — parent PID
//     lookup only, never signals or writes.
//   - SPAWNS: `ps` and `lsof` (read-only invocations).
//   - WRITES: none.
//
// Fallback: when the pid walk fails (Claude reparented to launchd, transcript file already
// closed after the assistant turn wrapped, or lsof unavailable), the /fleet query falls back
// to a cwd-prefix match on tmux_panes.pane_current_path and tags the row `attribution =
// 'heuristic'` so the panel can badge it.

import { spawnSync } from "node:child_process";

/** Maximum depth to walk up the parent-PID chain. tmux shells are typically 2-4 levels
 *  above a Claude process (claude → shell → tmux server → …); 15 is a comfortable ceiling. */
export const MAX_DEPTH = 15;

/**
 * Return the parent PID of `pid`, or `null` if it cannot be resolved. Uses
 * `ps -o ppid= -p <pid>` — portable across macOS and Linux. Empty / non-numeric output → null.
 */
export function getParentPid(pid: number): number | null {
  if (!Number.isFinite(pid) || pid <= 1) return null;
  try {
    const p = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], {
      encoding: "utf8",
    });
    if (p.status !== 0) return null;
    const parsed = Number.parseInt((p.stdout ?? "").trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 && parsed !== pid ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Walk the ancestor chain starting from `pid` (inclusive) up to MAX_DEPTH generations.
 * Returns the chain in order [pid, parent, grandparent, …]. Terminates early on:
 *   - unresolved parent (ps failed / pid=1 / cycle),
 *   - depth exhaustion.
 */
export function walkAncestors(pid: number, maxDepth = MAX_DEPTH): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let cur: number | null = pid;
  while (cur !== null && chain.length < maxDepth) {
    if (seen.has(cur)) break; // defensive: no cycles
    seen.add(cur);
    chain.push(cur);
    cur = getParentPid(cur);
    if (cur === null || cur <= 1) break;
  }
  return chain;
}

/**
 * Resolve the first ancestor of `claudePid` (inclusive) whose PID matches any known
 * `panePids`. Returns the owning pane_pid or `null` if none matched within the depth cap.
 */
export function resolveOwningPane(
  claudePid: number,
  panePids: ReadonlySet<number>,
): number | null {
  if (!Number.isFinite(claudePid) || claudePid <= 1) return null;
  const chain = walkAncestors(claudePid);
  for (const anc of chain) {
    if (panePids.has(anc)) return anc;
  }
  return null;
}

/**
 * Discover PIDs currently holding a given file open. Runs `lsof -t <path>` which prints one
 * PID per line and returns exit 1 with empty stdout when nothing has the file open — normal
 * for transcripts whose owning Claude session just finished an assistant turn.
 *
 * Returns [] on any failure (lsof missing, path doesn't exist, permission denied) — the
 * caller falls back to the cwd-prefix heuristic in that case.
 */
export function lsofPidsHoldingFile(path: string): number[] {
  try {
    const p = spawnSync("lsof", ["-t", path], { encoding: "utf8" });
    // lsof exits 1 when no processes hold the file — that's not an error condition here.
    if (p.stdout === undefined || p.stdout.length === 0) return [];
    return p.stdout
      .split("\n")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/**
 * Full resolution: for a given transcript file, find any PID holding it open, then walk the
 * ancestor chain against known pane pids. Returns the first pane PID hit, or `null`.
 */
export function resolvePaneForTranscript(
  transcriptPath: string,
  panePids: ReadonlySet<number>,
): number | null {
  const holders = lsofPidsHoldingFile(transcriptPath);
  for (const holder of holders) {
    const owning = resolveOwningPane(holder, panePids);
    if (owning !== null) return owning;
  }
  return null;
}
