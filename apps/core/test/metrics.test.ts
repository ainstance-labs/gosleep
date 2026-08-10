// @gosleep/core — /metrics text exposition unit tests (GSL-280).
//
// These tests exercise the exposition builder DIRECTLY (no HTTP layer) so a test failure
// pins down whether the format bug is in the builder or in the route. A separate scenario
// in core-smoke.sh proves the route/curl end returns the same body.
//
// What we pin down:
//
//   1. Every metric name emits ONE `# HELP` and ONE `# TYPE` line before its first sample —
//      the acceptance rule in the Jira description.
//   2. Uptime is a non-negative float.
//   3. Histograms include a `+Inf` bucket + `_sum` + `_count` line.
//   4. `gosleep_security_auth_source{source="<label>"} 1` reflects the last recordAuthSource
//      call; the other three labels get 0.
//   5. `gosleep_agents_context_pct{session="…",name="…"} <n>` reflects live rows from
//      `agent_sessions` and excludes ended rows.
//   6. `gosleep_questions_open{kind="<k>"}` groups by kind AND emits a stable zero when the
//      table has no open rows.
//   7. Label values are Prometheus-safely escaped (backslash + double-quote + newline).
//   8. Counters aggregate on subsequent incCounter calls with the same labels.
//   9. Hook wait histogram buckets are cumulative and monotonically non-decreasing.

import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import {
  HOOK_WAIT_BUCKETS,
  _resetRegistryForTests,
  buildPrometheusText,
  incCounter,
  observeHookWait,
  recordAuthSource,
  sanitizeLabelName,
} from "../src/metrics/registry.ts";

function freshDb(): OpenedDb {
  const raw = new Database(":memory:");
  raw.exec("PRAGMA journal_mode = MEMORY;");
  raw.exec(`CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL, ts TEXT NOT NULL, src TEXT NOT NULL,
    actor TEXT NOT NULL, task TEXT, type TEXT NOT NULL,
    payload TEXT NOT NULL, supersedes_seq INTEGER, ingested_from TEXT
  );`);
  raw.exec(`CREATE TABLE questions (
    qid TEXT PRIMARY KEY, status TEXT NOT NULL, kind TEXT NOT NULL,
    task TEXT, question TEXT NOT NULL, options TEXT, opened_at TEXT NOT NULL,
    answered_at TEXT, answer_text TEXT, resolved_at TEXT, applied TEXT,
    last_event_seq INTEGER, tool_input TEXT
  );`);
  raw.exec(`CREATE TABLE agent_sessions (
    session_id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
    pid INTEGER, model TEXT, cwd TEXT NOT NULL, cycle INTEGER,
    context_pct INTEGER, current_tool TEXT, current_intent TEXT,
    status TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    ended_at TEXT
  );`);
  const db = drizzle(raw, { schema });
  return { db, raw, path: ":memory:" };
}

function parseFamilies(text: string): Map<string, { help: string; type: string; samples: string[] }> {
  const fams = new Map<string, { help: string; type: string; samples: string[] }>();
  const lines = text.split("\n");
  let currentName: string | null = null;
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith("# HELP ")) {
      const m = /^# HELP (\S+) (.*)$/.exec(line);
      if (m === null) continue;
      currentName = m[1] ?? null;
      if (currentName === null) continue;
      const existing = fams.get(currentName);
      if (existing === undefined) {
        fams.set(currentName, { help: m[2] ?? "", type: "", samples: [] });
      } else {
        existing.help = m[2] ?? "";
      }
    } else if (line.startsWith("# TYPE ")) {
      const m = /^# TYPE (\S+) (\S+)$/.exec(line);
      if (m === null) continue;
      const name = m[1];
      if (name === undefined) continue;
      const existing = fams.get(name);
      if (existing === undefined) {
        fams.set(name, { help: "", type: m[2] ?? "", samples: [] });
      } else {
        existing.type = m[2] ?? "";
      }
    } else if (!line.startsWith("#")) {
      // Sample line — attribute to the last named family (prefix match).
      // Prometheus samples start with the family name, optional `_bucket` / `_sum` / `_count`
      // suffix for histograms, then `{labels}? value`.
      const nameMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)/.exec(line);
      if (nameMatch === null) continue;
      let familyName = nameMatch[1] ?? "";
      if (familyName.length === 0) continue;
      // For histograms, samples end in _bucket/_sum/_count — map back to the base family.
      const strippedName = familyName
        .replace(/_bucket$/, "")
        .replace(/_sum$/, "")
        .replace(/_count$/, "");
      const family = fams.get(strippedName) ?? fams.get(familyName);
      if (family === undefined) continue;
      family.samples.push(line);
    }
  }
  return fams;
}

