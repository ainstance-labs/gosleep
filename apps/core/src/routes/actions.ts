// @gosleep/core — POST /actions/* write endpoints (GSL-268, extended GSL-277 + GSL-278 + GSL-279
// + GSL-298).
//
// Eight v1 write endpoints per target-architecture rev-2 section 6.2 + rev-3 addendum:
//
//   POST /actions/questions/answer          { qid, answer, by?, channel? }             GSL-268
//   POST /actions/questions/resolve         { qid, applied, early? }                   GSL-268
//   POST /actions/questions/apply-manifest  { qid, rule_ref, answer? }                 GSL-277
//   POST /actions/questions/defer           { qid, defer_until? }                      GSL-278
//   POST /actions/tasks/sync                { epic? }                                  GSL-279
//   POST /actions/tick                      {}                              (fire-and-forget)
//   POST /actions/events/ack                { seq, note? }
//   POST /actions/snapshot                  { label? }                                 GSL-298
//   POST /actions/skills/publish            { skill, lesson?, task? }                  T5 GSL-286
//
// Every request goes through THREE layers, in order (any layer rejection short-circuits with a
// proper HTTP status; the ledger only records requests that reached the mutation):
//
//   1. requireBearer (already on every non-healthz route) — auth.
//   2. serialize(endpoint, ...)    — per-endpoint mutex; second POST to the same endpoint
//                                     waits behind the first. Different endpoints run in
//                                     parallel unless they collide in the shell tools' own
//                                     mkdir lock (queue.jsonl).
//   3. withTimeline(...)           — server_intents ledger + persistent Idempotency-Key.
//                                     A replayed Idempotency-Key returns the ORIGINAL response
//                                     without re-running the tool.
//
// Answer contract (GSL-274 verdict PASS on `allow`+`updatedInput`):
//   - The answer is recorded in SQLite with `actor='owner-web'` (or the caller-supplied `by`)
//     BEFORE it reaches the agent. Provenance therefore lives in the DB, NOT in the transcript
//     (as GSL-274 findings §1 explicitly named — the transcript cannot tell an injected answer
//     from a human TUI pick). GSL-275 owns the shim + long-poll endpoints that then deliver
//     this row to the asking agent via `allow`+`updatedInput`.
//
// Dual-write during the transition (target-arch 6.2 table):
//   - Spawn `tools/lab/lab-emit.sh <verb>` for the JSONL side (queue.jsonl + events/*.jsonl).
//   - Direct UPDATE on the `questions` row for immediate DB consistency (the tail indexer's
//     re-fold is idempotent so a second pass over the JSONL converges to the same state).
//
// TouchID is NOT required for these writes (low blast; target-arch section 7 "Приоритет 3").
// Bearer + Origin + Idempotency-Key are the enforced layer for this task's four endpoints.

import { Hono } from "hono";
import type { Context } from "hono";

import { requireBearer } from "../security/bearer.ts";
import { getDb } from "../db/client.ts";
import { serialize } from "../actions/mutex.ts";
import { resolveIntentId, withTimeline } from "../actions/withTimeline.ts";
import { spawnAwait, spawnDetached, REPO_ROOT } from "../actions/spawn.ts";
import { performPublish, type PublishResult } from "../actions/publish.ts";
import { getSessionAdapter } from "../adapter/session.ts";
import { loadManifest, type ManifestRule } from "../manifest/parser.ts";
import { runSyncCycle, type JiraSyncChangeSummary } from "../workers/jira-sync.ts";
import { broadcaster } from "../sse/broadcaster.ts";

export const actionsRoutes = new Hono();

// -----------------------------------------------------------------------------
// small typed helpers
// -----------------------------------------------------------------------------

/** Common body-parse guard: 400 with a short reason when the JSON is malformed. */
async function parseJsonBody(c: Context): Promise<
  Record<string, unknown> | { __error: string }
> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType !== "" && !contentType.toLowerCase().includes("application/json")) {
    return { __error: "content-type must be application/json" };
  }
  try {
    const raw = await c.req.text();
    if (raw.length === 0) return {};
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { __error: "body must be a JSON object" };
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    return { __error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numberField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function nowIso(): string {
  return new Date().toISOString();
}

// -----------------------------------------------------------------------------
// action-specific mutations
// -----------------------------------------------------------------------------

interface AnswerInput {
  qid: string;
  answer: string;
  by: string;
  channel: string;
}

interface AnswerResult {
  qid: string;
  status: "answered";
  answered_at: string;
  answered_by: string;
  channel: string;
  labEmit: { rc: number; stdout: string; stderr: string; elapsedMs: number };
}

async function doAnswer(input: AnswerInput): Promise<AnswerResult> {
  const db = getDb();
  // Guard: refuse an answer against a non-open question. This is the exact check the target-arch
  // rev-2 section 6.2 red-team finding 11 asked for — lab-emit.sh's `_patch` does NOT enforce
  // status before appending; the endpoint layer must.
  const row = db.raw
    .query("SELECT qid, status FROM questions WHERE qid = ?")
    .get(input.qid) as { qid: string; status: string } | null;
  if (row === null || row === undefined) {
    const err = new Error(`question not found: ${input.qid}`);
    (err as Error & { httpStatus?: number }).httpStatus = 404;
    throw err;
  }
  if (row.status !== "open") {
    const err = new Error(`question ${input.qid} is not open (status=${row.status})`);
    (err as Error & { httpStatus?: number }).httpStatus = 409;
    throw err;
  }

  // Dual-write step 1: spawn lab-emit.sh answer — the JSONL side (queue.jsonl patch + events).
  // Fail-closed: if the shell tool returns non-zero the whole action fails and the ledger row
  // records the error. Direct UPDATE below only runs on shell success.
  const answered_at = nowIso();
  const emit = await spawnAwait({
    cmd: [
      "bash",
      `${REPO_ROOT}/tools/lab/lab-emit.sh`,
      "answer",
      "--re",
      input.qid,
      "--answer",
      input.answer,
      "--by",
      input.by,
      "--channel",
      input.channel,
    ],
    timeoutMs: 10_000,
  });
  if (!emit.ok) {
    throw new Error(
      `lab-emit answer failed (rc=${emit.code ?? "null"}, timedOut=${emit.timedOut}): ${emit.stderr || emit.stdout}`,
    );
  }

  // Dual-write step 2: direct UPDATE on questions for immediate consistency. The UPDATE is
  // guarded by (status='open') at the SQL level too so a race the mutex missed still fails
  // safely. rowsAffected==0 means the guard fired between our SELECT and our UPDATE.
  const upd = db.raw
    .query(
      `UPDATE questions
       SET status = 'answered', answer_text = ?, answered_at = ?
       WHERE qid = ? AND status = 'open'`,
    )
    .run(input.answer, answered_at, input.qid);
  if (upd.changes === 0) {
    // The JSONL side already recorded the answer (lab-emit doesn't check status); a subsequent
    // tail re-fold will pick that up. But the endpoint's contract is "immediate DB write", so
    // fail loudly rather than lie about consistency.
    throw new Error(
      `race: question ${input.qid} changed status between the guard and the UPDATE`,
    );
  }

  // GSL-275: wake any long-poll waiter for this qid the instant the row flips. NOT reached via
  // the SSE broadcaster (that path fires later, after the tail indexer re-reads the JSONL); the
  // adapter's in-process delivery fires within the same await frame so the hook shim releases
  // in ~milliseconds. GSL-281 seam: the SessionAdapter chooses HOW the answer reaches the
  // paused session (today: in-process notifier; a Codex-style adapter would POST HTTP instead).
  getSessionAdapter().deliverAnswer({
    qid: input.qid,
    status: "answered",
    answer_text: input.answer,
    answered_at,
    answered_by: input.by,
  });

  return {
    qid: input.qid,
    status: "answered",
    answered_at,
    answered_by: input.by,
    channel: input.channel,
    labEmit: {
      rc: emit.code ?? -1,
      stdout: emit.stdout,
      stderr: emit.stderr,
      elapsedMs: emit.elapsedMs,
    },
  };
}

interface ResolveInput {
  qid: string;
  applied: string;
  early: boolean;
}

interface ResolveResult {
  qid: string;
  status: "resolved" | "auto-resolved" | "answered-by-default";
  resolved_at: string;
  applied: string;
  labEmit: { rc: number; stdout: string; stderr: string; elapsedMs: number };
}

async function doResolve(input: ResolveInput): Promise<ResolveResult> {
  const db = getDb();
  const row = db.raw
    .query("SELECT qid, status FROM questions WHERE qid = ?")
    .get(input.qid) as { qid: string; status: string } | null;
  if (row === null || row === undefined) {
    const err = new Error(`question not found: ${input.qid}`);
    (err as Error & { httpStatus?: number }).httpStatus = 404;
    throw err;
  }
  if (row.status !== "open" && row.status !== "answered") {
    const err = new Error(`question ${input.qid} cannot be resolved (status=${row.status})`);
    (err as Error & { httpStatus?: number }).httpStatus = 409;
    throw err;
  }

  const emitArgs = [
    "bash",
    `${REPO_ROOT}/tools/lab/lab-emit.sh`,
    "resolve",
    "--re",
    input.qid,
    "--applied",
    input.applied,
  ];
  if (input.early) emitArgs.push("--early");

  const emit = await spawnAwait({ cmd: emitArgs, timeoutMs: 10_000 });
  if (!emit.ok) {
    throw new Error(
      `lab-emit resolve failed (rc=${emit.code ?? "null"}, timedOut=${emit.timedOut}): ${emit.stderr || emit.stdout}`,
    );
  }

  // lab-emit.sh resolve prints `<status> <qid>` to stdout. Reuse its status verbatim — it
  // already applied the manifest §2 deadline logic (auto-resolved vs answered-by-default) so
  // we should not re-derive it here.
  const parts = emit.stdout.split(/\s+/);
  const derivedStatus = (parts[0] ?? "resolved") as ResolveResult["status"];
  const resolved_at = nowIso();

  db.raw
    .query(
      `UPDATE questions
       SET status = ?, resolved_at = ?, applied = ?
       WHERE qid = ?`,
    )
    .run(derivedStatus, resolved_at, input.applied, input.qid);

  // GSL-275: also wake long-poll waiters on resolve — a manifest auto-resolve or an early-default
  // is a terminal answer from the agent's perspective, and the hook should release rather than
  // sit until timeout. The wait's TERMINAL set treats these statuses as answered-equivalent.
  // GSL-281 seam: routed via SessionAdapter.deliverAnswer.
  getSessionAdapter().deliverAnswer({
    qid: input.qid,
    status: derivedStatus,
    answer_text: input.applied,
    answered_at: resolved_at,
    answered_by: "manifest",
  });

  return {
    qid: input.qid,
    status: derivedStatus,
    resolved_at,
    applied: input.applied,
    labEmit: {
      rc: emit.code ?? -1,
      stdout: emit.stdout,
      stderr: emit.stderr,
      elapsedMs: emit.elapsedMs,
    },
  };
}

// -----------------------------------------------------------------------------
// GSL-277 — apply-manifest: owner picks a manifest rule, provenance columns record it
// -----------------------------------------------------------------------------

interface ApplyManifestInput {
  qid: string;
  rule_ref: string;
  answer: string | null;
  by: string;
}

interface ApplyManifestResult {
  qid: string;
  status: "answered";
  applied_by: "manifest";
  applied_rule_ref: string;
  answered_at: string;
  answer_text: string;
  rule: {
    id: string;
    section: number;
    bullet: string;
    section_title: string;
    body: string;
  };
  labEmit: { rc: number; stdout: string; stderr: string; elapsedMs: number };
  labDecision: { rc: number; stdout: string; stderr: string; elapsedMs: number };
}

async function doApplyManifest(input: ApplyManifestInput): Promise<ApplyManifestResult> {
  const db = getDb();
  // Guard 1: question must exist and be open. Same shape as doAnswer — a manifest apply is
  // semantically an answer with provenance, so status transitions match.
  const row = db.raw
    .query("SELECT qid, status, task FROM questions WHERE qid = ?")
    .get(input.qid) as { qid: string; status: string; task: string | null } | null;
  if (row === null || row === undefined) {
    const err = new Error(`question not found: ${input.qid}`);
    (err as Error & { httpStatus?: number }).httpStatus = 404;
    throw err;
  }
  if (row.status !== "open") {
    const err = new Error(`question ${input.qid} is not open (status=${row.status})`);
    (err as Error & { httpStatus?: number }).httpStatus = 409;
    throw err;
  }

  // Guard 2: rule_ref must resolve against the currently-parsed manifest. The manifest is
  // read fresh on every apply — the owner may have edited it since core booted, and the whole
  // point of provenance is to cite what the manifest SAYS today, not what it said at boot.
  let rule: ManifestRule | undefined;
  try {
    const manifest = loadManifest();
    rule = manifest.index.get(input.rule_ref);
  } catch (err) {
    // Manifest missing / unreadable is a 500-shaped failure — the owner can't apply a rule
    // when we cannot read the file. The error message names the file so operator sees it.
    const wrapped = new Error(
      `manifest read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    (wrapped as Error & { httpStatus?: number }).httpStatus = 500;
    throw wrapped;
  }
  if (rule === undefined) {
    const err = new Error(
      `unknown rule_ref: ${input.rule_ref} (expected canonical form "manifest §N.bullet-key")`,
    );
    (err as Error & { httpStatus?: number }).httpStatus = 400;
    throw err;
  }

  // The effective answer text: caller-supplied wins, otherwise fall back to the rule body.
  // Rule bodies are already terse ("§2.merge-strategy — regular merge, never squash") so the
  // fallback is meaningful without needing summarisation.
  const answer_text = input.answer ?? rule.body;

  // Dual-write step 1: mirror to the JSONL queue via `lab-emit answer --by manifest`.
  // This makes the answered_by field on the queue record read `"manifest"` and lets the fold
  // converge to `applied_by='manifest'` on the next tail sweep even if the direct UPDATE were
  // to fail. Provenance is thus recorded in TWO places (JSONL + DB) so a re-fold is idempotent.
  const answered_at = nowIso();
  const emit = await spawnAwait({
    cmd: [
      "bash",
      `${REPO_ROOT}/tools/lab/lab-emit.sh`,
      "answer",
      "--re",
      input.qid,
      "--answer",
      answer_text,
      "--by",
      "manifest",
      "--channel",
      "manifest",
    ],
    timeoutMs: 10_000,
  });
  if (!emit.ok) {
    throw new Error(
      `lab-emit answer failed (rc=${emit.code ?? "null"}, timedOut=${emit.timedOut}): ${emit.stderr || emit.stdout}`,
    );
  }

  // Dual-write step 2: append a decision-log entry via `lab-emit decision --rule`. This is
  // separate from the queue write because decisions/log.jsonl is its own append-only ledger
  // (`docs/lab/decisions/log.jsonl`) — the manifest rule is the "authority" the orchestrator
  // is citing, so the decision layer needs its own row with `made_by='orchestrator'` and
  // `rule='manifest §N.bullet'`. This is exactly what the manifest's own preamble asks for
  // (F3-S3 provenance: "Каждое автономное решение обязано цитировать пункт манифеста").
  const decision = await spawnAwait({
    cmd: [
      "bash",
      `${REPO_ROOT}/tools/lab/lab-emit.sh`,
      "decision",
      "--re",
      input.qid,
      "--decision",
      answer_text,
      "--rule",
      rule.id,
      "--by",
      input.by,
      "--channel",
      "web",
    ],
    timeoutMs: 10_000,
  });
  if (!decision.ok) {
    // Not fatal — the queue side already carries the answer. Log loudly (the caller will see
    // the labDecision block below) but do NOT throw: we don't want a decision-log hiccup to
    // roll back an already-answered question.
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        ts: nowIso(),
        event: "core.action.apply_manifest.decision_log_warn",
        qid: input.qid,
        rc: decision.code,
        stderr: decision.stderr,
      }),
    );
  }

  // Dual-write step 3: the direct SQLite UPDATE. Provenance columns land here — the projection
  // layer surfaces them on `/questions` and `/bundle.questions`.
  const upd = db.raw
    .query(
      `UPDATE questions
         SET status = 'answered',
             answer_text = ?,
             answered_at = ?,
             applied_by = 'manifest',
             applied_rule_ref = ?
       WHERE qid = ? AND status = 'open'`,
    )
    .run(answer_text, answered_at, rule.id, input.qid);
  if (upd.changes === 0) {
    throw new Error(
      `race: question ${input.qid} changed status between the guard and the UPDATE`,
    );
  }

  // Wake long-poll waiters — same reasoning as doAnswer. The agent's PreToolUse hook releases
  // in ~ms; the SSE fan-out lags this by a tail-indexer sweep, so both paths converge.
  // GSL-281 seam: routed via SessionAdapter.deliverAnswer.
  getSessionAdapter().deliverAnswer({
    qid: input.qid,
    status: "answered",
    answer_text,
    answered_at,
    answered_by: "manifest",
  });

  return {
    qid: input.qid,
    status: "answered",
    applied_by: "manifest",
    applied_rule_ref: rule.id,
    answered_at,
    answer_text,
    rule: {
      id: rule.id,
      section: rule.section,
      bullet: rule.bullet,
      section_title: rule.section_title,
      body: rule.body,
    },
    labEmit: {
      rc: emit.code ?? -1,
      stdout: emit.stdout,
      stderr: emit.stderr,
      elapsedMs: emit.elapsedMs,
    },
    labDecision: {
      rc: decision.code ?? -1,
      stdout: decision.stdout,
      stderr: decision.stderr,
      elapsedMs: decision.elapsedMs,
    },
  };
}

// -----------------------------------------------------------------------------
// GSL-278 — defer: "not now, ask me later" + optional auto-reopen timestamp
// -----------------------------------------------------------------------------

interface DeferInput {
  qid: string;
  defer_until: string | null;
  by: string;
}

interface DeferResult {
  qid: string;
  status: "deferred";
  defer_until: string | null;
  deferred_at: string;
  labEmit: { rc: number; stdout: string; stderr: string; elapsedMs: number };
}

/** Minimal ISO-8601 validation — accepts a `YYYY-MM-DDTHH:MM:SS(.sss)Z` shape or `YYYY-MM-DD`.
 *  We do NOT try to be exhaustive — the auto-reopen worker compares strings, so any value
 *  that parses through `new Date()` and round-trips is safe. Refusing empty strings here would
 *  break the "no timer" case; the endpoint layer treats `null` as "no timer" explicitly. */
export function isValidIsoLike(s: string): boolean {
  if (s.length === 0) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  // Guard the string shape too: something like `"future"` parses on some runtimes and we do
  // NOT want that on the wire. Require the string to start with a 4-digit year.
  return /^\d{4}-\d{2}/.test(s);
}

async function doDefer(input: DeferInput): Promise<DeferResult> {
  const db = getDb();
  const row = db.raw
    .query("SELECT qid, status FROM questions WHERE qid = ?")
    .get(input.qid) as { qid: string; status: string } | null;
  if (row === null || row === undefined) {
    const err = new Error(`question not found: ${input.qid}`);
    (err as Error & { httpStatus?: number }).httpStatus = 404;
    throw err;
  }
  if (row.status !== "open" && row.status !== "answered") {
    const err = new Error(
      `question ${input.qid} cannot be deferred (status=${row.status}) — only open|answered may be deferred`,
    );
    (err as Error & { httpStatus?: number }).httpStatus = 409;
    throw err;
  }

  // Dual-write step 1: lab-emit defer patch (JSONL side). Passing the empty string here signals
  // "no timer" — matches the CLI contract, which distinguishes `--defer-until ""` from an unset
  // flag by treating both the same ("no timer"). The reversible-null form on the wire (`null`)
  // is normalised here.
  const emitArgs = [
    "bash",
    `${REPO_ROOT}/tools/lab/lab-emit.sh`,
    "defer",
    "--re",
    input.qid,
    "--by",
    input.by,
  ];
  if (input.defer_until !== null) {
    emitArgs.push("--defer-until", input.defer_until);
  }
  const emit = await spawnAwait({ cmd: emitArgs, timeoutMs: 10_000 });
  if (!emit.ok) {
    throw new Error(
      `lab-emit defer failed (rc=${emit.code ?? "null"}, timedOut=${emit.timedOut}): ${emit.stderr || emit.stdout}`,
    );
  }

  // Dual-write step 2: direct UPDATE for immediate consistency. `defer_until` is nullable —
  // when absent, the row shows `status='deferred'` with no timer and the auto-reopen worker
  // skips it (worker filters on `defer_until IS NOT NULL AND defer_until <= now`).
  const deferred_at = nowIso();
  const upd = db.raw
    .query(
      `UPDATE questions
         SET status = 'deferred', defer_until = ?
       WHERE qid = ? AND status IN ('open', 'answered')`,
    )
    .run(input.defer_until, input.qid);
  if (upd.changes === 0) {
    throw new Error(
      `race: question ${input.qid} changed status between the guard and the UPDATE`,
    );
  }

  // Note: no `sessionAdapter.deliverAnswer` here. IMPORTANT — per Jira scope, deferring must NOT
  // deliver anything back to the asking agent's PreToolUse long-poll; that hook keeps waiting
  // for a real answer. Waking it now with `status='deferred'` would leak "deferred" to the
  // agent as if it were an answer and break the semantic contract.

  return {
    qid: input.qid,
    status: "deferred",
    defer_until: input.defer_until,
    deferred_at,
    labEmit: {
      rc: emit.code ?? -1,
      stdout: emit.stdout,
      stderr: emit.stderr,
      elapsedMs: emit.elapsedMs,
    },
  };
}

interface AckInput {
  seq: number;
  note: string | null;
  by: string;
}

interface AckResult {
  ack_of_seq: number;
  actor: string;
  note: string | null;
  labLog: { rc: number; stdout: string; stderr: string; elapsedMs: number };
}

async function doAck(input: AckInput): Promise<AckResult> {
  const db = getDb();
  // Guard: the ack must target an existing events row so a typo does not silently succeed.
  const evt = db.raw
    .query("SELECT seq, type FROM events WHERE seq = ?")
    .get(input.seq) as { seq: number; type: string } | null;
  if (evt === null || evt === undefined) {
    const err = new Error(`no event with seq=${input.seq}`);
    (err as Error & { httpStatus?: number }).httpStatus = 404;
    throw err;
  }

  const dataJson = JSON.stringify({
    ack_of_seq: input.seq,
    ack_of_type: evt.type,
    note: input.note,
  });
  const emit = await spawnAwait({
    cmd: [
      "bash",
      `${REPO_ROOT}/tools/lab/lab-log.sh`,
      "--type",
      "ack",
      "--actor",
      input.by,
      "--src",
      "emit",
      "--data-json",
      dataJson,
    ],
    timeoutMs: 5_000,
  });
  if (!emit.ok) {
    throw new Error(
      `lab-log ack failed (rc=${emit.code ?? "null"}, timedOut=${emit.timedOut}): ${emit.stderr || emit.stdout}`,
    );
  }
  return {
    ack_of_seq: input.seq,
    actor: input.by,
    note: input.note,
    labLog: {
      rc: emit.code ?? -1,
      stdout: emit.stdout,
      stderr: emit.stderr,
      elapsedMs: emit.elapsedMs,
    },
  };
}

interface TickResult {
  spawned: true;
  carrier: string;
  note: string;
}

/**
 * Tick spawns the full chronicler+poll-fill+ledger flow (`tools/lab/tick.sh --force`). That's a
 * multi-second operation with its own ledger writer; we fire-and-forget so the HTTP response
 * returns quickly. The tick's own ledger event lands in supervision/tick-ledger.jsonl and its
 * child events lift onto the SSE stream via the tail indexer.
 */
function doTick(input: { carrier: string }): TickResult {
  spawnDetached({
    cmd: [
      "bash",
      `${REPO_ROOT}/tools/lab/tick.sh`,
      "--force",
      "--carrier",
      input.carrier,
    ],
    timeoutMs: 120_000,
  });
  return {
    spawned: true,
    carrier: input.carrier,
    note: "tick spawned; its own ledger + timeline events arrive via SSE",
  };
}

// -----------------------------------------------------------------------------
// route wiring — every POST goes through parseJsonBody → serialize → withTimeline
// -----------------------------------------------------------------------------

function httpStatusFromError(err: unknown): 400 | 403 | 404 | 409 | 500 {
  if (err instanceof Error) {
    const status = (err as Error & { httpStatus?: number }).httpStatus;
    if (status === 400 || status === 403 || status === 404 || status === 409 || status === 500) {
      return status;
    }
  }
  return 500;
}

// -----------------------------------------------------------------------------
// POST /actions/questions/answer
// -----------------------------------------------------------------------------

actionsRoutes.post("/actions/questions/answer", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const qid = stringField(body, "qid");
  const answer = stringField(body, "answer");
  if (qid === null) return c.json({ ok: false, error: "qid required" }, 400);
  if (answer === null) return c.json({ ok: false, error: "answer required" }, 400);
  const by = stringField(body, "by") ?? "owner-web";
  const channel = stringField(body, "channel") ?? "web";
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.questions.answer", async () =>
      withTimeline<AnswerResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/questions/answer",
          input: { qid, answer, by, channel },
        },
        () => doAnswer({ qid, answer, by, channel }),
      ),
    );
    if (outcome.cached && !outcome.ok) {
      return c.json(
        { ok: false, intent_id: outcome.intentId, error: outcome.error, cached: true },
        409,
      );
    }
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    // Only log unexpected 5xx to stderr — expected 4xx (bad qid, missing field) are ordinary
    // user-input rejections and would spam the audit log if surfaced.
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});

// -----------------------------------------------------------------------------
// POST /actions/questions/resolve
// -----------------------------------------------------------------------------

actionsRoutes.post("/actions/questions/resolve", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const qid = stringField(body, "qid");
  const applied = stringField(body, "applied");
  if (qid === null) return c.json({ ok: false, error: "qid required" }, 400);
  if (applied === null) return c.json({ ok: false, error: "applied required" }, 400);
  const early = body.early === true;
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.questions.resolve", async () =>
      withTimeline<ResolveResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/questions/resolve",
          input: { qid, applied, early },
        },
        () => doResolve({ qid, applied, early }),
      ),
    );
    if (outcome.cached && !outcome.ok) {
      return c.json(
        { ok: false, intent_id: outcome.intentId, error: outcome.error, cached: true },
        409,
      );
    }
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    // Only log unexpected 5xx to stderr — expected 4xx (bad qid, missing field) are ordinary
    // user-input rejections and would spam the audit log if surfaced.
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});

// -----------------------------------------------------------------------------
// POST /actions/questions/apply-manifest (GSL-277)
// -----------------------------------------------------------------------------

actionsRoutes.post("/actions/questions/apply-manifest", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const qid = stringField(body, "qid");
  const rule_ref = stringField(body, "rule_ref");
  if (qid === null) return c.json({ ok: false, error: "qid required" }, 400);
  if (rule_ref === null) return c.json({ ok: false, error: "rule_ref required" }, 400);
  const answer = stringField(body, "answer");
  const by = stringField(body, "by") ?? "owner-web";
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.questions.apply-manifest", async () =>
      withTimeline<ApplyManifestResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/questions/apply-manifest",
          input: { qid, rule_ref, answer, by },
        },
        () => doApplyManifest({ qid, rule_ref, answer, by }),
      ),
    );
    if (outcome.cached && !outcome.ok) {
      return c.json(
        { ok: false, intent_id: outcome.intentId, error: outcome.error, cached: true },
        409,
      );
    }
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});

// -----------------------------------------------------------------------------
// POST /actions/questions/defer (GSL-278)
// -----------------------------------------------------------------------------

actionsRoutes.post("/actions/questions/defer", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const qid = stringField(body, "qid");
  if (qid === null) return c.json({ ok: false, error: "qid required" }, 400);
  // defer_until is OPTIONAL — treat both "missing" and "explicit null" as "no timer".
  // Reject an invalid ISO shape here (before ever touching the ledger) so the client sees a
  // clean 400 instead of a 500 from the shell tool.
  const rawUntil = body.defer_until;
  let defer_until: string | null = null;
  if (typeof rawUntil === "string" && rawUntil.length > 0) {
    if (!isValidIsoLike(rawUntil)) {
      return c.json({ ok: false, error: "defer_until must be ISO-8601 (YYYY-MM-DDT…Z)" }, 400);
    }
    defer_until = rawUntil;
  } else if (rawUntil !== null && rawUntil !== undefined) {
    return c.json({ ok: false, error: "defer_until must be a string or null" }, 400);
  }
  const by = stringField(body, "by") ?? "owner-web";
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.questions.defer", async () =>
      withTimeline<DeferResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/questions/defer",
          input: { qid, defer_until, by },
        },
        () => doDefer({ qid, defer_until, by }),
      ),
    );
    if (outcome.cached && !outcome.ok) {
      return c.json(
        { ok: false, intent_id: outcome.intentId, error: outcome.error, cached: true },
        409,
      );
    }
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});

// -----------------------------------------------------------------------------
// POST /actions/tick — fire-and-forget
// -----------------------------------------------------------------------------

actionsRoutes.post("/actions/tick", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const carrier = stringField(body, "carrier") ?? "web";
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.tick", async () =>
      withTimeline<TickResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/tick",
          input: { carrier },
        },
        async () => doTick({ carrier }),
      ),
    );
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    // Only log unexpected 5xx to stderr — expected 4xx (bad qid, missing field) are ordinary
    // user-input rejections and would spam the audit log if surfaced.
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});

// -----------------------------------------------------------------------------
// POST /actions/tasks/sync (GSL-279)
//
// On-demand Jira reconciler tick. Runs ONE sync cycle synchronously and returns the change
// summary — the caller waits (≤ ~3 s typical). Optional `epic` scopes the JQL to a single
// epic subtree; omitted → full sync.
// -----------------------------------------------------------------------------

interface SyncTasksInput {
  epic: string | null;
}

interface SyncTasksResult extends JiraSyncChangeSummary {
  epic: string | null;
}

async function doSyncTasks(input: SyncTasksInput): Promise<SyncTasksResult> {
  const summary = await runSyncCycle(
    getDb(),
    input.epic !== null ? { epic: input.epic } : {},
  );
  return { ...summary, epic: input.epic };
}

actionsRoutes.post("/actions/tasks/sync", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const rawEpic = body.epic;
  let epic: string | null = null;
  if (typeof rawEpic === "string" && rawEpic.length > 0) {
    if (!/^GSL-\d+$/.test(rawEpic)) {
      return c.json({ ok: false, error: "epic must match /^GSL-\\d+$/" }, 400);
    }
    epic = rawEpic;
  } else if (rawEpic !== null && rawEpic !== undefined) {
    return c.json({ ok: false, error: "epic must be a string or null" }, 400);
  }
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.tasks.sync", async () =>
      withTimeline<SyncTasksResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/tasks/sync",
          input: { epic },
        },
        () => doSyncTasks({ epic }),
      ),
    );
    if (outcome.cached && !outcome.ok) {
      return c.json(
        { ok: false, intent_id: outcome.intentId, error: outcome.error, cached: true },
        409,
      );
    }
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});

// -----------------------------------------------------------------------------
// GSL-284 — POST /actions/permissions/decide
//
// Owner-facing decision for a permission-kind question row (kind='permission', opened by
// `POST /internal/permissions/post`). Symmetric with `doAnswer` for AskUserQuestion, with
// three differences:
//
//   1. Guard on kind — only permission rows may go through here. Sending a BLOCKER qid
//      returns 409 so the write endpoint stays strictly typed to its payload.
//   2. `answer_text` is constrained to the {"allow", "deny"} pair. Anything else → 400.
//   3. Optional `updated_message` becomes the deny-path `permissionDecisionReason`. Stored
//      in the `applied` column (semantically: "what was applied when the row closed") so
//      the shim's `GET /internal/questions/:qid/answer-wait` reads it back from a single
//      row without a schema addition.
//
// Provenance always lands as `applied_by='owner'` on this v1 slice — no manifest auto-
// approve/deny yet (called out in the Jira non-goals).
// -----------------------------------------------------------------------------

interface DecidePermissionInput {
  qid: string;
  decision: "allow" | "deny";
  updated_message: string | null;
  by: string;
}

interface DecidePermissionResult {
  qid: string;
  status: "answered";
  decision: "allow" | "deny";
  answered_at: string;
  answered_by: string;
  applied_by: "owner";
  updated_message: string | null;
}

async function doDecidePermission(
  input: DecidePermissionInput,
): Promise<DecidePermissionResult> {
  const db = getDb();
  const row = db.raw
    .query("SELECT qid, status, kind FROM questions WHERE qid = ?")
    .get(input.qid) as { qid: string; status: string; kind: string } | null;
  if (row === null || row === undefined) {
    const err = new Error(`permission question not found: ${input.qid}`);
    (err as Error & { httpStatus?: number }).httpStatus = 404;
    throw err;
  }
  if (row.kind !== "permission") {
    const err = new Error(
      `qid ${input.qid} is not a permission question (kind=${row.kind}) — use /actions/questions/answer instead`,
    );
    (err as Error & { httpStatus?: number }).httpStatus = 409;
    throw err;
  }
  if (row.status !== "open") {
    const err = new Error(
      `permission question ${input.qid} is not open (status=${row.status})`,
    );
    (err as Error & { httpStatus?: number }).httpStatus = 409;
    throw err;
  }

  const answered_at = nowIso();
  const upd = db.raw
    .query(
      `UPDATE questions
         SET status = 'answered',
             answer_text = ?,
             answered_at = ?,
             applied_by = 'owner',
             applied = ?
       WHERE qid = ? AND status = 'open' AND kind = 'permission'`,
    )
    .run(input.decision, answered_at, input.updated_message, input.qid);
  if (upd.changes === 0) {
    throw new Error(
      `race: permission ${input.qid} changed status between the guard and the UPDATE`,
    );
  }

  // GSL-284 wake: the SessionAdapter delivers the decision to the paused hook long-poll.
  // Same seam as doAnswer; the permission-request shim reads `answer_text` and composes
  // the `permissionDecision` allow|deny payload for Claude Code.
  getSessionAdapter().deliverAnswer({
    qid: input.qid,
    status: "answered",
    answer_text: input.decision,
    answered_at,
    answered_by: input.by,
  });

  // GSL-312 (hotfix 2) — SSE cross-tab fan-out.
  //
  // The decide path writes only to SQLite (and wakes the paused shim above). Unlike doAnswer
  // — which spawns lab-emit.sh → JSONL → tail-indexer → broadcaster — nothing here reaches
  // the tail indexer, so a second dashboard tab kept rendering the row as OPEN with active
  // Allow/Deny buttons for 6+ seconds after the first tab decided (QA run 04 MAJOR#1).
  //
  // Fix: emit a synthetic in-process event on the same broadcaster the tail indexer feeds.
  // SseProvider.tsx invalidates ["core","questions"] on any type prefixed `question.`, and
  // the GSL-309 250 ms coalescer collapses this into the existing bucket. The event carries
  // `seq: 0` — the pattern from workers/fleet-poll.ts — marking it as non-persistent (no
  // corresponding row in the events table; SSE consumers key off type, not seq).
  //
  // Live-tested with two headless Chrome pages in .artifacts/hotfix2-live/ (see dev_history):
  // decide in tab A → tab B's Questions query refetch completes in < 400 ms.
  broadcaster.emit({
    seq: 0,
    day: answered_at.slice(0, 10),
    ts: answered_at,
    src: "core",
    actor: "actions.decide",
    task: null,
    type: "question.answered",
    payload: {
      qid: input.qid,
      kind: "permission",
      decision: input.decision,
      answered_at,
      answered_by: input.by,
      applied_by: "owner",
    },
    ingested_from: null,
  });

  return {
    qid: input.qid,
    status: "answered",
    decision: input.decision,
    answered_at,
    answered_by: input.by,
    applied_by: "owner",
    updated_message: input.updated_message,
  };
}

actionsRoutes.post("/actions/permissions/decide", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const qid = stringField(body, "qid");
  const rawDecision = body.decision;
  if (qid === null) return c.json({ ok: false, error: "qid required" }, 400);
  if (rawDecision !== "allow" && rawDecision !== "deny") {
    return c.json(
      { ok: false, error: "decision must be 'allow' or 'deny'" },
      400,
    );
  }
  const decision = rawDecision as "allow" | "deny";
  // updated_message is optional — treat missing / null as "no reason", empty string
  // as "no reason" too (mirrors the CLI defer contract: an explicit "" collapses to
  // no-timer). Any other type is a caller bug → 400.
  const rawMsg = body.updated_message;
  let updated_message: string | null = null;
  if (typeof rawMsg === "string" && rawMsg.length > 0) {
    updated_message = rawMsg;
  } else if (rawMsg !== null && rawMsg !== undefined && typeof rawMsg !== "string") {
    return c.json(
      { ok: false, error: "updated_message must be a string or null" },
      400,
    );
  }
  const by = stringField(body, "by") ?? "owner-web";
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.permissions.decide", async () =>
      withTimeline<DecidePermissionResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/permissions/decide",
          input: { qid, decision, updated_message, by },
        },
        () => doDecidePermission({ qid, decision, updated_message, by }),
      ),
    );
    if (outcome.cached && !outcome.ok) {
      return c.json(
        { ok: false, intent_id: outcome.intentId, error: outcome.error, cached: true },
        409,
      );
    }
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});

// -----------------------------------------------------------------------------
// GSL-298 — POST /actions/snapshot
//
// The last live-write in the Phase 7 acceptance the owner has to click during dogfooding
// (PRD "Acceptance criteria + end-check" bullet: "takes a manual snapshot through a button").
//
// Runs `apps/core/scripts/snapshot.sh` synchronously — the script is `sqlite3 .backup` +
// retention prune, normally <200 ms on a warm DB and bounded by SPAWN_TIMEOUT below. The
// stdout is a single JSON line the script emits on success:
//   {"ts":"…Z","event":"core.snapshot.ok","kind":"…","path":"…"}
// We parse that line to lift `kind` and `path` into the response envelope so the caller has
// the artifact location without having to `ls` afterwards.
//
// Modes:
//   * `label` omitted → kind=daily, filename `daily-<utc-ts>.db` (matches the launchd cron).
//   * `label` present → kind=manual, filename `manual-<label>-<utc-ts>.db` (retained
//     indefinitely per snapshot.sh header — the label is the operator's promise to future-
//     self). Empty string is rejected so the retention semantics stay honest.
//
// Bearer + Origin + Idempotency-Key layers are enforced by the existing middleware +
// withTimeline; TouchID intentionally NOT wired here — the write path only creates files
// under `data/snapshots/`, never mutates the primary DB (gap-analysis Gap 1 blast section).
//
// Env pass-through: `GOSLEEP_DB_PATH` propagates from the server process so the snapshot
// hits the SAME database the server is serving. Without this, the smoke would snapshot the
// real data/gosleep.db instead of its scratch DB — a leak we already saw when writing this.
// -----------------------------------------------------------------------------

interface SnapshotInput {
  label: string | null;
}

interface SnapshotResult {
  kind: string;
  path: string;
  ts: string;
  labSnapshot: { rc: number; stdout: string; stderr: string; elapsedMs: number };
}

/** The final non-empty stdout line snapshot.sh prints is `{"event":"core.snapshot.ok",…}`. */
function parseSnapshotStdout(stdout: string): { kind: string; path: string; ts: string } {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.event === "core.snapshot.ok") {
        const kind = typeof parsed.kind === "string" ? parsed.kind : "unknown";
        const path = typeof parsed.path === "string" ? parsed.path : "";
        const ts = typeof parsed.ts === "string" ? parsed.ts : nowIso();
        if (path.length === 0) {
          throw new Error("snapshot.sh returned an ok event with empty path");
        }
        return { kind, path, ts };
      }
    } catch {
      // fall through to next line
    }
  }
  throw new Error("snapshot.sh produced no core.snapshot.ok line");
}

async function doSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
  const cmd: string[] = ["bash", `${REPO_ROOT}/apps/core/scripts/snapshot.sh`];
  if (input.label !== null) {
    cmd.push("--kind", "manual", "--label", input.label);
  }
  // Propagate GOSLEEP_DB_PATH explicitly — spawnAwait's default sanitised env only auto-
  // forwards GOSLEEP_LAB_DIR and GOSLEEP_RUN_ID. Without this the smoke would target the
  // real data/gosleep.db instead of the scratch DB.
  const env: Record<string, string> = {};
  if (
    typeof process.env.GOSLEEP_DB_PATH === "string"
    && process.env.GOSLEEP_DB_PATH.length > 0
  ) {
    env.GOSLEEP_DB_PATH = process.env.GOSLEEP_DB_PATH;
  }
  const spawn = await spawnAwait({
    cmd,
    timeoutMs: 20_000, // sqlite3 .backup + retention on a healthy laptop is <1 s
    env,
  });
  if (!spawn.ok) {
    const reason = spawn.timedOut
      ? `snapshot.sh timed out after ${spawn.elapsedMs} ms`
      : `snapshot.sh exited rc=${spawn.code}; stderr: ${spawn.stderr}`;
    const err = new Error(reason);
    (err as Error & { httpStatus?: number }).httpStatus = 500;
    throw err;
  }
  const { kind, path, ts } = parseSnapshotStdout(spawn.stdout);
  return {
    kind,
    path,
    ts,
    labSnapshot: {
      rc: spawn.code ?? 0,
      stdout: spawn.stdout,
      stderr: spawn.stderr,
      elapsedMs: spawn.elapsedMs,
    },
  };
}

actionsRoutes.post("/actions/snapshot", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const rawLabel = body.label;
  let label: string | null = null;
  if (typeof rawLabel === "string") {
    if (rawLabel.length === 0) {
      return c.json({ ok: false, error: "label must be a non-empty string when provided" }, 400);
    }
    // Filename safety — snapshot.sh embeds the label into a filename and shells out around it.
    // Reject anything outside [A-Za-z0-9._-]; a length cap keeps ls output human-readable.
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(rawLabel)) {
      return c.json(
        {
          ok: false,
          error: "label must match [A-Za-z0-9._-]{1,64}",
        },
        400,
      );
    }
    label = rawLabel;
  } else if (rawLabel !== null && rawLabel !== undefined) {
    return c.json({ ok: false, error: "label must be a string or null" }, 400);
  }
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.snapshot", async () =>
      withTimeline<SnapshotResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/snapshot",
          input: { label },
        },
        () => doSnapshot({ label }),
      ),
    );
    if (outcome.cached && !outcome.ok) {
      return c.json(
        { ok: false, intent_id: outcome.intentId, error: outcome.error, cached: true },
        409,
      );
    }
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});

// -----------------------------------------------------------------------------
// POST /actions/events/ack
// -----------------------------------------------------------------------------

actionsRoutes.post("/actions/events/ack", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const seq = numberField(body, "seq");
  if (seq === null || !Number.isInteger(seq) || seq <= 0) {
    return c.json({ ok: false, error: "seq must be a positive integer" }, 400);
  }
  const note = stringField(body, "note");
  const by = stringField(body, "by") ?? "owner-web";
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.events.ack", async () =>
      withTimeline<AckResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/events/ack",
          input: { seq, note, by },
        },
        () => doAck({ seq, note, by }),
      ),
    );
    if (outcome.cached && !outcome.ok) {
      return c.json(
        { ok: false, intent_id: outcome.intentId, error: outcome.error, cached: true },
        409,
      );
    }
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    // Only log unexpected 5xx to stderr — expected 4xx (bad qid, missing field) are ordinary
    // user-input rejections and would spam the audit log if surfaced.
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});

// -----------------------------------------------------------------------------
// T5 (GSL-286 + GSL-266 partial) — POST /actions/skills/publish
//
// Payload: { skill: string, lesson?: string, task?: "GSL-N" }
//   `skill` is required and must match KNOWN_SKILLS in apps/core/src/actions/publish.ts.
//   `lesson` is optional free text; empty allowed.
//   `task` optional; publish.sh derives one from the latest commit under skill/<name> if unset.
//
// Three-layer envelope (identical to snapshot / answer / etc):
//   1. requireBearer (already on the router).
//   2. serialize("actions.skills.publish", ...) — per-endpoint mutex so a burst of clicks
//      does not spawn two publish.sh runs concurrently.
//   3. withTimeline(...) — persistent Idempotency-Key + server_intents audit ledger. A repeat
//      POST with the same key returns the ORIGINAL result without re-running publish.sh.
//
// The spawner passes the withTimeline intentId into publish.sh as --intent-id so the
// CHANGELOG row keys back to the audit ledger (plan risk 3: production test-guard keys on
// intent_id, not "any published row in this run").
// -----------------------------------------------------------------------------

actionsRoutes.post("/actions/skills/publish", requireBearer, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);
  const skill = stringField(body, "skill");
  if (skill === null) return c.json({ ok: false, error: "skill required" }, 400);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill)) {
    return c.json({ ok: false, error: "skill name shape /^[a-z0-9][a-z0-9-]{0,63}$/" }, 400);
  }
  const lesson = stringField(body, "lesson") ?? "";
  const task = stringField(body, "task");
  if (task !== null && !/^GSL-\d+$/.test(task)) {
    return c.json({ ok: false, error: "task must match /^GSL-\\d+$/" }, 400);
  }
  const intentId = resolveIntentId(c.req.header("idempotency-key"));

  try {
    const outcome = await serialize("actions.skills.publish", async () =>
      withTimeline<PublishResult>(
        getDb(),
        {
          intentId,
          endpoint: "POST /actions/skills/publish",
          input: { skill, lesson, task },
        },
        () => performPublish({ skill, lesson, task, intentId }),
      ),
    );
    if (outcome.cached && !outcome.ok) {
      return c.json(
        { ok: false, intent_id: outcome.intentId, error: outcome.error, cached: true },
        409,
      );
    }
    return c.json({
      ok: true,
      intent_id: outcome.intentId,
      cached: outcome.cached,
      finished_at: outcome.finishedAt,
      result: outcome.result,
    });
  } catch (err) {
    const status = httpStatusFromError(err);
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "core.action.error",
          intent_id: intentId,
          http_status: status,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return c.json(
      {
        ok: false,
        intent_id: intentId,
        error: err instanceof Error ? err.message : String(err),
      },
      status,
    );
  }
});
