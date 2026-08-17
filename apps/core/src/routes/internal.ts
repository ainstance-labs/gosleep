// @gosleep/core — /internal/* routes for the answer-delivery loop (GSL-275).
//
// Two endpoints wire the PreToolUse{AskUserQuestion} hook to the web UI. Both live under
// /internal, both go through the shared requireLocalHost + requireLocalOrigin app-wide layers,
// and both add requireInternalSecret as the auth layer (env-secret, distinct from the web
// Bearer — see security/internalSecret.ts for the rationale).
//
//   POST /internal/questions/post
//     Registers a question originated by an agent's AskUserQuestion tool call. Body carries the
//     full AskUserQuestion `tool_input` shape (`{questions:[{question,options,...}]}`) plus the
//     session/tool_use identifiers Claude Code hands the hook. Delegates to
//     `tools/lab/lab-emit.sh question --type BLOCKER` so the row lands in the same table the
//     web /questions screen already reads — no new UI surface required to show it.
//
//     Dedup: lab-emit already dedups on `qhash(task, question)`; the endpoint returns the
//     existing qid + `deduped: true` when the same question is re-posted (same text, same task).
//     This matches the Jira description "reuse lab-emit question semantics/dedup qhash".
//
//   GET  /internal/questions/:qid/answer-wait?timeout_s=N
//     Long-poll: held open until the qid's row transitions to `status='answered'` (or beyond)
//     OR `timeout_s` seconds elapse (default 600, per hooks.md:415 documented default) OR the
//     request is aborted (hook process killed / Claude Code cancelled the tool call). Return
//     shape:
//       200 { qid, status, answer_text, answered_at, answered_by, channel } — answer delivered
//       204                                                                 — timeout, no answer
//       404                                                                 — unknown qid
//
//     Wake mechanism: subscribe to questionNotifier (in-process EventEmitter fired by
//     doAnswer immediately after the direct DB UPDATE). NOT a DB poll — the ticket calls it out
//     explicitly. An initial DB read guards against the answer-before-wait race: the caller may
//     POST the question, the owner may click before the hook has time to open the long-poll,
//     the wait must still see the answer.
//
// AUTH:
//   Every endpoint here is behind requireInternalSecret. If GOSLEEP_INTERNAL_SECRET is unset on
//   the server, all /internal/* endpoints return 503 — the hook then falls open and the TUI
//   renders the question dialog normally. The design is fail-safe: an off internal loop is
//   indistinguishable to the agent from a session with no supervisor.

import { Hono } from "hono";
import type { Context } from "hono";

import { requireInternalSecret } from "../security/internalSecret.ts";
import { questionNotifier } from "../questions/notifier.ts";
import { getDb } from "../db/client.ts";
import { spawnAwait, spawnDetached, REPO_ROOT } from "../actions/spawn.ts";
import { observeHookWait } from "../metrics/registry.ts";
import { otpStore, DEFAULT_OTP_TTL_MS } from "../setup/otp-store.ts";
import { HOST_HEADER } from "../config.ts";
import {
  readEffectiveState,
  recordHeartbeat,
} from "../control/registry.ts";

function nowIso(): string {
  return new Date().toISOString();
}

export const internalRoutes = new Hono();

// -----------------------------------------------------------------------------
// small typed helpers (private to this module)
// -----------------------------------------------------------------------------

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

/**
 * Ceiling parser for the ?timeout_s= query. Default 600 s to match the hook default per
 * code.claude.com/docs/en/hooks.md:415. Hard cap 1800 s so a misbehaving client cannot pin a
 * socket open for hours; the addendum names 900–1800 s as the production window.
 */
function parseTimeoutSeconds(raw: string | undefined): number {
  const dflt = 600;
  const cap = 1800;
  if (raw === undefined || raw.length === 0) return dflt;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(n, cap);
}

interface RegisteredQuestion {
  qid: string;
  deduped: boolean;
  labEmit: {
    rc: number;
    stdout: string;
    stderr: string;
    elapsedMs: number;
  };
}

interface AskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label?: string; description?: string }>;
}

/**
 * Extract the primary question payload from an AskUserQuestion `tool_input`. Claude Code sends
 * `{questions: [...]}` with typically one entry; we register the first as the row (the shape
 * lab-emit.sh understands) and reserve multi-question support for a later task if the harness
 * actually ships multi-question dialogs. The full original payload is preserved by the caller
 * and echoed back to the agent via `updatedInput` — the DB row is a slice, not a replacement.
 */
