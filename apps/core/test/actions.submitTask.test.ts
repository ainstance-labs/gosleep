// @gosleep/core — POST /actions/sessions/:id/submit-task HTTP tests (GSL-381).
//
// Pins the wire-level contract:
//
//   Preview (dry_run=true):
//     1. controlled + shim + valid body → 200 with preview payload (resolved_target,
//        keystroke_bytes, body_len, body_sha256, framing, warnings, previewed_at).
//     2. session observer → 409 with reason: "session-not-controlled".
//     3. shim_registered=0 → 409 with reason: "shim-not-registered".
//     4. body-invalid (control char) → 400 with reason: "body-invalid".
//     5. Missing 'dry_run' → 400.
//     6. Framing enum guard → 400 for a bogus value.
//     7. Re-preview with the same Idempotency-Key returns cached:true.
//
//   Confirm (dry_run=false):
//     8. No prior preview → 428 with reason: "preview-required".
//     9. Prior preview under DIFFERENT body → 428 with reason: "preview-required"
//        (body_sha256 mismatch).
//    10. Prior preview + release-mid-submit (flip state to observer between) → 409
//        session-not-controlled (F16-S6).
//    11. Prior preview + delete pane row (simulate pane_gone) → 200 with outcome:
//        pane_gone AND task_submissions row inserted with outcome='pane_gone' AND no
//        tmux spawn.
//    12. Prior preview + happy path → 200 with outcome:delivered AND task_submissions
//        row inserted AND two spawn calls fired (mocked).
//    13. Cached confirm replay — second confirm returns same submission_id, no new row.
//    14. GET /sessions/:id/submissions returns rows newest-first with body_sha256+
//        body_len only (no body text).

