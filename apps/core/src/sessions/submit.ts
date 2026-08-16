// @gosleep/core — task-submission executor (GSL-380, observer mode phase C).
//
// The ONE function inside core that shells out to `tmux send-keys` on behalf of the panel.
// Deliberately narrow: literal-text-only body, argv arrays (no `sh -c`), UTF-8 payload
// bounded to 16 KB (R16.7), sub-0x20 bytes rejected except Tab/Newline (R16 Q5 default).
// Never widen this primitive without an owner ask — the executor's scope is a hard part of
// the security envelope.
//
// SIDE-EFFECTS declared:
//   - READS: `tmux_panes` (pane_ref resolution at dispatch time), `session_control`
//     (state re-check at confirm to catch F16-S6 release-mid-submit).
//   - SPAWNS: `tmux send-keys -t <resolved_target> -l <body>` then `tmux send-keys -t
//     <resolved_target> Enter`. Two invocations — the first is the literal body, the
//     second is a single Enter key press. NO other tmux subcommands, NO capture-pane,
//     NO -H hex, NO -R redraw, NO Ctrl-* key names, NO shell.
//   - WRITES: NONE from this module. The caller (the endpoint) owns the DB write into
//     `task_submissions` after receiving the ExecutorOutcome.
//
// The `resolved_target` is looked up from `tmux_panes` here, NEVER taken from the request
// body (R16.4). A stale pane triggers `outcome='pane_gone'` and the executor does not
// send anything to any pane.

import type { OpenedDb } from "../db/client.ts";
import { readEffectiveState } from "../control/registry.ts";
import { spawnAwait, type SpawnResult } from "../actions/spawn.ts";

/** R16.7 — body payload is bounded and typed. 16 KB fits a substantial task, still bounded. */
export const MAX_BODY_BYTES = 16 * 1024;

/** R16 Q1 — prompt-boundary wait ceiling. Default 5 s (owner-defaulted per the PRD). */
export const PROMPT_BOUNDARY_WAIT_MS = 5_000;

/** How often to re-poll `pane_current_command` while waiting for a prompt-boundary. */
export const PROMPT_BOUNDARY_POLL_MS = 250;

/**
 * The framing enum shipped in the PRD scope table. The executor honours all three:
 *   - `none`             — send the body verbatim, don't wait, don't decorate.
 *   - `prompt-boundary`  — pre-check `pane_current_command` and wait up to 5 s for the
 *                          receiver to be at its own prompt (shell / claude command); if
 *                          the wait times out, refuse with `outcome='not_at_prompt'` and
 *                          send nothing. This is the DEFAULT.
 *   - `slash-command`    — reserved; the request body is expected to already carry a
 *                          leading `/`. The executor treats this as `none` today (the
 *                          panel's dry-run preview lints the shape).
 */
export type SubmissionFraming = "none" | "prompt-boundary" | "slash-command";

/** Every outcome a submission can end with. Mirrors the `task_submissions.outcome` column. */
export type SubmissionOutcome =
  | "delivered"
  | "pane_gone"
  | "released_mid_submit"
  | "not_at_prompt"
  | "send_failed";

/** Warning shape returned from `previewSubmission` (advisory, not blocking). Panel renders. */
export interface SubmissionWarning {
  code: string;
  message: string;
}

/** Advisory secret-shape sweep on the body (R16 Q3 default: yes, advisory only). Cheap regex
 *  set — deliberately loose to catch obvious leaks (AWS key ids, sk- API keys, JWT-shaped
 *  strings), not a full secret scanner. Panel surfaces the warnings above the preview. */
