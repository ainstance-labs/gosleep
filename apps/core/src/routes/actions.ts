// @gosleep/core — POST /actions/* write endpoints (GSL-268).
//
// Four v1 write endpoints per target-architecture rev-2 section 6.2 + rev-3 addendum scope
// (defer + apply-manifest moved to GSL-278 / GSL-277):
//
//   POST /actions/questions/answer   { qid, answer, by?, channel? }
//   POST /actions/questions/resolve  { qid, applied, early? }
//   POST /actions/tick               {}                              (fire-and-forget)
//   POST /actions/events/ack         { seq, note? }
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
import { questionNotifier } from "../questions/notifier.ts";

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
  // the SSE broadcaster (that path fires later, after the tail indexer re-reads the JSONL); this
  // in-process EventEmitter fires within the same await frame so the hook shim releases in
  // ~milliseconds. See src/questions/notifier.ts for the whole rationale.
  questionNotifier.notify({
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
  questionNotifier.notify({
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

function httpStatusFromError(err: unknown): 400 | 404 | 409 | 500 {
  if (err instanceof Error) {
    const status = (err as Error & { httpStatus?: number }).httpStatus;
    if (status === 400 || status === 404 || status === 409 || status === 500) return status;
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