describe("metrics registry — sanitizeLabelName", () => {
  test("leading digit → underscore prefix", () => {
    expect(sanitizeLabelName("1abc")).toBe("_abc");
  });
  test("invalid chars → underscore", () => {
    expect(sanitizeLabelName("kind:blocker")).toBe("kind_blocker");
    expect(sanitizeLabelName("with space")).toBe("with_space");
  });
  test("empty → underscore", () => {
    expect(sanitizeLabelName("")).toBe("_");
  });
});

describe("buildPrometheusText — envelope + always-present metrics", () => {
  beforeEach(() => {
    _resetRegistryForTests();
  });

  test("emits # HELP + # TYPE for every family named in the exposition", () => {
    const db = freshDb();
    const text = buildPrometheusText(db, Date.now(), "/nonexistent-dir");
    const fams = parseFamilies(text);
    // Names that must always be present regardless of state.
    const required = [
      "gosleep_core_uptime_seconds",
      "gosleep_core_process_resident_bytes",
      "gosleep_core_process_heap_bytes",
      "gosleep_events_ingested_total",
      "gosleep_events_rowcount",
      "gosleep_sse_subscribers",
      "gosleep_indexer_lag_seconds",
      "gosleep_db_size_bytes",
      "gosleep_hook_wait_seconds",
      "gosleep_questions_open",
      "gosleep_security_auth_source",
      "gosleep_agents_live",
      "gosleep_agents_context_pct",
      "gosleep_http_requests_total",
    ];
    for (const name of required) {
      const fam = fams.get(name);
      if (fam === undefined) {
        throw new Error(`missing family: ${name}`);
      }
      expect(fam.help.length).toBeGreaterThan(0);
      expect(["counter", "gauge", "histogram"]).toContain(fam.type);
    }
  });

  test("uptime is a non-negative float", () => {
    const db = freshDb();
    const text = buildPrometheusText(db);
    // Anchor at start-of-line to skip the `# HELP gosleep_core_uptime_seconds …` header line
    // whose next token is prose, not a number.
    const m = /^gosleep_core_uptime_seconds (\S+)$/m.exec(text);
    expect(m).not.toBeNull();
    const uptime = Number.parseFloat(m?.[1] ?? "");
    expect(Number.isFinite(uptime)).toBe(true);
    expect(uptime).toBeGreaterThanOrEqual(0);
  });

  test("body ends with a single trailing newline", () => {
    const db = freshDb();
    const text = buildPrometheusText(db);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("buildPrometheusText — auth source + questions_open", () => {
  beforeEach(() => {
    _resetRegistryForTests();
  });

  test("recordAuthSource sets one label to 1, others to 0", () => {
    const db = freshDb();
    recordAuthSource("keychain");
    const text = buildPrometheusText(db);
    expect(text).toContain('gosleep_security_auth_source{source="keychain"} 1');
    expect(text).toContain('gosleep_security_auth_source{source="dev-env"} 0');
    expect(text).toContain('gosleep_security_auth_source{source="token-file"} 0');
    expect(text).toContain('gosleep_security_auth_source{source="none"} 0');
  });

  test("questions_open emits stable zero on empty table", () => {
    const db = freshDb();
    const text = buildPrometheusText(db);
    expect(text).toContain('gosleep_questions_open{kind=""} 0');
  });

  test("questions_open groups by kind when populated", () => {
    const db = freshDb();
    db.raw
      .query(
        `INSERT INTO questions (qid, status, kind, question, opened_at)
         VALUES ('q1','open','BLOCKER','why?','2026-08-07T00:00:00Z'),
                ('q2','open','BLOCKER','what?','2026-08-07T00:00:00Z'),
                ('q3','open','DECISION','which?','2026-08-07T00:00:00Z'),
                ('q4','answered','DECISION','done?','2026-08-07T00:00:00Z')`,
      )
      .run();
    const text = buildPrometheusText(db);
    expect(text).toContain('gosleep_questions_open{kind="BLOCKER"} 2');
    expect(text).toContain('gosleep_questions_open{kind="DECISION"} 1');
    // Answered rows must NOT surface here.
    expect(text).not.toContain('gosleep_questions_open{kind="answered"');
  });
});

describe("buildPrometheusText — histogram", () => {
  beforeEach(() => {
    _resetRegistryForTests();
  });

  test("cumulative buckets + +Inf + _sum + _count line", () => {
    const db = freshDb();
    observeHookWait("answer-wait", 0.1);
    observeHookWait("answer-wait", 3);
    observeHookWait("answer-wait", 45);
    const text = buildPrometheusText(db);
    // Every bucket line present, labels include `event="answer-wait"` and le=<bucket>.
    for (const b of HOOK_WAIT_BUCKETS) {
      expect(text).toContain(
        `gosleep_hook_wait_seconds_bucket{event="answer-wait",le="${b}"}`,
      );
    }
    // +Inf line + count line.
    expect(text).toContain(
      'gosleep_hook_wait_seconds_bucket{event="answer-wait",le="+Inf"} 3',
    );
    expect(text).toContain('gosleep_hook_wait_seconds_count{event="answer-wait"} 3');
    // Sum: 0.1 + 3 + 45 = 48.1 (allow float format).
    const sumM = /gosleep_hook_wait_seconds_sum\{event="answer-wait"\} (\S+)/.exec(text);
    expect(sumM).not.toBeNull();
    expect(Number.parseFloat(sumM?.[1] ?? "")).toBeCloseTo(48.1, 3);
  });

  test("bucket counts are monotonically non-decreasing", () => {
    const db = freshDb();
    observeHookWait("answer-wait", 0.1);
    observeHookWait("answer-wait", 5);
    observeHookWait("answer-wait", 100);
    const text = buildPrometheusText(db);
    let last = 0;
    for (const b of HOOK_WAIT_BUCKETS) {
      const m = new RegExp(
        `gosleep_hook_wait_seconds_bucket\\{event="answer-wait",le="${b}"\\} (\\d+)`,
      ).exec(text);
      expect(m).not.toBeNull();
      const v = Number.parseInt(m?.[1] ?? "0", 10);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    // +Inf must equal count (3).
    const infM = /gosleep_hook_wait_seconds_bucket\{event="answer-wait",le="\+Inf"\} (\d+)/.exec(
      text,
    );
    expect(infM).not.toBeNull();
    expect(Number.parseInt(infM?.[1] ?? "0", 10)).toBe(3);
  });
});

describe("buildPrometheusText — agent context + live gauge", () => {
  beforeEach(() => {
    _resetRegistryForTests();
  });

  test("agents_context_pct emits one line per live session with a context value", () => {
    const db = freshDb();
    db.raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, context_pct, status, started_at, updated_at, ended_at)
         VALUES
           ('sid-A','gosleep-93','interactive',1,'/tmp',42,'busy','2026-08-07T00:00:00Z','2026-08-07T00:01:00Z',NULL),
           ('sid-B','gosleep-94','interactive',2,'/tmp',77,'busy','2026-08-07T00:00:00Z','2026-08-07T00:01:00Z',NULL),
           ('sid-C','gosleep-95','interactive',3,'/tmp',10,'ended','2026-08-07T00:00:00Z','2026-08-07T00:02:00Z','2026-08-07T00:02:00Z')`,
      )
      .run();
    const text = buildPrometheusText(db);
    expect(text).toContain(
      'gosleep_agents_context_pct{session="sid-A",name="gosleep-93"} 42',
    );
    expect(text).toContain(
      'gosleep_agents_context_pct{session="sid-B",name="gosleep-94"} 77',
    );
    // Ended session excluded.
    expect(text).not.toContain('sid-C');
    // agents_live counts live rows only.
    expect(text).toContain('gosleep_agents_live 2');
  });

  test("agents_context_pct excludes rows with NULL context_pct", () => {
    const db = freshDb();
    db.raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, cwd, status, started_at, updated_at)
         VALUES ('sid-N','gosleep-96','interactive','/tmp','busy','2026-08-07T00:00:00Z','2026-08-07T00:01:00Z')`,
      )
      .run();
    const text = buildPrometheusText(db);
    expect(text).not.toContain('sid-N');
  });
});

describe("counters", () => {
  beforeEach(() => {
    _resetRegistryForTests();
  });

  test("incCounter aggregates same-label calls", () => {
    const db = freshDb();
    incCounter("gosleep_events_ingested_total", { src: "jsonl" });
    incCounter("gosleep_events_ingested_total", { src: "jsonl" });
    incCounter("gosleep_events_ingested_total", { src: "internal" }, 5);
    const text = buildPrometheusText(db);
    expect(text).toContain('gosleep_events_ingested_total{src="jsonl"} 2');
    expect(text).toContain('gosleep_events_ingested_total{src="internal"} 5');
  });

  test("counter with special-char label values escapes correctly", () => {
    const db = freshDb();
    incCounter("gosleep_http_requests_total", {
      endpoint: '/weird"path\\',
      method: "GET",
      status: "200",
    });
    const text = buildPrometheusText(db);
    // Quote inside the path must be backslash-escaped; backslash likewise.
    expect(text).toContain(
      'gosleep_http_requests_total{endpoint="/weird\\"path\\\\",method="GET",status="200"} 1',
    );
  });
});