function extractPrimaryQuestion(
  toolInput: Record<string, unknown> | undefined,
): AskQuestion | null {
  if (toolInput === undefined || toolInput === null) return null;
  const questions = (toolInput as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const first = questions[0];
  if (first === null || typeof first !== "object") return null;
  const q = first as Record<string, unknown>;
  if (typeof q.question !== "string" || q.question.length === 0) return null;
  const out: AskQuestion = { question: q.question };
  if (typeof q.header === "string") out.header = q.header;
  if (typeof q.multiSelect === "boolean") out.multiSelect = q.multiSelect;
  if (Array.isArray(q.options)) {
    const opts: Array<{ label: string; description?: string }> = [];
    for (const o of q.options) {
      if (o === null || typeof o !== "object") continue;
      const rec = o as Record<string, unknown>;
      if (typeof rec.label !== "string" || rec.label.length === 0) continue;
      const entry: { label: string; description?: string } = { label: rec.label };
      if (typeof rec.description === "string") entry.description = rec.description;
      opts.push(entry);
    }
    out.options = opts;
  }
  return out;
}

/**
 * Build the lab-emit CLI args for a BLOCKER-typed question. AskUserQuestion is semantically an
 * owner-must-answer prompt with no manifest default — that's the BLOCKER contract per lab-emit
 * discipline (see tools/lab/lab-emit.sh comments: BLOCKER takes no --default, no timer, only
 * the owner closes it via `answer`). The row lands with status='open' and shows in the web
 * Questions screen immediately.
 *
 * `from` is the agent's session id (or 'agent' if the hook did not pass one) so the audit log
 * can trace an answer back to the asking session.
 */
function buildLabEmitArgs(input: {
  question: AskQuestion;
  from: string;
  task: string;
  sessionId: string;
  toolUseId: string;
}): string[] {
  const args = [
    "bash",
    `${REPO_ROOT}/tools/lab/lab-emit.sh`,
    "question",
    "--type",
    "BLOCKER",
    "--question",
    input.question.question,
    "--from",
    input.from,
  ];
  if (input.task.length > 0) {
    args.push("--task", input.task);
  }
  // Preserve the session/tool_use ids as free-form links so a later audit can correlate.
  args.push("--link", `session_id=${input.sessionId}`);
  args.push("--link", `tool_use_id=${input.toolUseId}`);
  if (input.question.header !== undefined && input.question.header.length > 0) {
    args.push("--link", `header=${input.question.header}`);
  }
  // Options → lab-emit's `--option "label|pros|cons"` triples. AskUserQuestion has
  // {label, description}; description best maps to "pros" (the tooltip explaining the choice).
  for (const o of input.question.options ?? []) {
    if (typeof o.label !== "string" || o.label.length === 0) continue;
    // Sanitise pipes in labels/descriptions — lab-emit splits on '|' unconditionally.
    const label = o.label.replaceAll("|", "/");
    const description = (o.description ?? "").replaceAll("|", "/");
    args.push("--option", `${label}|${description}|`);
  }
  return args;
}

// -----------------------------------------------------------------------------
// POST /internal/questions/post
// -----------------------------------------------------------------------------

internalRoutes.post("/internal/questions/post", requireInternalSecret, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const toolUseId = typeof body.tool_use_id === "string" ? body.tool_use_id : "";
  const task = typeof body.task === "string" ? body.task : "";
  const from = typeof body.from === "string" && body.from.length > 0 ? body.from : "agent";
  const toolInput =
    body.tool_input !== null && typeof body.tool_input === "object" && !Array.isArray(body.tool_input)
      ? (body.tool_input as Record<string, unknown>)
      : undefined;

  const question = extractPrimaryQuestion(toolInput);
  if (question === null) {
    return c.json(
      { ok: false, error: "tool_input.questions[0].question required" },
      400,
    );
  }

  const args = buildLabEmitArgs({ question, from, task, sessionId, toolUseId });
  const emit = await spawnAwait({ cmd: args, timeoutMs: 10_000 });
  if (!emit.ok) {
    return c.json(
      {
        ok: false,
        error: `lab-emit question failed (rc=${emit.code ?? "null"}, timedOut=${emit.timedOut})`,
        stderr: emit.stderr,
        stdout: emit.stdout,
      },
      500,
    );
  }

  // lab-emit prints either the fresh qid ("q-2026-08-07-042") or "DUPLICATE <qid>" when the
  // same (task, question) landed while another row was still open. Both cases share the same
  // downstream contract: the caller now has a qid it can long-poll.
  const trimmed = emit.stdout.trim();
  let qid: string;
  let deduped: boolean;
  if (trimmed.startsWith("DUPLICATE ")) {
    qid = trimmed.slice("DUPLICATE ".length).trim();
    deduped = true;
  } else {
    qid = trimmed.split(/\s+/)[0] ?? "";
    deduped = false;
  }
  if (qid.length === 0) {
    return c.json(
      { ok: false, error: "lab-emit returned no qid", stdout: emit.stdout },
      500,
    );
  }

  // DUAL-WRITE: mirror doAnswer's pattern. lab-emit populated the JSONL side; we now INSERT the
  // row directly into the questions table so the /questions read endpoint AND the answer-wait
  // long-poll see the row IMMEDIATELY, without waiting for the tail indexer to fold the JSONL
  // (a 200-ms debounce + fs-watch latency the hook cannot afford — it would race the caller who
  // wants to click Answer). We use INSERT OR IGNORE so a dedup case (lab-emit already had this
  // row) does not error — the existing row wins.
  const optionsJson =
    (question.options ?? []).length > 0
      ? JSON.stringify(question.options)
      : null;
  getDb().raw
    .query(
      `INSERT OR IGNORE INTO questions
         (qid, status, kind, task, question, options, opened_at)
       VALUES (?, 'open', 'BLOCKER', ?, ?, ?, ?)`,
    )
    .run(qid, task.length > 0 ? task : null, question.question, optionsJson, nowIso());

  const out: RegisteredQuestion = {
    qid,
    deduped,
    labEmit: {
      rc: emit.code ?? -1,
      stdout: emit.stdout,
      stderr: emit.stderr,
      elapsedMs: emit.elapsedMs,
    },
  };
  return c.json({ ok: true, ...out });
});

// -----------------------------------------------------------------------------
// GET /internal/questions/:qid/answer-wait
// -----------------------------------------------------------------------------

interface QuestionRow {
  qid: string;
  status: string;
  kind: string;
  answer_text: string | null;
  answered_at: string | null;
  applied: string | null;
  applied_by: string | null;
}

interface AnswerPayload {
  qid: string;
  status: string;
  kind: string;
  answer_text: string;
  answered_at: string | null;
  answered_by: string | null;
  channel: string | null;
  /** GSL-284: on kind='permission' rows, this carries the optional deny reason (aka
   *  updated_message) that doDecidePermission stored. Null / absent on kind='BLOCKER'. */
  applied: string | null;
}

/**
 * Read the current row shape used to decide "answer ready?". Returns null if the qid does not
 * exist (the caller returns 404). The `answered_by` and `channel` columns are not in the base
 * schema (they live on the JSONL patch records folded by chronicler); we synthesize null and
 * let a future schema addition fill them in.
 */
function readQuestionRow(qid: string): QuestionRow | null {
  const row = getDb().raw
    .query(
      `SELECT qid, status, kind, answer_text, answered_at, applied, applied_by
       FROM questions WHERE qid = ?`,
    )
    .get(qid) as QuestionRow | undefined;
  return row ?? null;
}

/**
 * Turn an "answered" row into the payload the hook sends back to Claude Code as `updatedInput`.
 * The hook script is the one that composes the full hookSpecificOutput; this endpoint returns
 * the underlying facts.
 */
function toAnswerPayload(
  row: QuestionRow,
  channel: string | null,
  answeredBy: string | null,
): AnswerPayload {
  return {
    qid: row.qid,
    status: row.status,
    kind: row.kind,
    answer_text: row.answer_text ?? "",
    answered_at: row.answered_at,
    answered_by: answeredBy,
    channel,
    applied: row.applied,
  };
}