export function scanForSecretShapes(body: string): SubmissionWarning[] {
  const warnings: SubmissionWarning[] = [];
  const rules: Array<{ code: string; message: string; re: RegExp }> = [
    {
      code: "aws-access-key-id",
      message: "Body contains something shaped like an AWS access key ID (AKIA/ASIA + 16 chars).",
      re: /(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[0-9A-Z]{16}\b/,
    },
    {
      code: "openai-api-key",
      message: "Body contains something shaped like an OpenAI-style API key (sk-...).",
      re: /\bsk-[A-Za-z0-9\-_]{20,}\b/,
    },
    {
      code: "anthropic-api-key",
      message: "Body contains something shaped like an Anthropic API key (sk-ant-...).",
      re: /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/,
    },
    {
      code: "github-token",
      message: "Body contains something shaped like a GitHub token (ghp_/ghs_/gho_).",
      re: /\b(?:ghp|ghs|gho|ghu|ghr)_[A-Za-z0-9]{20,}\b/,
    },
    {
      code: "bearer-header",
      message: "Body contains a Bearer-header-shaped fragment; check the recipient wants it.",
      re: /\bBearer\s+[A-Za-z0-9\-_\.=]{20,}\b/,
    },
    {
      code: "jwt-shaped",
      message: "Body contains a JWT-shaped 3-segment token.",
      re: /\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/,
    },
  ];
  for (const rule of rules) {
    if (rule.re.test(body)) warnings.push({ code: rule.code, message: rule.message });
  }
  return warnings;
}

/**
 * Normalise the caller-supplied body into the exact bytes tmux will see. R16 Risk 4 —
 * strip trailing whitespace (so a stray newline doesn't produce a double-enter) and validate
 * every byte is UTF-8 + not a control character outside Tab (0x09) and Newline (0x0A).
 *
 * Returns either the normalised body, or an error describing which rule the body broke.
 * Never mutates the input.
 */
export function normaliseAndValidateBody(
  raw: string,
): { ok: true; body: string } | { ok: false; error: string } {
  if (raw.length === 0) {
    return { ok: false, error: "body is empty" };
  }
  // Strip trailing whitespace but preserve inner content. Verbatim newlines are allowed.
  const trimmed = raw.replace(/\s+$/u, "");
  if (trimmed.length === 0) {
    return { ok: false, error: "body is empty after trimming trailing whitespace" };
  }
  // UTF-8 byte length — sqlite stores TEXT as UTF-8 and the executor caps on bytes, not
  // JS char count (which is UTF-16 code units and would under-count multibyte chars).
  const bytes = new TextEncoder().encode(trimmed);
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      error: `body exceeds ${MAX_BODY_BYTES}-byte cap (got ${bytes.byteLength} bytes)`,
    };
  }
  // Reject sub-0x20 bytes except Tab (0x09) and Newline (0x0A), and DEL (0x7f). Per R16 Q5
  // default — closes the last obvious escape route for the shell layer.
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code === 0x09 || code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) {
      return {
        ok: false,
        error: `body contains disallowed control character U+${code
          .toString(16)
          .padStart(4, "0")} at position ${i}`,
      };
    }
  }
  return { ok: true, body: trimmed };
}

/** SHA-256 of the (normalised) body, hex-lowercase. Used for the timeline event `body_sha256`
 *  field and the `task_submissions.body_sha256` column. */
