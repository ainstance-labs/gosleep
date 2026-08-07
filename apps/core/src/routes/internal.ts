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
import { spawnAwait, REPO_ROOT } from "../actions/spawn.ts";

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
  answer_text: string | null;
  answered_at: string | null;
}

interface AnswerPayload {
  qid: string;
  status: string;
  answer_text: string;
  answered_at: string | null;
  answered_by: string | null;
  channel: string | null;
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
      `SELECT qid, status, answer_text, answered_at
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
    answer_text: row.answer_text ?? "",
    answered_at: row.answered_at,
    answered_by: answeredBy,
    channel,
  };
}

internalRoutes.get("/internal/questions/:qid/answer-wait", requireInternalSecret, async (c) => {
  const qid = c.req.param("qid");
  if (qid === undefined || qid.length === 0) {
    return c.json({ ok: false, error: "qid required" }, 400);
  }
  const timeoutSeconds = parseTimeoutSeconds(c.req.query("timeout_s"));

  // Answer-before-wait: the answer may have already landed between the hook's POST and its
  // long-poll GET (owner is fast; manifest auto-resolve; retry after a network blip). A one-row
  // SELECT is cheaper than the subscribe + wait, so check first.
  const initial = readQuestionRow(qid);
  if (initial === null) {
    return c.json({ ok: false, error: `qid ${qid} not found` }, 404);
  }
  if (initial.status === "answered" && initial.answer_text !== null) {
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
      finish({
        qid,
        status: m.status,
        answer_text: m.answer_text,
        answered_at: m.answered_at,
        answered_by: m.answered_by,
        channel: null,
      });
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
    return c.body(null, 204);
  }
  return c.json({ ok: true, ...result });
});