internalRoutes.get("/internal/questions/:qid/answer-wait", requireInternalSecret, async (c) => {
  const qid = c.req.param("qid");
  if (qid === undefined || qid.length === 0) {
    return c.json({ ok: false, error: "qid required" }, 400);
  }
  const timeoutSeconds = parseTimeoutSeconds(c.req.query("timeout_s"));
  // GSL-280 (metrics): observe how long every wait actually took, labelled `answer-wait`.
  // Fires once per handler call — early returns (initial-terminal, unknown qid) still count so
  // p50/p95/etc. include the fast path.
  const waitStartedAt = Date.now();
  const observeWait = (): void => {
    observeHookWait("answer-wait", (Date.now() - waitStartedAt) / 1000);
  };

  // Answer-before-wait: the answer may have already landed between the hook's POST and its
  // long-poll GET (owner is fast; manifest auto-resolve; retry after a network blip). A one-row
  // SELECT is cheaper than the subscribe + wait, so check first.
  const initial = readQuestionRow(qid);
  if (initial === null) {
    observeWait();
    return c.json({ ok: false, error: `qid ${qid} not found` }, 404);
  }
  if (initial.status === "answered" && initial.answer_text !== null) {
    observeWait();
    return c.json({ ok: true, ...toAnswerPayload(initial, null, null) });
  }
  // Any other terminal status ('resolved', 'auto-resolved', 'answered-by-default', 'noted',
  // 'superseded') is likewise "no more waiting" — return what we have so the hook can move on
  // rather than sit on a socket for the full timeout.
  const TERMINAL = new Set([
    "resolved",
    "auto-resolved",
    "answered-by-default",
    "noted",
    "superseded",
  ]);
  if (TERMINAL.has(initial.status)) {
    observeWait();
    return c.json({ ok: true, ...toAnswerPayload(initial, null, null) });
  }

  // Subscribe → wait for mutation OR timeout OR client abort. The Promise resolves with either
  // the mutation payload (answer arrived) or null (timeout / abort — the two are indistinguishable
  // from the hook's perspective; both are "no output → TUI renders normally").
  const result = await new Promise<AnswerPayload | null>((resolve) => {
    let done = false;
    const finish = (payload: AnswerPayload | null): void => {
      if (done) return;
      done = true;
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
      clearTimeout(timer);
      resolve(payload);
    };

    const unsubscribe = questionNotifier.subscribeQid(qid, (m) => {
      // Only the terminal transitions release the wait; any interim status flip is ignored so a
      // future 'pending-verify' step (should the schema ever add one) does not surprise-release
      // the hook with an incomplete answer.
      if (m.status !== "answered" && !TERMINAL.has(m.status)) return;
      if (m.answer_text === null) return;
      // Re-read the row on wake so the payload carries kind + applied (GSL-284 needs
      // `applied` to be the deny reason; the notifier mutation is intentionally lean and
      // does not carry it). A missing row (deleted mid-wait) collapses to a synthetic
      // payload built from the mutation — that path preserves GSL-275 behaviour verbatim.
      const fresh = readQuestionRow(qid);
      finish(
        fresh !== null
          ? toAnswerPayload(fresh, null, m.answered_by)
          : {
              qid,
              status: m.status,
              kind: "BLOCKER",
              answer_text: m.answer_text,
              answered_at: m.answered_at,
              answered_by: m.answered_by,
              channel: null,
              applied: null,
            },
      );
    });

    const timer = setTimeout(() => finish(null), timeoutSeconds * 1000);

    // Client aborts (hook process killed, Claude Code cancelled) release the wait immediately —
    // holding a socket open past the client's death would leak resources and keep the qid's
    // listener registered for the full timeout.
    const signal = c.req.raw.signal;
    if (signal !== undefined && signal !== null) {
      if (signal.aborted) {
        finish(null);
        return;
      }
      signal.addEventListener("abort", () => finish(null), { once: true });
    }
  });

  if (result === null) {
    // Timeout OR abort — same wire response. The hook reads 204 as "no answer, render TUI".
    observeWait();
    return c.body(null, 204);
  }
  observeWait();
  return c.json({ ok: true, ...result });
});

// -----------------------------------------------------------------------------
// POST /internal/agents/tool-observed  (GSL-276 / rev-3 addendum Delta 8.1)
// -----------------------------------------------------------------------------
//
// The PreToolUse Claude Code hook POSTs one JSON body per tool call the agent makes:
//   { session_id: "<uuid>", tool: "Read"|"Bash"|..., ts: "<ISO>",
//     context_pct?: 42, intent?: "one-line description" }
//
// The core writes `current_tool` (+ `context_pct` when present, + `current_intent` when
// present) into the agent_sessions row keyed on session_id. If no row exists yet (the
// fleet-poll worker has not yet observed this session), we INSERT a placeholder row so the
// data is not lost — the poller will fill in the CLI-owned fields on its next tick.
//
// DEBOUNCE. A single tool-use event fires MANY PreToolUse calls (one per invocation), and a
// long-running agent can push thousands per minute. We coalesce updates for the same
// session_id at a 1 s window: writes to the DB are batched into a periodic flush timer, and
// intra-window updates overwrite the pending state in memory. This bounds SQLite writes to
// ~1/sec/session regardless of tool activity.
//
// The debounce is IN THIS MODULE (module-scoped Map), NOT per-request — a per-request map
// would defeat the entire coalescing point. It's OK to live in the request-handler module
// because the process is single-instance (target-arch section 6.1).

import { broadcaster as agentSessionsBroadcaster } from "../sse/broadcaster.ts";

interface ToolObservation {
  session_id: string;
  tool: string;
  ts: string;
  context_pct: number | null;
  intent: string | null;
  /** GSL-319 — most-recent GitHub PR URL found in the observed command / response / intent
   *  text on this observation (null when the extractor found nothing). */
  pr_url: string | null;
  /** GSL-401 — when true, the flush NULLs current_tool AND current_intent for this row
   *  (rather than merging the observation via COALESCE). Set by a PostToolUse-driven
   *  clear POST that tells us the shim-intercepted tool has exited. On a clear entry
   *  every other field is ignored except `session_id` and `ts` (the timestamp is used
   *  for `updated_at`; no pr_url extraction runs). Never emitted by the pre-GSL-401
   *  writer path — non-clear observations continue to merge as before. */
  clear: boolean;
}

// GSL-319 — extract the FIRST canonical GitHub PR URL from any string. Deliberately narrow:
// only the `https://github.com/<owner>/<repo>/pull/<n>` form (no gitlab, no gh: refs, no /issues
// mistakes). Owner + repo segments allow dots, dashes, underscores, alphanumerics; number is
// digits. Returns the URL as a plain string with no trailing punctuation.
const PR_URL_PATTERN =
  /https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)/;