import { beforeAll, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import type { SpawnResult } from "../src/actions/spawn.ts";

// ----- scratch DB with only the tables the endpoints touch --------------------
const raw = new Database(":memory:");
raw.exec("PRAGMA journal_mode = MEMORY;");
raw.exec(`CREATE TABLE server_intents (
  intent_id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,
  params TEXT
);`);
raw.exec(`CREATE TABLE session_control (
  session_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'observer',
  source TEXT NOT NULL DEFAULT 'runtime',
  activated_at TEXT, activated_by TEXT, deactivated_at TEXT,
  shim_registered INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TEXT, last_heartbeat_pid INTEGER
);`);
raw.exec(`CREATE TABLE agent_sessions (
  session_id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
  pid INTEGER, model TEXT, cwd TEXT NOT NULL, cycle INTEGER, context_pct INTEGER,
  current_tool TEXT, current_intent TEXT, status TEXT NOT NULL,
  started_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT,
  last_pr_url TEXT, last_pr_at TEXT,
  project_slug TEXT, cwd_project_root TEXT,
  observed_only INTEGER NOT NULL DEFAULT 0
);`);
raw.exec(`CREATE TABLE tmux_panes (
  pane_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, session_name TEXT NOT NULL,
  window_id TEXT NOT NULL, pane_pid INTEGER NOT NULL,
  pane_current_path TEXT, pane_current_command TEXT, pane_title TEXT,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, misses INTEGER NOT NULL DEFAULT 0
);`);
raw.exec(`CREATE TABLE task_submissions (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, session_id TEXT NOT NULL,
  pane_ref_at_dispatch TEXT, body_sha256 TEXT NOT NULL, body_len INTEGER NOT NULL,
  framing TEXT NOT NULL, outcome TEXT NOT NULL, error TEXT
);`);
const scratchDb = drizzle(raw, { schema });
const openedDb: OpenedDb = { db: scratchDb, raw, path: ":memory:" };

// Cache the REAL openDatabase before the mock takes effect so tests further down the
// alphabetical run order (indexer.reconcile.test.ts) that expect a real bun:sqlite
// handle from `openDatabase(dbPath)` still get one. Bun's mock.module resolves by
// module URL and can leak the LAST mock across test files, so we narrow the mock to
// `getDb` (endpoint reads) + `defaultDbPath` (points at :memory: for this file only)
// and forward the real openDatabase / __resetDbClientForTests.
const realClient = await import("../src/db/client.ts");
mock.module("../src/db/client.ts", () => ({
  ...realClient,
  getDb: () => openedDb,
  defaultDbPath: () => ":memory:",
  schema,
}));
// Use the env-var Bearer path (source='dev-env'). authSource is NOT mock.module'd here
// because Bun's mock.module is process-global — replacing it here would leak into other
// test files (fleet.projection.test.ts / actions.decidePermission.sse.test.ts, etc.,
// which set `process.env.GOSLEEP_BEARER_TOKEN` and rely on the real resolveAuthSource
// reading it back).
process.env.GOSLEEP_BEARER_TOKEN = "test-bearer";

// Track the spawn args the executor emits so tests can assert two calls (body + Enter).
let spawnCalls: string[][] = [];
let spawnResult: SpawnResult = {
  ok: true, code: 0, stdout: "", stderr: "", timedOut: false, elapsedMs: 5,
};
mock.module("../src/actions/spawn.ts", () => ({
  REPO_ROOT: "/tmp",
  spawnAwait: async (opts: { cmd: string[] }) => {
    spawnCalls.push(opts.cmd);
    return spawnResult;
  },
  spawnDetached: () => ({ pid: 0 }),
}));

const { actionsRoutes, _setSubmitDepsOverrideForTesting } = await import(
  "../src/routes/actions.ts"
);
const { readRoutes } = await import("../src/routes/read.ts");
const { requireLocalHost } = await import("../src/security/host.ts");
const { requireLocalOrigin } = await import("../src/security/origin.ts");

// Set executor deps: force waitForPromptBoundary to true so framing='prompt-boundary'
// doesn't have to poll — and use the recorded spawnCalls path via our mocked spawnAwait.
_setSubmitDepsOverrideForTesting({
  waitForPromptBoundary: async () => true,
});

const app = new Hono();
app.use("*", requireLocalHost);
app.use("*", requireLocalOrigin);
app.route("/", actionsRoutes);
app.route("/", readRoutes);

function seedControlled(sessionId: string, opts: {
  state?: "observer" | "controlled";
  shim_registered?: 0 | 1;
  panePath?: string | null;
} = {}): void {
  const state = opts.state ?? "controlled";
  const shim = opts.shim_registered ?? 1;
  const cwd = `/repo/${sessionId}`;
  const panePath = opts.panePath === undefined ? cwd : opts.panePath;
  raw.query(
    `INSERT OR REPLACE INTO session_control (session_id, state, source, shim_registered, activated_at, activated_by) VALUES (?, ?, 'runtime', ?, '2026-08-16T00:00:00Z', 'owner-web')`,
  ).run(sessionId, state, shim);
  raw.query(
    `INSERT OR REPLACE INTO agent_sessions (session_id, name, kind, cwd, cwd_project_root, status, started_at, updated_at) VALUES (?, 'sess', 'interactive', ?, ?, 'idle', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')`,
  ).run(sessionId, cwd, cwd);
  const paneId = `%${sessionId.length}`;
  raw.query(
    `INSERT OR REPLACE INTO tmux_panes (pane_id, session_id, session_name, window_id, pane_pid, pane_current_path, pane_current_command, pane_title, first_seen, last_seen, misses) VALUES (?, 't-1', ?, '@1', 12345, ?, 'bash', 'bash', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z', 0)`,
  ).run(paneId, `gsl378-target-${sessionId}`, panePath);
}

function clearSubmissionState(): void {
  raw.exec("DELETE FROM task_submissions;");
  raw.exec("DELETE FROM server_intents;");
  raw.exec("DELETE FROM session_control;");
  raw.exec("DELETE FROM agent_sessions;");
  raw.exec("DELETE FROM tmux_panes;");
  spawnCalls = [];
  spawnResult = { ok: true, code: 0, stdout: "", stderr: "", timedOut: false, elapsedMs: 5 };
}

const BASE_HEADERS: Record<string, string> = {
  Host: "127.0.0.1:7331",
  Origin: "http://127.0.0.1:7331",
  Authorization: "Bearer test-bearer",
  "Content-Type": "application/json",
};

async function postJson(
  path: string,
  body: Record<string, unknown>,
  extra: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.fetch(
    new Request(`http://127.0.0.1:7331${path}`, {
      method: "POST",
      headers: { ...BASE_HEADERS, ...extra },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function getJson(
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.fetch(
    new Request(`http://127.0.0.1:7331${path}`, {
      method: "GET",
      headers: BASE_HEADERS,
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /actions/sessions/:id/submit-task — preview (GSL-381)", () => {
  test("controlled + shim + valid body → 200 preview", async () => {
    clearSubmissionState();
    seedControlled("sess-A");
    const r = await postJson(
      "/actions/sessions/sess-A/submit-task",
      { body: "run a task", framing: "none", dry_run: true },
      { "Idempotency-Key": "sub-A-1" },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const result = r.body.result as Record<string, unknown>;
    expect(result.session_id).toBe("sess-A");
    expect(result.body_len).toBe(10);
    expect(result.framing).toBe("none");
    expect(result.resolved_target).toContain("gsl378-target");
    expect(result.warnings).toEqual([]);
    // Confirms nothing landed in the DB — dry-run must not insert.
    const rows = raw.query(`SELECT COUNT(*) AS c FROM task_submissions`).get() as { c: number };
    expect(rows.c).toBe(0);
  });

  test("observer session → 409 session-not-controlled", async () => {
    clearSubmissionState();
    seedControlled("sess-B", { state: "observer" });
    const r = await postJson(
      "/actions/sessions/sess-B/submit-task",
      { body: "hi", dry_run: true },
      { "Idempotency-Key": "sub-B-1" },
    );
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("session-not-controlled");
  });

  test("shim_registered=0 → 409 shim-not-registered", async () => {
    clearSubmissionState();
    seedControlled("sess-C", { shim_registered: 0 });
    const r = await postJson(
      "/actions/sessions/sess-C/submit-task",
      { body: "hi", dry_run: true },
      { "Idempotency-Key": "sub-C-1" },
    );
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("shim-not-registered");
  });

  test("body with sub-0x20 byte → 400 body-invalid", async () => {
    clearSubmissionState();
    seedControlled("sess-D");
    const r = await postJson(
      "/actions/sessions/sess-D/submit-task",
      { body: "hello\x07world", dry_run: true },
      { "Idempotency-Key": "sub-D-1" },
    );
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe("body-invalid");
  });

  test("missing dry_run → 400", async () => {
    clearSubmissionState();
    seedControlled("sess-E");
    const r = await postJson(
      "/actions/sessions/sess-E/submit-task",
      { body: "hello" },
      { "Idempotency-Key": "sub-E-1" },
    );
    expect(r.status).toBe(400);
  });

  test("bogus framing → 400", async () => {
    clearSubmissionState();
    seedControlled("sess-F");
    const r = await postJson(
      "/actions/sessions/sess-F/submit-task",
      { body: "hello", framing: "hex-escapes", dry_run: true },
      { "Idempotency-Key": "sub-F-1" },
    );
    expect(r.status).toBe(400);
  });

  test("re-preview with same Idempotency-Key returns cached:true", async () => {
    clearSubmissionState();
    seedControlled("sess-G");
    const key = "sub-G-1";
    const first = await postJson(
      "/actions/sessions/sess-G/submit-task",
      { body: "hi", dry_run: true },
      { "Idempotency-Key": key },
    );
    expect(first.status).toBe(200);
    const second = await postJson(
      "/actions/sessions/sess-G/submit-task",
      { body: "hi", dry_run: true },
      { "Idempotency-Key": key },
    );
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
  });
});

describe("POST /actions/sessions/:id/submit-task — confirm (GSL-381)", () => {
  test("no prior preview → 428 preview-required (F16-S4)", async () => {
    clearSubmissionState();
    seedControlled("sess-H");
    const r = await postJson(
      "/actions/sessions/sess-H/submit-task",
      { body: "hi", dry_run: false },
      { "Idempotency-Key": "sub-H-1" },
    );
    expect(r.status).toBe(428);
    expect(r.body.reason).toBe("preview-required");
  });

  test("body_sha256 mismatch after preview → 428 preview-required", async () => {
    clearSubmissionState();
    seedControlled("sess-I");
    const key = "sub-I-1";
    await postJson(
      "/actions/sessions/sess-I/submit-task",
      { body: "hi", dry_run: true },
      { "Idempotency-Key": key },
    );
    const r = await postJson(
      "/actions/sessions/sess-I/submit-task",
      { body: "OTHER BODY", dry_run: false },
      { "Idempotency-Key": key },
    );
    expect(r.status).toBe(428);
    expect(r.body.reason).toBe("preview-required");
  });

  test("release-mid-submit — 409 session-not-controlled + released_mid_submit row + failed event (F16-S6, verifier M1)", async () => {
    clearSubmissionState();
    seedControlled("sess-J");
    const key = "sub-J-1";
    await postJson(
      "/actions/sessions/sess-J/submit-task",
      { body: "hi", framing: "none", dry_run: true },
      { "Idempotency-Key": key },
    );
    // Release control between preview and confirm.
    raw.query(`UPDATE session_control SET state='observer' WHERE session_id='sess-J'`).run();
    spawnCalls = [];
    const r = await postJson(
      "/actions/sessions/sess-J/submit-task",
      { body: "hi", framing: "none", dry_run: false },
      { "Idempotency-Key": key },
    );
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("session-not-controlled");
    // Verifier M1 (F16-S6 auditability per R16.6): one row was written with
    // outcome='released_mid_submit', pane_ref_at_dispatch is null, and body_sha+
    // body_len match the preview's captured values (no body text).
    const row = raw.query(
      `SELECT outcome, pane_ref_at_dispatch, body_len, framing, error FROM task_submissions WHERE session_id='sess-J'`,
    ).get() as {
      outcome: string;
      pane_ref_at_dispatch: string | null;
      body_len: number;
      framing: string;
      error: string | null;
    };
    expect(row.outcome).toBe("released_mid_submit");
    expect(row.pane_ref_at_dispatch).toBe(null);
    expect(row.body_len).toBe(2);
    expect(row.framing).toBe("none");
    expect(row.error).toContain("not under panel control");
    // No tmux spawn — the executor never runs on this path. Only lab-log spawns
    // are permitted (the failed-event emission).
    const tmuxCalls = spawnCalls.filter((c) => c[0] === "tmux");
    expect(tmuxCalls).toEqual([]);
    // The task.submit.failed timeline event was emitted via lab-log.sh with the right
    // kind and released_mid_submit outcome + non-null error in the --data-json payload.
    const labLogCalls = spawnCalls.filter(
      (c) => c[0] === "bash" && c[1].endsWith("/lab-log.sh"),
    );
    expect(labLogCalls.length).toBe(1);
    const argv = labLogCalls[0];
    const typeIdx = argv.indexOf("--type");
    expect(typeIdx).toBeGreaterThan(-1);
    expect(argv[typeIdx + 1]).toBe("task.submit.failed");
    const dataIdx = argv.indexOf("--data-json");
    expect(dataIdx).toBeGreaterThan(-1);
    const payload = JSON.parse(argv[dataIdx + 1] as string) as Record<string, unknown>;
    expect(payload.outcome).toBe("released_mid_submit");
    expect(payload.session_id).toBe("sess-J");
    expect(payload.pane_ref_at_dispatch).toBe(null);
    expect(payload.error).toBeTruthy();
  });

  test("pane_gone at confirm → 200 outcome=pane_gone, row inserted, no tmux spawn (F16-S5)", async () => {
    clearSubmissionState();
    seedControlled("sess-K");
    const key = "sub-K-1";
    await postJson(
      "/actions/sessions/sess-K/submit-task",
      { body: "hi", framing: "none", dry_run: true },
      { "Idempotency-Key": key },
    );
    // Simulate the pane going away between preview and confirm.
    raw.query(`DELETE FROM tmux_panes WHERE session_name='gsl378-target-sess-K'`).run();
    spawnCalls = [];
    const r = await postJson(
      "/actions/sessions/sess-K/submit-task",
      { body: "hi", framing: "none", dry_run: false },
      { "Idempotency-Key": key },
    );
    expect(r.status).toBe(200);
    const result = r.body.result as Record<string, unknown>;
    expect(result.outcome).toBe("pane_gone");
    // Filter to tmux calls only — GSL-382 fires an extra `lab-log.sh task.submit.failed`
    // spawn on every reachable-refusal outcome. tmux itself should NEVER be invoked.
    const tmuxCalls = spawnCalls.filter((c) => c[0] === "tmux");
    expect(tmuxCalls).toEqual([]);
    // One row landed.
    const row = raw.query(`SELECT outcome, body_sha256, body_len FROM task_submissions WHERE session_id='sess-K'`).get() as { outcome: string; body_sha256: string; body_len: number };
    expect(row.outcome).toBe("pane_gone");
    expect(row.body_len).toBe(2);
  });

  test("happy path — 200 outcome=delivered, row inserted, two tmux spawns (F16-S1)", async () => {
    clearSubmissionState();
    seedControlled("sess-L");
    const key = "sub-L-1";
    await postJson(
      "/actions/sessions/sess-L/submit-task",
      { body: "task body", framing: "none", dry_run: true },
      { "Idempotency-Key": key },
    );
    spawnCalls = [];
    const r = await postJson(
      "/actions/sessions/sess-L/submit-task",
      { body: "task body", framing: "none", dry_run: false },
      { "Idempotency-Key": key },
    );
    expect(r.status).toBe(200);
    const result = r.body.result as Record<string, unknown>;
    expect(result.outcome).toBe("delivered");
    // GSL-382 also fires `bash lab-log.sh task.submitted` after the executor. Filter
    // to tmux calls only for the send-keys assertion; assert lab-log fired separately.
    const tmuxCalls = spawnCalls.filter((c) => c[0] === "tmux");
    expect(tmuxCalls).toHaveLength(2);
    expect(tmuxCalls[0][1]).toBe("send-keys");
    expect(tmuxCalls[0].includes("-l")).toBe(true);
    expect(tmuxCalls[0][tmuxCalls[0].length - 1]).toBe("task body");
    expect(tmuxCalls[1][tmuxCalls[1].length - 1]).toBe("Enter");
    const labLogCalls = spawnCalls.filter(
      (c) => c[0] === "bash" && c[1].endsWith("lab-log.sh"),
    );
    expect(labLogCalls).toHaveLength(1);
    expect(labLogCalls[0].includes("task.submitted")).toBe(true);
    const row = raw.query(`SELECT outcome, body_sha256, body_len FROM task_submissions WHERE session_id='sess-L'`).get() as { outcome: string; body_sha256: string; body_len: number };
    expect(row.outcome).toBe("delivered");
    expect(row.body_len).toBe(9);
  });

  test("cached confirm replay — same submission_id, no duplicate row", async () => {
    clearSubmissionState();
    seedControlled("sess-M");
    const key = "sub-M-1";
    await postJson(
      "/actions/sessions/sess-M/submit-task",
      { body: "hi", framing: "none", dry_run: true },
      { "Idempotency-Key": key },
    );
    const first = await postJson(
      "/actions/sessions/sess-M/submit-task",
      { body: "hi", framing: "none", dry_run: false },
      { "Idempotency-Key": key },
    );
    expect(first.status).toBe(200);
    const firstResult = first.body.result as Record<string, unknown>;
    const firstId = firstResult.submission_id;
    // Second confirm with same key should return cached and the SAME submission_id.
    spawnCalls = [];
    const second = await postJson(
      "/actions/sessions/sess-M/submit-task",
      { body: "hi", framing: "none", dry_run: false },
      { "Idempotency-Key": key },
    );
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    const secondResult = second.body.result as Record<string, unknown>;
    expect(secondResult.submission_id).toBe(firstId);
    // Cached replay must NOT re-fire the executor OR the timeline event -- no tmux
    // spawns and no lab-log spawns.
    expect(spawnCalls).toEqual([]);
    const count = raw.query(`SELECT COUNT(*) AS c FROM task_submissions WHERE session_id='sess-M'`).get() as { c: number };
    expect(count.c).toBe(1);
  });
});

describe("Timeline event kinds (GSL-382)", () => {
  test("delivered outcome fires lab-log with type=task.submitted + body payload", async () => {
    clearSubmissionState();
    seedControlled("sess-tl-1");
    const key = "sub-tl-1";
    await postJson(
      "/actions/sessions/sess-tl-1/submit-task",
      { body: "run migration", framing: "none", dry_run: true },
      { "Idempotency-Key": key },
    );
    spawnCalls = [];
    await postJson(
      "/actions/sessions/sess-tl-1/submit-task",
      { body: "run migration", framing: "none", dry_run: false },
      { "Idempotency-Key": key },
    );
    const labLogCalls = spawnCalls.filter(
      (c) => c[0] === "bash" && c[1].endsWith("lab-log.sh"),
    );
    expect(labLogCalls).toHaveLength(1);
    // argv shape: [bash, lab-log.sh, --type, task.submitted, --actor, owner-web,
    //             --src, emit, --data-json, <json>]
    const typeIdx = labLogCalls[0].indexOf("--type");
    expect(labLogCalls[0][typeIdx + 1]).toBe("task.submitted");
    const dataIdx = labLogCalls[0].indexOf("--data-json");
    const payload = JSON.parse(labLogCalls[0][dataIdx + 1]) as Record<string, unknown>;
    expect(payload.session_id).toBe("sess-tl-1");
    expect(payload.outcome).toBe("delivered");
    expect(payload.body).toBe("run migration");
    expect(payload.body_len).toBe(13);
    expect(typeof payload.body_sha256).toBe("string");
    expect(payload.framing).toBe("none");
    expect(payload.error).toBeNull();
  });

  test("pane_gone outcome fires lab-log with type=task.submit.failed + error", async () => {
    clearSubmissionState();
    seedControlled("sess-tl-2");
    const key = "sub-tl-2";
    await postJson(
      "/actions/sessions/sess-tl-2/submit-task",
      { body: "hi", framing: "none", dry_run: true },
      { "Idempotency-Key": key },
    );
    raw.query(`DELETE FROM tmux_panes WHERE session_name='gsl378-target-sess-tl-2'`).run();
    spawnCalls = [];
    await postJson(
      "/actions/sessions/sess-tl-2/submit-task",
      { body: "hi", framing: "none", dry_run: false },
      { "Idempotency-Key": key },
    );
    const labLogCalls = spawnCalls.filter(
      (c) => c[0] === "bash" && c[1].endsWith("lab-log.sh"),
    );
    expect(labLogCalls).toHaveLength(1);
    const typeIdx = labLogCalls[0].indexOf("--type");
    expect(labLogCalls[0][typeIdx + 1]).toBe("task.submit.failed");
    const dataIdx = labLogCalls[0].indexOf("--data-json");
    const payload = JSON.parse(labLogCalls[0][dataIdx + 1]) as Record<string, unknown>;
    expect(payload.outcome).toBe("pane_gone");
    expect(payload.error).not.toBeNull();
  });
});

describe("GET /sessions/:id/submissions (GSL-381)", () => {
  test("returns rows newest-first with hash + byte-length only (no body)", async () => {
    clearSubmissionState();
    seedControlled("sess-N");
    for (let i = 0; i < 3; i += 1) {
      const key = `sub-N-${i}`;
      await postJson(
        "/actions/sessions/sess-N/submit-task",
        { body: `task ${i}`, framing: "none", dry_run: true },
        { "Idempotency-Key": key },
      );
      await postJson(
        "/actions/sessions/sess-N/submit-task",
        { body: `task ${i}`, framing: "none", dry_run: false },
        { "Idempotency-Key": key },
      );
    }
    const r = await getJson("/sessions/sess-N/submissions");
    expect(r.status).toBe(200);
    const submissions = r.body.submissions as Array<Record<string, unknown>>;
    expect(submissions.length).toBe(3);
    // Newest first — every row has ts, and they are sorted DESC.
    for (let i = 1; i < submissions.length; i += 1) {
      expect(
        (submissions[i - 1].ts as string) >= (submissions[i].ts as string),
      ).toBe(true);
    }
    // No body text on any row — only body_sha256 + body_len.
    for (const sub of submissions) {
      expect("body" in sub).toBe(false);
      expect(typeof sub.body_sha256).toBe("string");
      expect(typeof sub.body_len).toBe("number");
    }
  });

  test("empty history returns empty array", async () => {
    clearSubmissionState();
    const r = await getJson("/sessions/sess-none/submissions");
    expect(r.status).toBe(200);
    expect((r.body.submissions as unknown[]).length).toBe(0);
  });
});
