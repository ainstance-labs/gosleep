// @gosleep/core — POST /actions/skills/publish spawner (T5, GSL-286 + GSL-266 partial).
//
// Bearer + Origin + Idempotency-Key already run at the route layer. This module owns the
// physical publish: spawn `tools/skills/publish.sh <name>` with a per-request GOSLEEP_WEB_TOKEN
// nonce, capture the JSON summary the CLI prints on stdout, propagate to the endpoint result.
//
// TouchID is WIRED (GSL-288) — publish.sh invokes `open -W -a apps/core/bin/touchid-gate.app`
// after its DB preflight and translates exit codes 0/1/2/3 into proceed / owner-refused /
// TTY-fallback / framework-error. The web-endpoint path always spawns publish.sh without a
// TTY, so a `2` (no sensor) on this host now refuses hard rather than silently proceeding.
// The exit-3 → HTTP 403 mapping below already carried the "owner refused" semantics; it now
// also fires when the physical-gesture gate refuses, not only under the old TTY-timeout path.
//
// Env passthroughs for hermetic smoke:
//   - GOSLEEP_SKILLS_PUBLISH_TIMEOUT_MS  bump the spawn ceiling from 60 000 ms.
//   - GOSLEEP_SKILLS_BACKUPS_DIR         divert backups out of the real repo tree.
//   - GOSLEEP_CHANGELOG_PATH             divert JSONL append.
//   - GOSLEEP_DB_PATH                    scratch DB (record-publish honors it).

import { randomBytes } from "node:crypto";

import { REPO_ROOT, spawnAwait } from "./spawn.ts";

/**
 * Names the CLI knows how to publish. Kept in sync with:
 *   - apps/core/scripts/record-publish.ts (KNOWN_SKILLS)
 *   - apps/core/src/skills/diff.ts       (KNOWN_SKILLS)
 *   - tools/skills/schema/changelog.schema.json  (properties.skill.enum)
 *   - skill/README.md                    (Owned skills table)
 * GSL-174 verifier run 02 M-1 widened 7 → 12 (adds the 5 orphan-rescued skills
 * that landed on main via GSL-334 Phase 0).
 */
const KNOWN_SKILLS = new Set<string>([
  "orchestrating-delivery-agents",
  "delivery-workflow",
  "handoff",
  "using-jira",
  "writing-prds",
  "remote-control",
  "tmux-agents-orchestration",
  "agentic-report-creator",
  "agentic-scenario-runner",
  "efficient-agent-evals",
  "extra-usage",
  "verifier-skeptic",
]);

export interface PublishInput {
  skill: string;
  lesson: string;
  task: string | null;
  intentId: string;
}

export interface PublishResult {
  skill: string;
  task: string;
  commit: string;
  backup: string;
  ts: string;
  intent_id: string;
  publishSpawn: {
    rc: number;
    elapsedMs: number;
    stdout: string;
    stderr: string;
  };
  /** Parsed JSON on the CLI's last stdout line (skills.publish.done event). Null if unparseable. */
  cliEvent: Record<string, unknown> | null;
}

/**
 * The endpoint-side helper used by /actions/skills/publish. Not exported as a top-level fn
 * on purpose — the endpoint route handles the mutex + withTimeline; this is the domain step.
 */
export async function performPublish(input: PublishInput): Promise<PublishResult> {
  const skill = input.skill;
  if (!KNOWN_SKILLS.has(skill)) {
    const err = new Error(`unknown skill: ${skill}`);
    (err as Error & { httpStatus?: number }).httpStatus = 400;
    throw err;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill)) {
    const err = new Error(`invalid skill name: ${skill}`);
    (err as Error & { httpStatus?: number }).httpStatus = 400;
    throw err;
  }

  const timeoutMs = Number.parseInt(process.env.GOSLEEP_SKILLS_PUBLISH_TIMEOUT_MS ?? "60000", 10) || 60_000;

  // Per-request random nonce, 32 hex chars (128 bits). publish.sh's env-nonce gate accepts
  // any value >= 16 chars — this is well above.
  const nonce = randomBytes(16).toString("hex");

  const cmd: string[] = [
    "bash",
    `${REPO_ROOT}/tools/skills/publish.sh`,
    skill,
    "--yes",
    "--lesson",
    input.lesson,
    "--intent-id",
    input.intentId,
  ];
  if (input.task !== null && input.task.length > 0) {
    cmd.push("--task", input.task);
  }

  // Env passthroughs for hermetic smoke; PATH/HOME auto-forwarded by spawnAwait.
  const env: Record<string, string> = { GOSLEEP_WEB_TOKEN: nonce };
  for (const key of [
    "GOSLEEP_SKILLS_BACKUPS_DIR",
    "GOSLEEP_CHANGELOG_PATH",
    "GOSLEEP_DB_PATH",
  ]) {
    const v = process.env[key];
    if (typeof v === "string" && v.length > 0) env[key] = v;
  }

  const spawn = await spawnAwait({ cmd, timeoutMs, env });
  if (!spawn.ok) {
    const reason = spawn.timedOut
      ? `publish.sh timed out after ${spawn.elapsedMs} ms`
      : `publish.sh exited rc=${spawn.code ?? "null"} (${spawn.elapsedMs} ms). stderr tail: ${spawn.stderr.slice(-500)}`;
    // Distinguish owner-gate refusal (exit 3) from mid-flow failure (exit 1) so the HTTP status
    // can be nuanced — 403-shaped for a refusal (still 500-safe as a fallback), 500 otherwise.
    const httpStatus = spawn.code === 3 ? 403 : spawn.code === 2 ? 400 : 500;
    const err = new Error(reason);
    (err as Error & { httpStatus?: number }).httpStatus = httpStatus;
    throw err;
  }

  // Parse the last non-empty stdout line as the {"event":"skills.publish.done"} JSON.
  let cliEvent: Record<string, unknown> | null = null;
  const lines = spawn.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && (parsed as { event?: string }).event === "skills.publish.done") {
        cliEvent = parsed as Record<string, unknown>;
        break;
      }
    } catch {
      /* try earlier line */
    }
  }

  const strOr = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
  const skillOut = strOr(cliEvent?.skill, skill);
  const taskOut = strOr(cliEvent?.task, input.task ?? "GSL-174");
  const commit = strOr(cliEvent?.commit, "0000000000000000000000000000000000000000");
  const backup = strOr(cliEvent?.backup, "");
  const ts = strOr(cliEvent?.ts, new Date().toISOString());

  return {
    skill: skillOut,
    task: taskOut,
    commit,
    backup,
    ts,
    intent_id: input.intentId,
    publishSpawn: {
      rc: spawn.code ?? -1,
      elapsedMs: spawn.elapsedMs,
      stdout: spawn.stdout,
      stderr: spawn.stderr,
    },
    cliEvent,
  };
}

export { KNOWN_SKILLS };