export function extractPrUrl(...sources: Array<string | null | undefined>): string | null {
  for (const s of sources) {
    if (typeof s !== "string" || s.length === 0) continue;
    const m = s.match(PR_URL_PATTERN);
    if (m !== null) {
      // Rebuild the canonical form (no query, no fragment, no trailing punctuation).
      return `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
    }
  }
  return null;
}

/** Per-session pending observation — replaced on every POST, drained by the flush timer. */
const pendingObservations = new Map<string, ToolObservation>();

/** Debounce flush interval in ms — 1 s per the Jira scope ("1 s debounce"). */
const TOOL_OBSERVED_FLUSH_MS = 1_000;

/** Flush timer handle — lazy-initialised on the first POST so tests that don't hit this
 *  endpoint never spin up the interval. Cleared explicitly via `stopToolObservedFlush()`
 *  which the serve.ts shutdown handler calls. */
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureFlushTimer(): void {
  if (flushTimer !== null) return;
  flushTimer = setInterval(flushPendingObservations, TOOL_OBSERVED_FLUSH_MS);
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

/** Public: stop the flush timer (used by graceful shutdown + tests). */
export function stopToolObservedFlush(): void {
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Flush one last time so anything queued during the last window is not dropped.
  flushPendingObservations();
}

/**
 * Drain the pending map to the DB. Called by the flush timer AND on the shutdown path (so a
 * graceful stop does not lose the last <1 s of observations).
 *
 * GSL-301 findings — the previous implementation wrapped the batch in
 * `db.raw.transaction(...)`, but under Bun 1.3.x's setInterval callback context that path
 * silently drops the INSERT when the row does not yet exist (UPDATE branch still lands).
 * Reproduced with `POST /internal/agents/tool-observed` for a fresh session_id + a 5 s sleep +
 * a `SELECT COUNT(*)` — count stayed at 0 while `pendingObservations` drained (proving the
 * flush ran, cleared the map, then no row landed). Direct `INSERT` and manual `BEGIN … COMMIT`
 * in an equivalent isolated Bun process do commit. Root cause is a Bun/SQLite interaction we
 * did not fully isolate; the pragmatic fix is to write row-at-a-time WITHOUT a transaction
 * wrapper. Each observation is independent, so per-row atomicity is enough and matches the
 * pattern the /actions/* endpoints already use (they rely on `withTimeline` for durability,
 * not `db.raw.transaction`).
 */
function flushPendingObservations(): void {
  if (pendingObservations.size === 0) return;
  const drained = Array.from(pendingObservations.values());
  pendingObservations.clear();
  const db = getDb();
  const nowTs = nowIso();
  let affected = 0;
  for (const obs of drained) {
    try {
      // GSL-401 — clear observations are handled BEFORE the normal UPDATE / INSERT branch.
      // They explicitly NULL current_tool AND current_intent for an EXISTING row (a clear
      // on an unknown session_id is a silent no-op — a placeholder row for a session we
      // have never observed would be meaningless). The clear path does not touch
      // context_pct, pr_url, or any other column: it is scoped exactly to the two fields
      // the E2E run-03 finding m1 called out as stuck.
      if (obs.clear === true) {
        db.raw
          .query(
            `UPDATE agent_sessions SET
               current_tool = NULL,
               current_intent = NULL,
               updated_at = ?
             WHERE session_id = ?`,
          )
          .run(nowTs, obs.session_id);
        affected += 1;
        continue;
      }
      // Try UPDATE first; if no row, INSERT a placeholder row. This is the "poller hasn't
      // seen this session yet" case — perfectly legal, the observation carries enough state
      // to make an intermediate row until the next poll fills in kind/cwd/status.
      // Bun's `db.query(...).get(...)` returns `null` (NOT `undefined`) when no row matches,
      // so the branch selector below must test against both sentinels — the original
      // `existing !== undefined` check took the UPDATE branch on a null result and silently
      // UPDATE'd 0 rows for every fresh session (GSL-301 finding, live-reproduced against a
      // clean scratch DB: `branch_probe` logged `existing: true` for a session_id that had
      // never been inserted).
      const existing = db.raw
        .query("SELECT session_id FROM agent_sessions WHERE session_id = ?")
        .get(obs.session_id) as { session_id: string } | null;
      if (existing !== null && existing !== undefined) {
        // Only overwrite context_pct / intent / pr_url when the observation carried non-null
        // values (a partial observation must not clobber a fresh value with NULL).
        // GSL-319 — `last_pr_url` upserted here; timestamp on the same row so Overview can
        // pick the newest URL across the fleet.
        db.raw
          .query(
            `UPDATE agent_sessions SET
               current_tool = ?,
               context_pct = COALESCE(?, context_pct),
               current_intent = COALESCE(?, current_intent),
               last_pr_url = COALESCE(?, last_pr_url),
               last_pr_at = CASE WHEN ? IS NULL THEN last_pr_at ELSE ? END,
               updated_at = ?
             WHERE session_id = ?`,
          )
          .run(
            obs.tool,
            obs.context_pct,
            obs.intent,
            obs.pr_url,
            obs.pr_url,
            obs.ts,
            nowTs,
            obs.session_id,
          );
      } else {
        // Placeholder INSERT — name/kind/cwd fill in on the next fleet-poll tick. cwd is a
        // literal placeholder string because the schema requires NOT NULL and the poller will
        // overwrite with the real cwd on its next sweep.
        db.raw
          .query(
            `INSERT INTO agent_sessions
               (session_id, name, kind, pid, model, cwd, cycle, context_pct,
                current_tool, current_intent, status, started_at, updated_at, ended_at,
                last_pr_url, last_pr_at)
             VALUES (?, ?, 'unknown', NULL, NULL, '?', NULL, ?, ?, ?, 'observed', ?, ?, NULL, ?, ?)`,
          )
          .run(
            obs.session_id,
            obs.session_id, // name defaults to session_id until the poller upgrades it
            obs.context_pct,
            obs.tool,
            obs.intent,
            obs.ts,
            nowTs,
            obs.pr_url,
            obs.pr_url !== null ? obs.ts : null,
          );
      }
      affected += 1;
    } catch (err) {
      // A single-row failure should NOT drop the rest of the batch. Log and move on — the
      // flush timer will pick up any retry the caller sends.
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: nowIso(),
          event: "core.tool_observed.flush_error",
          session_id: obs.session_id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  if (affected > 0) {
    // One SSE fan-out per flush — clients invalidate their /fleet query.
    agentSessionsBroadcaster.emit({
      seq: 0,
      day: nowTs.slice(0, 10),
      ts: nowTs,
      src: "core",
      actor: "tool-observed",
      task: null,
      type: "agent_sessions.updated",
      payload: { touched: affected, source: "hook" },
      ingested_from: null,
    });
  }
}

// -----------------------------------------------------------------------------
// POST /internal/permissions/post  (GSL-284)
//
// Sister endpoint of `POST /internal/questions/post`, tailored to the PreToolUse
// {PermissionRequest} hook shape. That hook fires when the model invokes the
// `PermissionRequest` tool to ask the owner whether another tool (Bash, Write, ...) may
// proceed. Semantics differ from AskUserQuestion:
//
//   * `tool_input` on the hook payload carries `{tool, params, message?}` — NO `questions[]`
//     array. The row we insert therefore has a permission-shaped question text, and options
//     collapse to a canonical `[{label: "Allow"}, {label: "Deny"}]` pair (typed as such by
//     the schema layer; the web permission card ignores free text).
//   * The answer vocabulary is boolean: `answer_text = "allow" | "deny"`. Optional
//     `updated_message` from `POST /actions/permissions/decide` becomes the
//     `permissionDecisionReason` on a deny path (stored in the `applied` column so the
//     row's permission decision is discoverable without touching the notifier payload).
//   * Rows are `kind='permission'` (distinct from AskUserQuestion's 'BLOCKER'), so the web
//     Questions screen renders them with Allow/Deny buttons instead of the free-text field.
//
// DUAL-WRITE DIFFERENCE vs the AskUserQuestion path: this endpoint does NOT spawn
// `lab-emit question --type BLOCKER` — lab-emit's `--type` is restricted to
// {BLOCKER,DECISION,CLARIFY,FYI}, and a re-fold by the tail indexer would overwrite our
// `kind='permission'` back to `BLOCKER`. Instead we:
//   1. Directly INSERT the row into `questions` with kind='permission' + canonical
//      Allow/Deny options.
//   2. Fire a fire-and-forget `lab-log --type permission.posed --actor "agent:<sid>"` so
//      an events.jsonl row exists — the tail indexer folds that into the `events` table
//      and the broadcaster fans it out on SSE, so the web client sees the pending
//      permission within one tail tick.
//
// Documented in the header of `apps/core/src/routes/internal.ts` (this file) so a reader
// hitting the permission code sees the shape difference in one place.
// -----------------------------------------------------------------------------

interface PermissionInput {
  session_id: string;
  tool_use_id: string;
  tool_name: string;
  /** Raw JSON blob the model handed to the permission-request tool. */
  tool_params: unknown;
  /** Optional model-authored explanation of why permission is being requested. */
  message: string | null;
}

/**
 * GSL-320 — reconcile two hook payload shapes into a common `tool_params` blob.
 *
 * Historically the endpoint expected the MCP-style shape (`{ tool, params, message }`) — that
 * matched the old model-driven `PermissionRequest` tool. But the current wiring runs off
 * Claude Code's real `PermissionRequest` event (GSL-304), where `tool_input` is the tool call's
 * ARGUMENTS directly:
 *   - Bash → `{ "command": "gh pr create …", "description": "…" }`
 *   - Edit → `{ "file_path": "…", "old_string": "…", "new_string": "…" }`
 *   - Write → `{ "file_path": "…", "content": "…" }`
 * `.params` is absent, so the previous `toolInputRaw.params ?? null` collapsed to null and the
 * card ended up as a bare `Permission request: Bash` with zero context (finding #1 in the run 06
 * verification report).
 *
 * Rule: if the payload declares the MCP shape (either `.tool` or `.params` key present), we
 * take `.params`. Otherwise the whole object IS the tool arguments; we strip the reserved
 * metadata keys (`tool`, `message`) and return the rest. An empty object collapses back to
 * null so the summary rendering can still skip the trailing preview when appropriate.
 */
export function flattenToolInput(
  toolInputRaw: Record<string, unknown>,
): unknown {
  const isCanonical =
    Object.prototype.hasOwnProperty.call(toolInputRaw, "params") ||
    Object.prototype.hasOwnProperty.call(toolInputRaw, "tool");
  if (isCanonical) {
    return toolInputRaw.params ?? null;
  }
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(toolInputRaw)) {
    if (k === "tool" || k === "message") continue;
    rest[k] = v;
  }
  return Object.keys(rest).length > 0 ? rest : null;
}

/** Cap the persisted `tool_input` JSON at ~4 KB. Long Edit payloads (a whole file body) would
 *  otherwise bloat the row and slow the SPA render. The cap is applied after JSON serialisation
 *  so the truncation point is byte-accurate; consumers see a suffix marker in place of trailing
 *  content. */
const TOOL_INPUT_CAP_BYTES = 4096;
export function encodeToolInputForStorage(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  let text: string;
  try {
    text = JSON.stringify(raw);
  } catch {
    text = String(raw);
  }
  if (text.length === 0) return null;
  if (text.length > TOOL_INPUT_CAP_BYTES) {
    // Preserve a "…" marker so the panel can hint truncation to the reader.
    text = `${text.slice(0, TOOL_INPUT_CAP_BYTES - 1)}…`;
  }
  return text;
}

/**
 * Compose the human-readable summary that lands in `questions.question`. Never NULL — the
 * schema demands a non-empty string. Keeps the tool name at the front so the Questions
 * screen's default label is a discoverable identifier ("Permission: Bash").
 */
function formatPermissionQuestion(p: PermissionInput): string {
  const paramsPreview = summarisePermissionParams(p.tool_params);
  const parts: string[] = [`Permission request: ${p.tool_name}`];
  if (p.message !== null && p.message.length > 0) {
    parts.push(p.message);
  }
  if (paramsPreview.length > 0) {
    parts.push(paramsPreview);
  }
  return parts.join("\n\n");
}

/**
 * Turn the arbitrary `tool_params` blob into a bounded preview. Bounded means: at most
 * ~500 chars — enough to see a shell command or a target path, not enough to blow up the
 * Questions screen with an entire payload. Non-JSON values collapse to a string, and
 * we escape newlines so the summary lands as ONE line inside `formatPermissionQuestion`.
 */
function summarisePermissionParams(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  let text: string;
  try {
    text = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    text = String(raw);
  }
  const CAP = 500;
  if (text.length > CAP) text = `${text.slice(0, CAP)}…`;
  return text;
}

const PERMISSION_OPTIONS = [
  { label: "Allow", description: "Approve the tool call" },
  { label: "Deny", description: "Reject the tool call" },
];

/**
 * Generate a permission qid that is stable across restarts and sortable by wall clock.
 * Format: `p-YYYYMMDD-HHMMSS-<random8>`. Distinct from the `q-*` prefix so a caller
 * skimming the DB can tell permission rows from AskUserQuestion rows at a glance.
 */
function newPermissionQid(): string {
  const now = new Date();
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  // 4 random bytes = 8 hex chars; large enough to avoid same-second collisions across
  // a fleet of ~dozens of concurrent PermissionRequests without a full UUID's bulk.
  const rand = crypto.getRandomValues(new Uint8Array(4));
  let hex = "";
  for (const b of rand) hex += b.toString(16).padStart(2, "0");
  return `p-${stamp}-${hex}`;
}

internalRoutes.post("/internal/permissions/post", requireInternalSecret, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const toolUseId = typeof body.tool_use_id === "string" ? body.tool_use_id : "";
  const toolInputRaw =
    body.tool_input !== null && typeof body.tool_input === "object" && !Array.isArray(body.tool_input)
      ? (body.tool_input as Record<string, unknown>)
      : {};
  const toolName =
    typeof toolInputRaw.tool === "string" && toolInputRaw.tool.length > 0
      ? toolInputRaw.tool
      : typeof body.tool_name === "string"
        ? body.tool_name
        : "";
  // GSL-320 — accept BOTH the MCP-style shape (`{tool, params, message}`) AND Claude Code's
  // real PermissionRequest payload where `tool_input` IS the tool's arguments (`{command: …}`
  // for Bash). See `flattenToolInput` for the reconciliation rule.
  const toolParams = flattenToolInput(toolInputRaw);
  const message =
    typeof toolInputRaw.message === "string" && toolInputRaw.message.length > 0
      ? toolInputRaw.message
      : typeof body.message === "string" && body.message.length > 0
        ? body.message
        : null;

  if (toolName.length === 0) {
    return c.json(
      { ok: false, error: "tool_input.tool (or top-level tool_name) required" },
      400,
    );
  }
  if (sessionId.length === 0) {
    return c.json({ ok: false, error: "session_id required" }, 400);
  }

  const permission: PermissionInput = {
    session_id: sessionId,
    tool_use_id: toolUseId,
    tool_name: toolName,
    tool_params: toolParams,
    message,
  };

  const qid = newPermissionQid();
  const openedAt = nowIso();
  const db = getDb();

  // Direct INSERT — see the header comment for why lab-emit BLOCKER dual-write is skipped.
  // Any duplicate qid is impossible in practice (random suffix), but INSERT OR IGNORE keeps
  // the endpoint idempotent against a caller that retries with the same qid via a proxy
  // rewrite (unlikely, but harmless to guard).
  //
  // GSL-320 — persist the flattened tool_input alongside the question text so the panel card
  // can render a dedicated monospace preview (not just the summary shoved into the question
  // string). NULL on the row when the caller sent no params — the SPA hides the preview slot.
  const toolInputJson = encodeToolInputForStorage(permission.tool_params);
  db.raw
    .query(
      `INSERT OR IGNORE INTO questions
         (qid, status, kind, task, question, options, opened_at, tool_input)
       VALUES (?, 'open', 'permission', NULL, ?, ?, ?, ?)`,
    )
    .run(
      qid,
      formatPermissionQuestion(permission),
      JSON.stringify(PERMISSION_OPTIONS),
      openedAt,
      toolInputJson,
    );

  // Fire the SSE side via a lab-log semantic event: this reaches web clients within one
  // tail-indexer tick (typically <200 ms) so the Questions screen refreshes without waiting
  // for a query invalidation timer. Fire-and-forget — the direct DB row is the source of
  // truth for `/questions`, so a lab-log hiccup is not a hard failure.
  const shortSid = sessionId.length > 0 ? sessionId.split("-")[0] ?? sessionId : "agent";
  const eventData = JSON.stringify({
    qid,
    tool: toolName,
    session_id: sessionId,
    tool_use_id: toolUseId,
  });
  spawnDetached({
    cmd: [
      "bash",
      `${REPO_ROOT}/tools/lab/lab-log.sh`,
      "--type",
      "permission.posed",
      "--actor",
      `agent:${shortSid}`,
      "--src",
      "emit",
      "--quiet",
      "--data-json",
      eventData,
    ],
    timeoutMs: 5_000,
  });

  return c.json({
    ok: true,
    qid,
    tool: toolName,
    opened_at: openedAt,
  });
});

internalRoutes.post("/internal/agents/tool-observed", requireInternalSecret, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const tool = typeof body.tool === "string" ? body.tool : "";
  const ts = typeof body.ts === "string" && body.ts.length > 0 ? body.ts : nowIso();
  const clear = body.clear === true;
  if (sessionId.length === 0) {
    return c.json({ ok: false, error: "session_id required" }, 400);
  }
  // GSL-401 — the clear path (PostToolUse-driven "the tool has exited, NULL its stuck
  // observation") requires ONLY session_id. Non-clear observations still need a tool
  // name, matching the pre-GSL-401 contract exactly.
  if (!clear && tool.length === 0) {
    return c.json({ ok: false, error: "session_id and tool required" }, 400);
  }
  if (clear) {
    // Enqueue a clear-observation for the debounce flush. Skip all preview / pr-url
    // extraction — the clear path is a pure "wipe current_tool + current_intent on this
    // row" signal and never carries tool metadata. Overwrites any pending observation
    // for the same session_id (the intent is "the tool has exited" — a stale pending
    // observation for that same tool is superseded).
    pendingObservations.set(sessionId, {
      session_id: sessionId,
      tool: "",
      ts,
      context_pct: null,
      intent: null,
      pr_url: null,
      clear: true,
    });
    ensureFlushTimer();
    return c.json({
      ok: true,
      session_id: sessionId,
      cleared: true,
      pending: pendingObservations.size,
      debounce_ms: TOOL_OBSERVED_FLUSH_MS,
    });
  }
  const contextPct =
    typeof body.context_pct === "number" &&
    Number.isFinite(body.context_pct) &&
    body.context_pct >= 0 &&
    body.context_pct <= 100
      ? Math.trunc(body.context_pct)
      : null;
  const intent =
    typeof body.intent === "string" && body.intent.length > 0 ? body.intent : null;

  // GSL-319 — the feeder can attach short previews of the tool's stdin / stdout so the
  // extractor spots a PR URL the moment `gh pr create` completes. Both fields are optional
  // and independently capped in the shim; we scan up to ~600 chars per field here.
  const commandPreview =
    typeof body.command_preview === "string" && body.command_preview.length > 0
      ? body.command_preview.slice(0, 600)
      : null;
  const responsePreview =
    typeof body.response_preview === "string" && body.response_preview.length > 0
      ? body.response_preview.slice(0, 600)
      : null;
  // An explicitly attached pr_url wins (a caller may already have parsed it); otherwise the
  // extractor scans the three preview strings for the canonical GitHub PR URL pattern.
  const explicitPrUrl =
    typeof body.pr_url === "string" && body.pr_url.length > 0 ? body.pr_url : null;
  const prUrl =
    explicitPrUrl !== null
      ? extractPrUrl(explicitPrUrl) // still validate the shape
      : extractPrUrl(commandPreview, responsePreview, intent);

  // Overwrite any pending observation for the same session — the debounce is COALESCE, not
  // FIFO. The last observation is the one we want to reflect.
  pendingObservations.set(sessionId, {
    session_id: sessionId,
    tool,
    ts,
    context_pct: contextPct,
    intent,
    pr_url: prUrl,
    clear: false,
  });
  ensureFlushTimer();

  return c.json({
    ok: true,
    session_id: sessionId,
    tool,
    pr_url_detected: prUrl,
    pending: pendingObservations.size,
    debounce_ms: TOOL_OBSERVED_FLUSH_MS,
  });
});

// -----------------------------------------------------------------------------
// GSL-282 — channels v1.1 (dev-flag gated, see packages/gosleep-channel/README.md)
//
// Three endpoints wire the gosleep-as-channel plugin to core:
//
//   POST /internal/permission-relay
//     Called by `packages/gosleep-channel/src/server.ts` when Claude Code sends
//     `notifications/claude/channel/permission_request` over the channel. Body:
//       { request_id, tool_name, description, input_preview, session_id? }
//     We reduce it into the same PermissionInput shape /internal/permissions/post
//     accepts, INSERT a `kind='permission'` row into `questions`, and return the
//     qid — so a channel-relayed PermissionRequest lands in exactly the same DB
//     row a hook-relayed one would (the web /questions Allow/Deny card handles
//     both uniformly, no UI branch).
//
//   GET  /internal/permissions/:qid/decision-wait?timeout_s=N
//     Long-poll: held open until the qid's row transitions to `status='answered'`
//     with `answer_text: "allow" | "deny"`, or `timeout_s` elapses, or the request
//     is aborted. Same subscribe/notify machinery as the AskUserQuestion answer-
//     wait — reuses `questionNotifier` since `doDecidePermission` already fires
//     the same wake mechanism (see `apps/core/src/routes/actions.ts` § doDecidePermission).
//     Return shape:
//       200 { ok:true, qid, behavior: "allow"|"deny", answered_at, answered_by? }
//       204 no body (timeout / abort)
//       404 { ok:false, error:"unknown qid" }
//       409 { ok:false, error:"qid is not a permission row" }
//
//   POST /internal/steer/:sid/drain
//     Reserved skeleton — returns `{ok:true, messages:[]}` today. Future work
//     (a separate ticket, not GSL-282) will back this with a persistent queue
//     written by `POST /actions/steer/post` from the web UI; the drain is fired
//     by a Stop/SessionStart hook on the plugin side so channel messages land at
//     the session's NEXT turn boundary (never mid-turn — the fundamental limit
//     of channels per channels-reference.md).
//
// AUTH: all three sit behind the same requireInternalSecret + local-only guards
// as the rest of /internal/*. A misconfigured core (no secret) 503s and the
// channel plugin falls open — its README documents that path.
// -----------------------------------------------------------------------------

internalRoutes.post("/internal/permission-relay", requireInternalSecret, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);

  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const toolName = typeof body.tool_name === "string" ? body.tool_name : "";
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const description = typeof body.description === "string" ? body.description : "";
  const inputPreview = typeof body.input_preview === "string" ? body.input_preview : "";

  if (requestId.length === 0) {
    return c.json({ ok: false, error: "request_id required" }, 400);
  }
  if (toolName.length === 0) {
    return c.json({ ok: false, error: "tool_name required" }, 400);
  }

  const messageParts: string[] = [];
  if (description.length > 0) messageParts.push(description);
  if (inputPreview.length > 0) messageParts.push(inputPreview);
  const permission: PermissionInput = {
    session_id: sessionId,
    tool_use_id: requestId,
    tool_name: toolName,
    tool_params: null,
    message: messageParts.length > 0 ? messageParts.join("\n") : null,
  };

  const qid = newPermissionQid();
  const openedAt = nowIso();
  const db = getDb();

  db.raw
    .query(
      `INSERT OR IGNORE INTO questions
         (qid, status, kind, task, question, options, opened_at)
       VALUES (?, 'open', 'permission', NULL, ?, ?, ?)`,
    )
    .run(
      qid,
      formatPermissionQuestion(permission),
      JSON.stringify(PERMISSION_OPTIONS),
      openedAt,
    );

  // Same SSE-side event the hook path fires — the payload carries `origin: 'channel'`
  // so a timeline reader can tell channel-relayed permission posts from hook-relayed
  // ones without reading the row's schema.
  const shortSid = sessionId.length > 0 ? sessionId.split("-")[0] ?? sessionId : "channel";
  const eventData = JSON.stringify({
    qid,
    tool: toolName,
    session_id: sessionId,
    tool_use_id: requestId,
    origin: "channel",
  });
  spawnDetached({
    cmd: [
      "bash",
      `${REPO_ROOT}/tools/lab/lab-log.sh`,
      "--type",
      "permission.posed",
      "--actor",
      `channel:${shortSid}`,
      "--src",
      "emit",
      "--quiet",
      "--data-json",
      eventData,
    ],
    timeoutMs: 5_000,
  });

  return c.json({
    ok: true,
    qid,
    tool: toolName,
    opened_at: openedAt,
    origin: "channel",
  });
});

/** Convert an "answered" permission row to the DecisionWait wire shape. */
function toDecisionPayload(row: QuestionRow, answeredBy: string | null): {
  qid: string;
  behavior: "allow" | "deny";
  answered_at: string | null;
  answered_by: string | null;
} | null {
  if (row.answer_text !== "allow" && row.answer_text !== "deny") return null;
  return {
    qid: row.qid,
    behavior: row.answer_text,
    answered_at: row.answered_at,
    answered_by: answeredBy,
  };
}

internalRoutes.get(
  "/internal/permissions/:qid/decision-wait",
  requireInternalSecret,
  async (c) => {
    const qid = c.req.param("qid");
    if (qid === undefined || qid.length === 0) {
      return c.json({ ok: false, error: "qid required" }, 400);
    }
    const timeoutSeconds = parseTimeoutSeconds(c.req.query("timeout_s"));
    const waitStartedAt = Date.now();
    const observeWait = (): void => {
      observeHookWait("permission-decision-wait", (Date.now() - waitStartedAt) / 1000);
    };

    // Answer-before-wait fast path — same rationale as the AskUserQuestion wait.
    const initial = readQuestionRow(qid);
    if (initial === null) {
      observeWait();
      return c.json({ ok: false, error: `qid ${qid} not found` }, 404);
    }
    if (initial.kind !== "permission") {
      observeWait();
      return c.json(
        { ok: false, error: `qid ${qid} is not a permission row (kind=${initial.kind})` },
        409,
      );
    }
    if (initial.status !== "open") {
      const payload = toDecisionPayload(initial, null);
      observeWait();
      if (payload !== null) return c.json({ ok: true, ...payload });
      // Terminal row without a valid decision (e.g. superseded before an owner answered)
      // — the caller cannot deliver a behavior, and should treat this like a timeout.
      return c.body(null, 204);
    }

    const result = await new Promise<
      ReturnType<typeof toDecisionPayload> | null
    >((resolve) => {
      let done = false;
      const finish = (
        payload: ReturnType<typeof toDecisionPayload> | null,
      ): void => {
        if (done) return;
        done = true;
        try {
          unsubscribe();
        } catch {
          /* ignore */
        }
        clearTimeout(timer);
        resolve(payload);
      };

      const unsubscribe = questionNotifier.subscribeQid(qid, (m) => {
        if (m.status !== "answered") return;
        if (m.answer_text !== "allow" && m.answer_text !== "deny") return;
        const fresh = readQuestionRow(qid);
        finish(
          fresh !== null
            ? toDecisionPayload(fresh, m.answered_by)
            : {
                qid,
                behavior: m.answer_text,
                answered_at: m.answered_at,
                answered_by: m.answered_by,
              },
        );
      });

      const timer = setTimeout(() => finish(null), timeoutSeconds * 1000);

      const signal = c.req.raw.signal;
      if (signal !== undefined && signal !== null) {
        if (signal.aborted) {
          finish(null);
          return;
        }
        signal.addEventListener("abort", () => finish(null), { once: true });
      }
    });

    if (result === null) {
      observeWait();
      return c.body(null, 204);
    }
    observeWait();
    return c.json({ ok: true, ...result });
  },
);

// -----------------------------------------------------------------------------
// GSL-333 (run 09 finding #7) — POST /internal/permissions/:qid/expire
//
// When the PermissionRequest hook long-poll times out (`GOSLEEP_HOOK_TIMEOUT_S`), the shim
// exits 0 and Claude Code falls back to the TUI dialog. Pre-GSL-333 the row stayed
// `status='open'` in the DB, so the panel kept rendering active Allow/Deny buttons; a
// subsequent owner click landed as `answered`, but the shim was DEAD and CC had already
// moved on — the answer was orphaned. Run 09 captured the exact sequence.
//
// The shim now POSTs THIS endpoint on the 204 timeout branch. The row transitions to
// `status='timed-out'` (a NEW terminal state) with `applied_by='shim-timeout'`; the panel
// reads the status and disables Allow/Deny with an explanatory label ("answered in
// terminal — hook timed out"). Idempotent: an already-terminal row (a race where the owner
// clicked Allow at the same instant the shim gave up) is a 200 no-op that leaks nothing.
//
// Auth: internal-secret only. Never returns the row's payload — the caller only needs
// success / failure to move on.
// -----------------------------------------------------------------------------
internalRoutes.post(
  "/internal/permissions/:qid/expire",
  requireInternalSecret,
  async (c) => {
    const qid = c.req.param("qid");
    if (qid === undefined || qid.length === 0) {
      return c.json({ ok: false, error: "qid required" }, 400);
    }
    const db = getDb();
    const row = db.raw
      .query("SELECT qid, status, kind FROM questions WHERE qid = ?")
      .get(qid) as { qid: string; status: string; kind: string } | null;
    if (row === null || row === undefined) {
      return c.json({ ok: false, error: `qid ${qid} not found` }, 404);
    }
    if (row.kind !== "permission") {
      return c.json(
        {
          ok: false,
          error: `qid ${qid} is not a permission row (kind=${row.kind})`,
        },
        409,
      );
    }
    // Idempotent: if the row is already terminal, return ok with the observed status.
    // This covers the race where the owner clicked Allow between the shim's wait giving
    // up and the shim's expire POST landing — we do NOT want the expire to overwrite an
    // owner's decision, and we do NOT want the shim's fail-open flow to hit an error.
    if (row.status !== "open") {
      return c.json({
        ok: true,
        qid,
        status: row.status,
        transitioned: false,
        reason: "row was already terminal — no-op",
      });
    }
    const expiredAt = nowIso();
    const upd = db.raw
      .query(
        `UPDATE questions
           SET status = 'timed-out',
               answered_at = ?,
               applied_by = 'shim-timeout'
         WHERE qid = ? AND status = 'open' AND kind = 'permission'`,
      )
      .run(expiredAt, qid);
    if (upd.changes === 0) {
      // Racy loss to a concurrent /actions/permissions/decide — re-read and report the
      // winning status; still a 200 (the shim's fail-open flow only needs "did it work
      // or move-on, either way don't block").
      const fresh = db.raw
        .query("SELECT status FROM questions WHERE qid = ?")
        .get(qid) as { status: string } | null;
      return c.json({
        ok: true,
        qid,
        status: fresh?.status ?? "unknown",
        transitioned: false,
        reason: "race — row transitioned concurrently, expire was a no-op",
      });
    }
    // Broadcast the transition so the panel invalidates its Questions query in real time
    // — same seam GSL-312 hotfix 2 used from doDecidePermission. Without this the panel
    // would keep the "Allow / Deny" buttons live for up to the SseProvider poll interval.
    agentSessionsBroadcaster.emit({
      seq: 0,
      day: expiredAt.slice(0, 10),
      ts: expiredAt,
      src: "core",
      actor: "internal.permissions.expire",
      task: null,
      type: "question.expired",
      payload: {
        qid,
        kind: "permission",
        status: "timed-out",
        expired_at: expiredAt,
      },
      ingested_from: null,
    });
    return c.json({
      ok: true,
      qid,
      status: "timed-out",
      transitioned: true,
      expired_at: expiredAt,
    });
  },
);

internalRoutes.post("/internal/steer/:sid/drain", requireInternalSecret, async (c) => {
  const sid = c.req.param("sid");
  if (sid === undefined || sid.length === 0) {
    return c.json({ ok: false, error: "session id required" }, 400);
  }
  // Skeleton — the queue behind this endpoint is future work. Returning an
  // empty message list is the honest "nothing to deliver" answer; the plugin
  // handles it silently. When the queue lands, this handler will read+pop
  // pending rows for `sid` in insertion order, log a `steer.drained` event,
  // and return them here. Keeping the endpoint live from GSL-282 means the
  // plugin does not need a client-side feature flag; it can call the drain
  // unconditionally and see empty responses until the queue exists.
  return c.json({ ok: true, messages: [], reserved: true });
});

// -----------------------------------------------------------------------------
// GSL-291 — /internal/setup/otp: generate a one-shot OTP for the /setup Bearer-
// discovery flow. Called by `apps/core/plist.sh setup-url` — the operator has
// the internal secret via Keychain, so a curl with `X-Internal-Secret` produces
// a URL like `http://127.0.0.1:7331/setup?tok=<OTP>` that the owner pastes into
// their browser. On visit, /setup exchanges the OTP for the Bearer and lands it
// in sessionStorage via a meta tag (never in the URL bar / history).
//
// Body: optional `{ ttl_s?: number }` — overrides the default 5-min TTL, capped
// at 60 min so a stale link cannot linger for hours.
// -----------------------------------------------------------------------------

const OTP_TTL_MIN_S = 30;
const OTP_TTL_MAX_S = 3600;

function newSetupOtp(): string {
  // 32 bytes of entropy → 64 hex chars. Enough to make guessing infeasible even without
  // the local-Host + internal-secret guards on the wrapping flow.
  const buf = crypto.getRandomValues(new Uint8Array(32));
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex;
}

internalRoutes.post("/internal/setup/otp", requireInternalSecret, async (c) => {
  const body = await parseJsonBody(c);
  if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);

  let ttlMs = DEFAULT_OTP_TTL_MS;
  if (typeof body.ttl_s === "number" && Number.isFinite(body.ttl_s)) {
    const clamped = Math.min(OTP_TTL_MAX_S, Math.max(OTP_TTL_MIN_S, Math.trunc(body.ttl_s)));
    ttlMs = clamped * 1000;
  }

  const otp = newSetupOtp();
  const expiresAtMs = otpStore.create(otp, ttlMs);
  return c.json({
    ok: true,
    otp,
    url: `http://${HOST_HEADER}/setup?tok=${otp}`,
    expires_at: new Date(expiresAtMs).toISOString(),
    ttl_s: Math.round(ttlMs / 1000),
  });
});

// -----------------------------------------------------------------------------
// GSL-361 (observer mode phase B) — per-session control registry endpoints.
//
// Two internal routes wire the shim's runtime-toggle-aware gate to the DB:
//
//   GET /internal/sessions/:session_id/control
//     Fast lookup that returns `{state, source, shim_registered}`. Called by the shim on
//     every invocation (miss path: adds ~5 ms per hook fire, per R15.6). Cached in-process
//     on the shim side at a 1 s TTL. Fail-mode: on unreachable core the shim falls back to
//     env-flag-only per the binding decision (never fail-open into interception).
//
//   POST /internal/sessions/:session_id/shim-heartbeat
//     Called by the FIRST shim invocation per session and idempotently on subsequent ones.
//     Registers `shim_registered=1` and stamps a heartbeat. Also carries the shim's own
//     env-opt-in bit: when the launching shell exported GOSLEEP_WEB_QUESTIONS=1, the shim
//     posts `env_opt_in=true` and the registry escalates to state='controlled', source='env'
//     immediately (F15-S4). A subsequent panel `release-control` on such a row 409s
//     (R15.3, "not releasable from panel").
//
// AUTH: shared requireInternalSecret gate with every /internal/* route above.
// -----------------------------------------------------------------------------

internalRoutes.get(
  "/internal/sessions/:session_id/control",
  requireInternalSecret,
  (c) => {
    const sessionId = c.req.param("session_id");
    if (sessionId === undefined || sessionId.length === 0) {
      return c.json({ ok: false, error: "session_id required" }, 400);
    }
    const effective = readEffectiveState(getDb(), sessionId);
    return c.json({
      ok: true,
      session_id: sessionId,
      state: effective.state,
      source: effective.source,
      shim_registered: effective.shim_registered,
    });
  },
);

internalRoutes.post(
  "/internal/sessions/:session_id/shim-heartbeat",
  requireInternalSecret,
  async (c) => {
    const sessionId = c.req.param("session_id");
    if (sessionId === undefined || sessionId.length === 0) {
      return c.json({ ok: false, error: "session_id required" }, 400);
    }
    const body = await parseJsonBody(c);
    if ("__error" in body) return c.json({ ok: false, error: body.__error }, 400);

    const rawPid = body.pid;
    const pid =
      typeof rawPid === "number" && Number.isFinite(rawPid) && rawPid > 0
        ? Math.trunc(rawPid)
        : null;
    const envOptIn = body.env_opt_in === true;
    const result = recordHeartbeat(getDb(), {
      session_id: sessionId,
      pid,
      env_opt_in: envOptIn,
    });

    // Fan out to the panel via SSE — the shim-registered flip enables the "Take control"
    // button, and the env-locked escalation swaps the pill from `observer` to `env-locked`.
    // Synthetic (seq: 0) event; SseProvider treats `sessions.control.*` prefix as a cache-
    // invalidation trigger (client changes land in GSL-361 too).
    const nowTs = nowIso();
    agentSessionsBroadcaster.emit({
      seq: 0,
      day: nowTs.slice(0, 10),
      ts: nowTs,
      src: "core",
      actor: "internal.sessions.heartbeat",
      task: null,
      type: result.env_locked
        ? "sessions.control.env-locked"
        : "sessions.control.heartbeat",
      payload: {
        session_id: sessionId,
        state: result.state,
        source: result.source,
        shim_registered: result.shim_registered,
        env_locked: result.env_locked,
        created: result.created,
      },
      ingested_from: null,
    });

    return c.json({
      ok: true,
      session_id: sessionId,
      state: result.state,
      source: result.source,
      shim_registered: result.shim_registered,
      env_locked: result.env_locked,
      created: result.created,
    });
  },
);