export async function computeBodySha256(normalised: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Resolve the `session_name:window_id.pane_id` reference for a session by consulting the
 * live `tmux_panes` table. Two-path lookup mirrors `/fleet`:
 *   1. cwd-prefix heuristic — a pane whose `pane_current_path` is at or under the session's
 *      `cwd_project_root`. This is the DEFAULT prod path.
 *   2. pidtree fallback — `t.pane_pid = a.pid` for sessions whose pid was populated by the
 *      opt-in lsof pass. Off-by-default in prod.
 *
 * Returns null when neither path yields a pane row. Never returns a stale row — the SELECT
 * happens live at dispatch time so a pane closed a moment ago collapses to null and the
 * executor short-circuits to `outcome='pane_gone'`.
 */
export function resolvePaneRef(
  db: OpenedDb,
  sessionId: string,
): string | null {
  // GSL-380 fix (verifier m4): guard on non-empty cwd_project_root, not just
  // NOT NULL. The fleet enumerator today writes either NULL or the real project
  // root, but a future writer that persisted an empty string would collapse the
  // cwd-prefix heuristic to `LIKE '/%'` — matching ANY absolute path — and the
  // MAX() aggregation would then return the lexicographically largest pane_ref
  // across the whole tmux_panes table (a foreign pane). Belt + braces:
  // `length(a.cwd_project_root) > 0` at the join guard.
  const row = db.raw
    .query(
      `SELECT COALESCE(heur.pane_ref, pid.pane_ref) AS pane_ref
       FROM agent_sessions a
       LEFT JOIN (
         SELECT pane_current_path,
                MAX(session_name || ':' || window_id || '.' || pane_id) AS pane_ref
         FROM tmux_panes
         WHERE pane_current_path IS NOT NULL
         GROUP BY pane_current_path
       ) heur ON a.cwd_project_root IS NOT NULL
              AND length(a.cwd_project_root) > 0
              AND (heur.pane_current_path = a.cwd_project_root
                   OR heur.pane_current_path LIKE a.cwd_project_root || '/%')
       LEFT JOIN (
         SELECT pane_pid,
                session_name || ':' || window_id || '.' || pane_id AS pane_ref
         FROM tmux_panes
       ) pid ON heur.pane_ref IS NULL
             AND a.pid IS NOT NULL
             AND pid.pane_pid = a.pid
       WHERE a.session_id = ?`,
    )
    .get(sessionId) as { pane_ref: string | null } | null | undefined;
  if (row === null || row === undefined) return null;
  return row.pane_ref;
}

/** Read `pane_current_command` for the resolved pane_ref. Null when the pane isn't in the
 *  table (already gone) or when the command column is null. Prompt-boundary framing uses
 *  this to decide "at a prompt or busy". */
export function readPaneCurrentCommand(
  db: OpenedDb,
  paneRef: string,
): string | null {
  // paneRef is "session_name:window_id.pane_id" — decompose to look up by pane_id (PK).
  const dot = paneRef.lastIndexOf(".");
  if (dot < 0) return null;
  const paneId = paneRef.slice(dot + 1);
  const row = db.raw
    .query(
      `SELECT pane_current_command FROM tmux_panes WHERE pane_id = ?`,
    )
    .get(paneId) as { pane_current_command: string | null } | null | undefined;
  if (row === null || row === undefined) return null;
  return row.pane_current_command;
}

/** Read `pane_pid` for the resolved pane_ref. Null when the pane isn't in the table
 *  (already gone). Used by GSL-390's process-tree probe to disambiguate a version-shaped
 *  `pane_current_command` from a random tool that happens to report as a version string. */
export function readPanePid(db: OpenedDb, paneRef: string): number | null {
  const dot = paneRef.lastIndexOf(".");
  if (dot < 0) return null;
  const paneId = paneRef.slice(dot + 1);
  const row = db.raw
    .query(`SELECT pane_pid FROM tmux_panes WHERE pane_id = ?`)
    .get(paneId) as { pane_pid: number | null } | null | undefined;
  if (row === null || row === undefined) return null;
  return row.pane_pid;
}

/**
 * GSL-390 (fixes E2E run-01 M2): recognise a version-shaped `pane_current_command`. Real
 * Claude Code sessions (2.1.233 in the run-01 fixture, 2.1.x on the shipping channel today)
 * set their argv so tmux's `#{pane_current_command}` reports the version string instead of
 * "claude". Accept `2.1.233`, `v2.1.233`, `1.0`, `1.2.3.4`, `2.1.233+build.5`, `2.1.233-rc1`.
 * Anything else (semver-with-suffix like `2.1.233-canary.hash`, plain shell names) falls
 * through to the standard allowlist path.
 */
export function isVersionShapedCommand(command: string | null): boolean {
  if (command === null) return false;
  const t = command.trim();
  if (t.length === 0) return false;
  return /^v?\d+\.\d+(\.\d+){0,2}([+-][A-Za-z0-9._]+)?$/.test(t);
}

/**
 * Heuristic: is the pane at a prompt? The list of "at a prompt" leaf commands is the
 * standard shell set (bash/zsh/fish/sh) plus the Claude CLI when it's waiting for input
 * (`claude` itself, as reported by tmux — pty state, not process state). We treat unknown
 * commands as "busy" so a receiver we don't recognise defaults to the safer wait.
 *
 * GSL-380 fix (verifier m3): `node` and `bun` used to be on the whitelist as "REPL leaves
 * a prompt". In practice a Claude Code session spawns a `node` (or `bun`) subprocess to
 * run a tool, and `tmux #{pane_current_command}` reports that leaf command WHILE the
 * tool is still executing. Under the old whitelist that reported "at prompt" and the
 * submission landed mid-tool-execution, interleaving the operator's typed body with the
 * tool's output — the receiving Claude then treated the body as an out-of-turn user
 * message and the tool call was derailed (F16 Risk 1). Restrict to pure shells;
 * `claude` stays on the whitelist because it is the only leaf command we know reports
 * itself at pty-idle when the CLI is at its own prompt.
 *
 * GSL-390 (E2E run-01 M2): Claude Code 2.1.x renames its process argv so tmux reports the
 * version string (e.g. `2.1.233`) as `pane_current_command`. The sync predicate does NOT
 * accept version strings on its own — a randomly-named tool that happens to render as
 * "2.1.233" would then be treated as claude. The disambiguation lives in
 * `paneQualifiesAsPrompt` below: version-shaped + a `claude` process actually present in
 * the pane's process tree.
 */
export function isPaneAtPrompt(command: string | null): boolean {
  if (command === null || command.length === 0) return false;
  const lower = command.trim().toLowerCase();
  const promptSet = new Set([
    "bash",
    "zsh",
    "fish",
    "sh",
    "dash",
    "ksh",
    "tcsh",
    "csh",
    // The Claude CLI reports itself when idle at its prompt.
    "claude",
  ]);
  return promptSet.has(lower);
}

/**
 * Return the `comm` string of every descendant of `rootPid`, PLUS `rootPid`'s own comm
 * (BFS on `ps` output). Including the root itself matters on macOS Claude Code 2.1.x:
 * the pane_pid IS the Claude process, and its argv[0] `ps -o comm=` reports as `claude`
 * even though tmux's `#{pane_current_command}` (kernel-level exec basename) reports the
 * version string. If we only walked descendants we'd miss the "pane_pid is claude
 * itself" case and reject a legitimate Claude Code fixture.
 *
 * Best effort — a spawn error yields an empty list, which the caller treats as "no
 * claude in the tree, keep waiting". Uses `ps -eo pid=,ppid=,comm=` — the `=` suppresses
 * the header row and the tokens split cleanly on whitespace (comm never contains a
 * space).
 *
 * The default implementation is exported so tests can swap it with a fixture.
 */
export async function readDescendantCommsDefault(rootPid: number): Promise<string[]> {
  try {
    const proc = Bun.spawn(["ps", "-eo", "pid=,ppid=,comm="], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [text] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return descendantCommsFromPsOutput(text, rootPid);
  } catch {
    return [];
  }
}

/** Pure parser (exported for tests). Walks the ps table rooted at `rootPid`.
 *
 * The rootPid's OWN comm is included first (GSL-390 live-leg fix): a Claude Code 2.1.x
 * pane_pid IS the claude process itself, and `ps -o comm=` returns its argv[0]
 * ("claude") — that's the very signal we want to accept. Only walking descendants would
 * miss it, because the descendants are usually the tools claude is spawning (node, npm,
 * chrome-devtools-mcp — never `claude`). Including root also mirrors the "does this
 * pane run claude" question a human would ask when eyeballing `ps`.
 */
export function descendantCommsFromPsOutput(
  psOutput: string,
  rootPid: number,
): string[] {
  interface Row {
    pid: number;
    ppid: number;
    comm: string;
  }
  const rows: Row[] = [];
  for (const rawLine of psOutput.split("\n")) {
    const line = rawLine.trimStart();
    if (line.length === 0) continue;
    // pid ppid comm — comm is basename on macOS/Linux, may contain path chars but not
    // whitespace. Take the first two tokens as pid/ppid and the rest of the line as comm.
    const m = /^(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m || m[3] === undefined) continue;
    rows.push({
      pid: Number.parseInt(m[1]!, 10),
      ppid: Number.parseInt(m[2]!, 10),
      comm: m[3].trim(),
    });
  }
  const childrenByPpid = new Map<number, Row[]>();
  const rowByPid = new Map<number, Row>();
  for (const r of rows) {
    let list = childrenByPpid.get(r.ppid);
    if (!list) {
      list = [];
      childrenByPpid.set(r.ppid, list);
    }
    list.push(r);
    rowByPid.set(r.pid, r);
  }
  const results: string[] = [];
  // GSL-390 (live-leg fix): include the root's own comm so a Claude Code 2.1.x
  // pane_pid — whose `ps -o comm=` returns "claude" even though tmux reports the
  // version string — qualifies without needing a descendant with that name.
  const rootRow = rowByPid.get(rootPid);
  if (rootRow) results.push(rootRow.comm);
  const seen = new Set<number>();
  const stack: number[] = [rootPid];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const kids = childrenByPpid.get(cur);
    if (!kids) continue;
    for (const k of kids) {
      results.push(k.comm);
      stack.push(k.pid);
    }
  }
  return results;
}

/**
 * GSL-390 — comm-level "does the pane run Claude Code?" check. Matches the exact comm
 * "claude", a comm whose basename is claude (`/usr/local/bin/claude`), or a comm that
 * BEGINS with "claude" followed by `-` or whitespace (`claude-2.1.233`). Version-shaped
 * comms alone are not counted here — the pane's outer command is version-shaped, and the
 * process tree needs a REAL claude in it to qualify.
 */
export function commLooksLikeClaude(comm: string): boolean {
  const t = comm.trim();
  if (t.length === 0) return false;
  if (t === "claude") return true;
  const slash = t.lastIndexOf("/");
  const basename = slash >= 0 ? t.slice(slash + 1) : t;
  if (basename === "claude") return true;
  // "claude-2.1.233", "claude helper", "claude:main" — anything starting with claude
  // followed by a separator counts.
  return /^claude(?:[\s\-:.]|$)/.test(basename);
}

/**
 * GSL-390 — the async prompt-boundary predicate the executor actually runs. Two-tier:
 *   1. If `pane_current_command` matches the known-prompt allowlist (bash / zsh / … /
 *      claude), accept immediately — no shell-out.
 *   2. Else, if the command is version-shaped (`2.1.233` / `v1.2.3` / …), walk the
 *      pane's process tree once. Accept iff a `claude` process is present. This is the
 *      Claude Code 2.1.x case the run-01 fixture surfaced.
 *   3. Anything else — reject (busy).
 *
 * Tests inject `readDescendantComms` with a fixture list so the async check runs without
 * touching real `ps`. The production path uses `readDescendantCommsDefault`.
 */
export async function paneQualifiesAsPrompt(
  db: OpenedDb,
  paneRef: string,
  deps: {
    readDescendantComms?: (rootPid: number) => Promise<string[]>;
  } = {},
): Promise<boolean> {
  const command = readPaneCurrentCommand(db, paneRef);
  if (isPaneAtPrompt(command)) return true;
  if (!isVersionShapedCommand(command)) return false;
  const panePid = readPanePid(db, paneRef);
  if (panePid === null || panePid <= 0) return false;
  const probe = deps.readDescendantComms ?? readDescendantCommsDefault;
  const comms = await probe(panePid);
  return comms.some(commLooksLikeClaude);
}

/**
 * Wait up to `waitMs` for the pane to be at a prompt, polling every `pollMs`. Returns
 * true if the pane went to prompt within the window, false on timeout.
 *
 * GSL-390 — now delegates to `paneQualifiesAsPrompt` so version-shaped `pane_current_command`
 * values (real Claude Code sessions today) are honoured after a one-off process-tree probe.
 * The process-tree probe fires at most once per poll interval; caching is left to the
 * probe implementation (production `readDescendantCommsDefault` shells out on demand — the
 * whole check completes in a few ms; the extra ~15-20 shell-outs across a 5 s wait cap are
 * cheap compared to a submission's own tmux fan-out).
 *
 * The default clock is Date.now(); tests can inject a fake `now` to advance deterministically.
 */
export async function waitForPromptBoundary(
  db: OpenedDb,
  paneRef: string,
  opts: {
    waitMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    readDescendantComms?: (rootPid: number) => Promise<string[]>;
  } = {},
): Promise<boolean> {
  const waitMs = opts.waitMs ?? PROMPT_BOUNDARY_WAIT_MS;
  const pollMs = opts.pollMs ?? PROMPT_BOUNDARY_POLL_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)));
  const probe = opts.readDescendantComms;
  const started = now();
  // First check without sleeping — a receiver that's already at its prompt shouldn't add
  // even one poll interval of latency.
  if (await paneQualifiesAsPrompt(db, paneRef, { readDescendantComms: probe })) return true;
  while (now() - started < waitMs) {
    await sleep(pollMs);
    if (await paneQualifiesAsPrompt(db, paneRef, { readDescendantComms: probe })) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// preview + submit
// -----------------------------------------------------------------------------

export interface PreviewInput {
  session_id: string;
  body: string;
  framing?: SubmissionFraming;
}

export interface PreviewOutcome {
  ok: true;
  session_id: string;
  framing: SubmissionFraming;
  resolved_target: string | null;
  keystroke_bytes: string;
  body_len: number;
  body_sha256: string;
  warnings: SubmissionWarning[];
  /** ISO ts sampled at preview time. */
  previewed_at: string;
}

export interface PreviewRejection {
  ok: false;
  reason:
    | "body-invalid"
    | "session-not-controlled"
    | "shim-not-registered";
  message: string;
  httpStatus: 400 | 409;
}

/**
 * Compute a preview WITHOUT sending anything. Used both by the dry-run phase of the
 * submit-task endpoint and by the confirm phase (which re-computes the sha to sanity-check
 * the caller replayed the same body).
 *
 * Guards enforced here BEFORE any resolution:
 *   1. session_control state must be 'controlled' — R16.1 refusal (409, `session-not-controlled`).
 *   2. session_control.shim_registered must be true — R16.2 refusal (409, `shim-not-registered`).
 *   3. body must normalise + validate — R16.7 refusal (400, `body-invalid`).
 *
 * The resolved_target may be null (pane not yet in `tmux_panes` or already gone) — the panel
 * renders this as "pane pending, refresh to retry"; the confirm phase re-runs the resolve
 * and drops to `outcome='pane_gone'` when it's still null.
 */
export async function previewSubmission(
  db: OpenedDb,
  input: PreviewInput,
): Promise<PreviewOutcome | PreviewRejection> {
  const eff = readEffectiveState(db, input.session_id);
  if (eff.state !== "controlled") {
    return {
      ok: false,
      reason: "session-not-controlled",
      message: `session ${input.session_id} is not under panel control (state=${eff.state})`,
      httpStatus: 409,
    };
  }
  if (!eff.shim_registered) {
    return {
      ok: false,
      reason: "shim-not-registered",
      message: `session ${input.session_id} has no registered shim (R15.7)`,
      httpStatus: 409,
    };
  }
  const norm = normaliseAndValidateBody(input.body);
  if (!norm.ok) {
    return {
      ok: false,
      reason: "body-invalid",
      message: norm.error,
      httpStatus: 400,
    };
  }
  const framing: SubmissionFraming = input.framing ?? "prompt-boundary";
  const resolved = resolvePaneRef(db, input.session_id);
  const bytes = new TextEncoder().encode(norm.body);
  const sha = await computeBodySha256(norm.body);
  return {
    ok: true,
    session_id: input.session_id,
    framing,
    resolved_target: resolved,
    keystroke_bytes: norm.body,
    body_len: bytes.byteLength,
    body_sha256: sha,
    warnings: scanForSecretShapes(norm.body),
    previewed_at: new Date().toISOString(),
  };
}

export interface SubmitInput {
  session_id: string;
  body: string;
  framing?: SubmissionFraming;
}

export interface ExecutorOutcome {
  outcome: SubmissionOutcome;
  session_id: string;
  framing: SubmissionFraming;
  pane_ref_at_dispatch: string | null;
  body_len: number;
  body_sha256: string;
  error: string | null;
  /** Spawn traces for the two tmux calls; null on refusal paths that never reached the shell. */
  tmuxSendBody: SpawnResult | null;
  tmuxSendEnter: SpawnResult | null;
  ts: string;
}

/** Injection points for tests: swap the tmux spawn + prompt-boundary wait with fixtures. */
export interface SubmitDeps {
  spawn?: (args: string[], timeoutMs: number) => Promise<SpawnResult>;
  waitForPromptBoundary?: typeof waitForPromptBoundary;
  now?: () => Date;
}

/**
 * Confirm-phase executor. Re-runs every guard the preview ran, then the pane resolve,
 * then (per framing) the prompt-boundary wait, then two `tmux send-keys` calls.
 *
 * Refusal paths never touch `tmux`:
 *   - session-state re-check flips to non-controlled → `released_mid_submit` (F16-S6).
 *   - shim un-registered mid-submit → `released_mid_submit` (semantically same class).
 *   - body fails validation → thrown as a caller error; endpoint returns 400 (never reaches
 *     the DB `task_submissions` row).
 *   - pane_ref resolves to null → `pane_gone` (F16-S5).
 *   - framing='prompt-boundary' waited past ceiling → `not_at_prompt`.
 *
 * Delivery path:
 *   - `tmux send-keys -t <pane_ref> -l <body>` — literal-text mode.
 *   - `tmux send-keys -t <pane_ref> Enter` — a single Enter to submit.
 *   The two-call split is deliberate: `-l` never interprets its argument, so a trailing
 *   Enter must be a separate keystroke. Combining them in one call would require dropping
 *   `-l` and letting tmux parse the whole body as a mix of literal + key names — exactly
 *   the widening R16.9 forbids.
 */
export async function submitTask(
  db: OpenedDb,
  input: SubmitInput,
  deps: SubmitDeps = {},
): Promise<ExecutorOutcome> {
  const now = deps.now ?? (() => new Date());
  const framing: SubmissionFraming = input.framing ?? "prompt-boundary";

  // Guard 1: session state must still be 'controlled' + shim_registered — re-read fresh.
  const eff = readEffectiveState(db, input.session_id);
  const norm = normaliseAndValidateBody(input.body);
  if (!norm.ok) {
    // Body validation errors are the caller's fault; surface as a 400 upstream. Callers
    // should validate before calling submitTask, but guard the executor too — a 400 here
    // is preferable to a mysterious tmux failure.
    const err = new Error(norm.error) as Error & { httpStatus?: number };
    err.httpStatus = 400;
    throw err;
  }
  const bytes = new TextEncoder().encode(norm.body);
  const sha = await computeBodySha256(norm.body);

  if (eff.state !== "controlled" || !eff.shim_registered) {
    return {
      outcome: "released_mid_submit",
      session_id: input.session_id,
      framing,
      pane_ref_at_dispatch: null,
      body_len: bytes.byteLength,
      body_sha256: sha,
      error:
        eff.state !== "controlled"
          ? `session state=${eff.state} (not controlled)`
          : "shim not registered",
      tmuxSendBody: null,
      tmuxSendEnter: null,
      ts: now().toISOString(),
    };
  }

  // Guard 2: resolve the pane at dispatch time (never from request body — R16.4).
  const paneRef = resolvePaneRef(db, input.session_id);
  if (paneRef === null) {
    return {
      outcome: "pane_gone",
      session_id: input.session_id,
      framing,
      pane_ref_at_dispatch: null,
      body_len: bytes.byteLength,
      body_sha256: sha,
      error: "pane_ref resolves to null in tmux_panes at dispatch time",
      tmuxSendBody: null,
      tmuxSendEnter: null,
      ts: now().toISOString(),
    };
  }

  // Guard 3: framing='prompt-boundary' waits for a shell-shaped pane_current_command.
  if (framing === "prompt-boundary") {
    const waiter = deps.waitForPromptBoundary ?? waitForPromptBoundary;
    const arrived = await waiter(db, paneRef, {});
    if (!arrived) {
      return {
        outcome: "not_at_prompt",
        session_id: input.session_id,
        framing,
        pane_ref_at_dispatch: paneRef,
        body_len: bytes.byteLength,
        body_sha256: sha,
        error: `pane not at prompt after ${PROMPT_BOUNDARY_WAIT_MS} ms wait`,
        tmuxSendBody: null,
        tmuxSendEnter: null,
        ts: now().toISOString(),
      };
    }
  }

  // Dispatch. Two argv-array invocations, no shell. tmux send-keys -l treats its argument
  // as literal text; the trailing Enter is a separate key press so it registers as submit.
  const spawn = deps.spawn ?? ((args, timeoutMs) => spawnAwait({ cmd: args, timeoutMs }));

  const sendBody = await spawn(
    ["tmux", "send-keys", "-t", paneRef, "-l", norm.body],
    5_000,
  );
  if (!sendBody.ok) {
    return {
      outcome: "send_failed",
      session_id: input.session_id,
      framing,
      pane_ref_at_dispatch: paneRef,
      body_len: bytes.byteLength,
      body_sha256: sha,
      error: `tmux send-keys -l failed (rc=${sendBody.code ?? "null"}): ${sendBody.stderr || sendBody.stdout}`,
      tmuxSendBody: sendBody,
      tmuxSendEnter: null,
      ts: now().toISOString(),
    };
  }
  const sendEnter = await spawn(
    ["tmux", "send-keys", "-t", paneRef, "Enter"],
    5_000,
  );
  if (!sendEnter.ok) {
    // The body already landed in the pane. The Enter failure is genuinely partial — the
    // receiving Claude sees the body typed but never submitted. Surface as send_failed so
    // the drawer flags it and the owner can press Enter manually if needed.
    return {
      outcome: "send_failed",
      session_id: input.session_id,
      framing,
      pane_ref_at_dispatch: paneRef,
      body_len: bytes.byteLength,
      body_sha256: sha,
      error: `tmux send-keys Enter failed (rc=${sendEnter.code ?? "null"}): ${sendEnter.stderr || sendEnter.stdout}. Body already landed in pane.`,
      tmuxSendBody: sendBody,
      tmuxSendEnter: sendEnter,
      ts: now().toISOString(),
    };
  }
  return {
    outcome: "delivered",
    session_id: input.session_id,
    framing,
    pane_ref_at_dispatch: paneRef,
    body_len: bytes.byteLength,
    body_sha256: sha,
    error: null,
    tmuxSendBody: sendBody,
    tmuxSendEnter: sendEnter,
    ts: now().toISOString(),
  };
}
