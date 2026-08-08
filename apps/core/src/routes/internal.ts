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
 * Drain the pending map to the DB in one transaction. Called by the flush timer AND on the
 * shutdown path (so a graceful stop does not lose the last <1 s of observations).
 */
function flushPendingObservations(): void {
  if (pendingObservations.size === 0) return;
  const drained = Array.from(pendingObservations.values());
  pendingObservations.clear();
  const db = getDb();
  const nowTs = nowIso();
  let affected = 0;
  const tx = db.raw.transaction(() => {
    for (const obs of drained) {
      // Try UPDATE first; if no row, INSERT a placeholder row. This is the "poller hasn't
      // seen this session yet" case — perfectly legal, the observation carries enough state
      // to make an intermediate row until the next poll fills in kind/cwd/status.
      const existing = db.raw
        .query("SELECT session_id FROM agent_sessions WHERE session_id = ?")
        .get(obs.session_id) as { session_id: string } | undefined;
      if (existing !== undefined) {
        // Only overwrite context_pct / intent when the observation carried non-null values
        // (a partial observation must not clobber a fresh number with NULL).
        db.raw
          .query(
            `UPDATE agent_sessions SET
               current_tool = ?,
               context_pct = COALESCE(?, context_pct),
               current_intent = COALESCE(?, current_intent),
               updated_at = ?
             WHERE session_id = ?`,
          )
          .run(
            obs.tool,
            obs.context_pct,
            obs.intent,
            nowTs,
            obs.session_id,
          );
      } else {
        // Placeholder INSERT — name/kind/cwd fill in on the next fleet-poll tick.
        db.raw
          .query(
            `INSERT INTO agent_sessions
               (session_id, name, kind, pid, model, cwd, cycle, context_pct,
                current_tool, current_intent, status, started_at, updated_at, ended_at)
             VALUES (?, ?, 'unknown', NULL, NULL, '?', NULL, ?, ?, ?, 'observed', ?, ?, NULL)`,
          )
          .run(
            obs.session_id,
            obs.session_id, // name defaults to session_id until the poller upgrades it
            obs.context_pct,
            obs.tool,
            obs.intent,
            obs.ts,
            nowTs,
          );
      }
      affected += 1;
    }
  });
  tx();
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
  const toolParams = toolInputRaw.params ?? null;
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
  if (sessionId.length === 0 || tool.length === 0) {
    return c.json({ ok: false, error: "session_id and tool required" }, 400);
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

  // Overwrite any pending observation for the same session — the debounce is COALESCE, not
  // FIFO. The last observation is the one we want to reflect.
  pendingObservations.set(sessionId, {
    session_id: sessionId,
    tool,
    ts,
    context_pct: contextPct,
    intent,
  });
  ensureFlushTimer();

  return c.json({
    ok: true,
    session_id: sessionId,
    tool,
    pending: pendingObservations.size,
    debounce_ms: TOOL_OBSERVED_FLUSH_MS,
  });
});
