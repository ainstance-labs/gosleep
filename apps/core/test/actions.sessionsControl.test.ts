// @gosleep/core — /actions/sessions/:id/take-control + /release-control HTTP tests (GSL-361).
//
// Pins the wire-level behaviour these endpoints must maintain:
//
//   1. take-control on a shim-registered observer row → 200 with state='controlled'.
//   2. take-control on an unknown session_id → 404.
//   3. take-control on a shim_registered=0 row → 409 (R15.7).
//   4. release-control on env-locked row → 409 (R15.3).
//   5. release-control on a runtime-controlled row → 200 with state='observer'.
//   6. Double take-control with same Idempotency-Key returns a cached replay (no double event).
//
// Boot pattern mirrors actions.decidePermission.sse.test.ts + internal.test.ts: scratch
// in-memory SQLite, `mock.module` swaps db/client + Bearer secret, then the Hono routes are
// imported and mounted. We stub out `actions/spawn.ts` too so `fireControlTimelineEvent`
// (which spawns lab-log.sh) does not shell out during the test.

import { beforeAll, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";

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
  activated_at TEXT,
  activated_by TEXT,
  deactivated_at TEXT,
  shim_registered INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TEXT,
  last_heartbeat_pid INTEGER
);`);
const scratchDb = drizzle(raw, { schema });
const openedDb: OpenedDb = { db: scratchDb, raw, path: ":memory:" };

mock.module("../src/db/client.ts", () => ({
  getDb: () => openedDb,
  openDatabase: () => openedDb,
  defaultDbPath: () => ":memory:",
  schema,
}));

// Bearer stub — every actions route calls requireBearer, which loads the effective secret via
// authSource.resolveAuthSource(). Point it at a static secret to keep the test hermetic.
mock.module("../src/security/authSource.ts", () => ({
  resolveAuthSource: async () => ({
    secret: "test-token",
    source: "dev-env",
  }),
  writeAuthSourceAudit: async () => {
    /* no-op */
  },
  recordAuthSource: () => {
    /* no-op */
  },
}));

// Prevent the timeline event helper from actually spawning bash.
mock.module("../src/actions/spawn.ts", () => ({
  REPO_ROOT: "/tmp",
  spawnAwait: async () => ({
    ok: true,
    code: 0,
    stdout: "",
    stderr: "",
    elapsedMs: 1,
    timedOut: false,
  }),
  spawnDetached: () => ({ pid: 0 }),
}));

// Bring in the routes AFTER the mocks so the imports resolve to the stubbed modules.
const { actionsRoutes } = await import("../src/routes/actions.ts");
const { requireLocalHost } = await import("../src/security/host.ts");
const { requireLocalOrigin } = await import("../src/security/origin.ts");

const app = new Hono();
app.use("*", requireLocalHost);
app.use("*", requireLocalOrigin);
app.route("/", actionsRoutes);

function insertRow(sessionId: string, opts: {
  state?: "observer" | "controlled";
  source?: "env" | "runtime" | "inherited";
  shim_registered?: 0 | 1;
} = {}): void {
  const state = opts.state ?? "observer";
  const source = opts.source ?? "runtime";
  const shim = opts.shim_registered ?? 0;
  raw
    .query(
      `INSERT INTO session_control (session_id, state, source, shim_registered, activated_at, activated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      state,
      source,
      shim,
      state === "controlled" ? new Date().toISOString() : null,
      state === "controlled" ? (source === "env" ? "shim-env" : "owner-web") : null,
    );
}

const BASE_HEADERS: Record<string, string> = {
  Host: "127.0.0.1:7331",
  Origin: "http://127.0.0.1:7331",
  Authorization: "Bearer test-token",
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
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("POST /actions/sessions/:session_id/take-control (GSL-361)", () => {
  beforeAll(() => {
    // Nothing global — each test seeds its own rows.
  });

  test("observer + shim_registered → 200, state=controlled/runtime, changed:true", async () => {
    insertRow("sess-A", { state: "observer", shim_registered: 1 });
    const res = await postJson(
      "/actions/sessions/sess-A/take-control",
      { by: "owner-web", channel: "web" },
      { "Idempotency-Key": "take-A-1" },
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const result = res.body.result as Record<string, unknown>;
    expect(result.state).toBe("controlled");
    expect(result.source).toBe("runtime");
    expect(result.changed).toBe(true);
  });

  test("unknown session_id → 404", async () => {
    const res = await postJson(
      "/actions/sessions/sess-nonexistent/take-control",
      { by: "owner-web" },
      { "Idempotency-Key": "take-missing-1" },
    );
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  test("shim_registered=0 → 409 (R15.7)", async () => {
    insertRow("sess-noshim", { state: "observer", shim_registered: 0 });
    const res = await postJson(
      "/actions/sessions/sess-noshim/take-control",
      { by: "owner-web" },
      { "Idempotency-Key": "take-noshim-1" },
    );
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
  });

  test("same Idempotency-Key replays as cached", async () => {
    insertRow("sess-idem", { state: "observer", shim_registered: 1 });
    const key = "take-idem-1";
    const first = await postJson(
      "/actions/sessions/sess-idem/take-control",
      { by: "owner-web" },
      { "Idempotency-Key": key },
    );
    expect(first.status).toBe(200);
    const second = await postJson(
      "/actions/sessions/sess-idem/take-control",
      { by: "owner-web" },
      { "Idempotency-Key": key },
    );
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.intent_id).toBe(key);
  });
});

describe("POST /actions/sessions/:session_id/release-control (GSL-361)", () => {
  test("env-locked → 409 (R15.3)", async () => {
    insertRow("sess-envlock", {
      state: "controlled",
      source: "env",
      shim_registered: 1,
    });
    const res = await postJson(
      "/actions/sessions/sess-envlock/release-control",
      { by: "owner-web" },
      { "Idempotency-Key": "rel-envlock-1" },
    );
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    // Row unchanged.
    const row = raw
      .query("SELECT state, source FROM session_control WHERE session_id = 'sess-envlock'")
      .get() as { state: string; source: string };
    expect(row.state).toBe("controlled");
    expect(row.source).toBe("env");
  });

  test("controlled/runtime → 200, state=observer, deactivated_at stamped", async () => {
    insertRow("sess-rel", {
      state: "controlled",
      source: "runtime",
      shim_registered: 1,
    });
    const res = await postJson(
      "/actions/sessions/sess-rel/release-control",
      { by: "owner-web" },
      { "Idempotency-Key": "rel-rel-1" },
    );
    expect(res.status).toBe(200);
    const result = res.body.result as Record<string, unknown>;
    expect(result.state).toBe("observer");
    expect(result.changed).toBe(true);
    expect(result.deactivated_at).not.toBeNull();
  });

  test("already observer → 200, changed:false (idempotent)", async () => {
    insertRow("sess-obs", { state: "observer", shim_registered: 1 });
    const res = await postJson(
      "/actions/sessions/sess-obs/release-control",
      { by: "owner-web" },
      { "Idempotency-Key": "rel-obs-1" },
    );
    expect(res.status).toBe(200);
    const result = res.body.result as Record<string, unknown>;
    expect(result.changed).toBe(false);
  });
});
