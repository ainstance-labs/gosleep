// @gosleep/core — in-process metrics registry (GSL-280 / rev-3 addendum Delta 7).
//
// Small counter/histogram/gauge registry the /metrics route reads from. Deliberately hand-rolled
// (no prom-client dep) — the whole exposition is <10 metric families and we own every emit site
// in this process. Adding a dep for that would be more risk than value.
//
// STATE MODEL.
//   - Counters and histograms live in module-scope Maps that persist for the lifetime of the
//     process. On restart they reset — matched by process-start timestamps in the exposition
//     (`gosleep_core_uptime_seconds` starts at 0 after a restart, so a Prometheus/Warren scraper
//     that alerts on rate() sees a fresh series either way).
//   - Gauges without a natural in-process backing (auth-source label) are set by the module
//     that computes them (security/authSource.ts calls recordAuthSource on boot).
//
// The exposition (buildPrometheusText()) is a synchronous read of everything the registry
// knows plus a few live queries. Kept synchronous so a scrape does not perturb the request
// path — bun:sqlite queries are synchronous anyway.
//
// FORMAT rules (Prometheus text exposition 0.0.4):
//   - Every metric name has one # HELP line and one # TYPE line.
//   - Label values are escaped: `\\`, `\"`, `\n`.
//   - Label names are [a-zA-Z_][a-zA-Z0-9_]*; call sites either use known-safe names or route
//     through `sanitizeLabelName()`.
//   - Histogram buckets are cumulative with `le=` boundaries + `le="+Inf"` last; a `_sum` and
//     `_count` line closes each histogram family.

import type { OpenedDb } from "../db/client.ts";
import { broadcaster } from "../sse/broadcaster.ts";

/** Process-wide start time; boot uptime derives from this. */
const PROCESS_START_MS = Date.now();

// -----------------------------------------------------------------------------
// counters — Map<name+labelKey, {value, labels}>
// -----------------------------------------------------------------------------

interface CounterSample {
  value: number;
  labels: Record<string, string>;
}

/** Counter families: name → Map<labelKey, sample>. `labelKey` is deterministic
 *  (JSON of sorted labels) so a re-observation with the same labels aggregates. */
const counters = new Map<string, Map<string, CounterSample>>();

function ensureCounter(name: string): Map<string, CounterSample> {
  const existing = counters.get(name);
  if (existing !== undefined) return existing;
  const fresh = new Map<string, CounterSample>();
  counters.set(name, fresh);
  return fresh;
}

function labelKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

/** Bump the named counter by `by` (default 1) with the given labels. */
export function incCounter(
  name: string,
  labels: Record<string, string> = {},
  by = 1,
): void {
  const fam = ensureCounter(name);
  const key = labelKey(labels);
  const existing = fam.get(key);
  if (existing === undefined) {
    fam.set(key, { value: by, labels: { ...labels } });
  } else {
    existing.value += by;
  }
}

// -----------------------------------------------------------------------------
// histograms — hook_wait_seconds is the only one v1
// -----------------------------------------------------------------------------

/** Bucket boundaries (upper inclusive) for `gosleep_hook_wait_seconds` — chosen for the
 *  answer-loop long-poll from GSL-275 (default 600 s, ceiling 1800 s). Coarser than a
 *  typical HTTP histogram because we care about SECONDS-to-minutes ranges, not sub-second. */
const HOOK_WAIT_BUCKETS = [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1200, 1800] as const;

interface HistogramSample {
  labels: Record<string, string>;
  /** Cumulative counts per bucket index (same length as HOOK_WAIT_BUCKETS). */
  bucketCounts: number[];
  /** +Inf bucket count (i.e. count of all observations). */
  countAll: number;
  /** Sum of all observed values (seconds). */
  sum: number;
}

const histograms = new Map<string, Map<string, HistogramSample>>();

function ensureHistogram(name: string): Map<string, HistogramSample> {
  const existing = histograms.get(name);
  if (existing !== undefined) return existing;
  const fresh = new Map<string, HistogramSample>();
  histograms.set(name, fresh);
  return fresh;
}

/**
 * Observe a `hook_wait_seconds` sample. `event` labels the caller (answer-wait /
 * agents-tool-observed / …). Cumulative buckets update in-place.
 */
export function observeHookWait(event: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const name = "gosleep_hook_wait_seconds";
  const fam = ensureHistogram(name);
  const labels = { event };
  const key = labelKey(labels);
  let sample = fam.get(key);
  if (sample === undefined) {
    sample = {
      labels,
      bucketCounts: HOOK_WAIT_BUCKETS.map(() => 0),
      countAll: 0,
      sum: 0,
    };
    fam.set(key, sample);
  }
  sample.countAll += 1;
  sample.sum += seconds;
  for (let i = 0; i < HOOK_WAIT_BUCKETS.length; i++) {
    if (seconds <= HOOK_WAIT_BUCKETS[i]!) {
      sample.bucketCounts[i] = (sample.bucketCounts[i] ?? 0) + 1;
    }
  }
}

// -----------------------------------------------------------------------------
// gauge: current auth-source label (set by security/authSource.ts)
// -----------------------------------------------------------------------------

/**
 * Emit as `gosleep_security_auth_source{source="<label>"} 1` — one label active at a time,
 * others 0. This mirrors the way node_exporter emits build_info-style state gauges.
 */
let currentAuthSource: string | null = null;

export function recordAuthSource(label: string): void {
  currentAuthSource = label;
}

// -----------------------------------------------------------------------------
// exposition builder
// -----------------------------------------------------------------------------

interface Help {
  help: string;
  type: "counter" | "gauge" | "histogram";
}

/** HELP/TYPE headers for every metric family we may emit. */
const META: Record<string, Help> = {
  gosleep_core_uptime_seconds: {
    help: "Seconds since gosleep-core process start.",
    type: "gauge",
  },
  gosleep_core_process_resident_bytes: {
    help: "Resident set size in bytes (Bun.jsc.getMemoryUsage or process.memoryUsage fallback).",
    type: "gauge",
  },
  gosleep_core_process_heap_bytes: {
    help: "Heap size in bytes (process.memoryUsage().heapUsed).",
    type: "gauge",
  },
  gosleep_events_ingested_total: {
    help: "Total events ingested, grouped by source (jsonl importer / direct write / hook / poll).",
    type: "counter",
  },
  gosleep_events_rowcount: {
    help: "Row count in the events table (approximation of ingested_total for scrape gap coverage).",
    type: "gauge",
  },
  gosleep_sse_subscribers: {
    help: "Current SSE subscribers (from the in-process broadcaster).",
    type: "gauge",
  },
  gosleep_indexer_lag_seconds: {
    help: "Seconds between the most recently indexed event ts and the newest events/*.jsonl mtime.",
    type: "gauge",
  },
  gosleep_db_size_bytes: {
    help: "SQLite main DB file size in bytes (WAL not included; -wal and -shm live alongside).",
    type: "gauge",
  },
  gosleep_hook_wait_seconds: {
    help: "Histogram of long-poll wait durations for /internal/questions/:qid/answer-wait and siblings.",
    type: "histogram",
  },
  gosleep_questions_open: {
    help: "Questions in status='open', grouped by kind.",
    type: "gauge",
  },
  gosleep_security_auth_source: {
    help: "1 for the currently active auth source label; 0 for the others (see security/authSource.ts).",
    type: "gauge",
  },
  gosleep_agents_context_pct: {
    help: "context_pct per live agent session (from agent_sessions; sessions with ended_at set are excluded).",
    type: "gauge",
  },
  gosleep_agents_live: {
    help: "Number of agent_sessions rows with ended_at IS NULL.",
    type: "gauge",
  },
  gosleep_http_requests_total: {
    help: "Total HTTP requests observed at the request middleware layer, grouped by endpoint + method + status.",
    type: "counter",
  },
};

const KNOWN_AUTH_SOURCES = ["dev-env", "keychain", "token-file", "none"] as const;

/**
 * Escape one label value per Prometheus spec: backslash, double-quote, LF.
 */
function escapeLabelValue(v: string): string {
  return v.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

/**
 * Sanitise a label name to Prometheus's [a-zA-Z_][a-zA-Z0-9_]* — used for names that come from
 * runtime data (event.src values, question.kind values). Anything invalid becomes `_`.
 */
export function sanitizeLabelName(raw: string): string {
  if (raw.length === 0) return "_";
  const first = raw[0]!;
  const head = /^[a-zA-Z_]/.test(first) ? first : "_";
  const rest = raw.slice(1).replaceAll(/[^a-zA-Z0-9_]/g, "_");
  return head + rest;
}

function renderLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const parts = entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`);
  return `{${parts.join(",")}}`;
}

/**
 * Build the Prometheus 0.0.4 text exposition. Called from routes/metrics.ts on every GET.
 * Also takes the DB handle (queries events/questions/agent_sessions) and the current time so
 * tests can freeze it.
 */
export function buildPrometheusText(
  db: OpenedDb,
  nowMs: number = Date.now(),
  events_dir?: string,
): string {
  const lines: string[] = [];

  const writeMeta = (name: string): void => {
    const meta = META[name];
    if (meta === undefined) return;
    lines.push(`# HELP ${name} ${meta.help}`);
    lines.push(`# TYPE ${name} ${meta.type}`);
  };

  // 1. uptime + memory
  writeMeta("gosleep_core_uptime_seconds");
  lines.push(`gosleep_core_uptime_seconds ${((nowMs - PROCESS_START_MS) / 1000).toFixed(3)}`);

  const mem = process.memoryUsage();
  writeMeta("gosleep_core_process_resident_bytes");
  lines.push(`gosleep_core_process_resident_bytes ${mem.rss}`);
  writeMeta("gosleep_core_process_heap_bytes");
  lines.push(`gosleep_core_process_heap_bytes ${mem.heapUsed}`);

  // 2. events_ingested_total {src}  — from counter registry (empty on fresh boot; DB row-count
  //    gauge picks up the historical slack across scrape gaps).
  writeMeta("gosleep_events_ingested_total");
  const ingested = counters.get("gosleep_events_ingested_total");
  if (ingested === undefined || ingested.size === 0) {
    // Emit an empty family per Prometheus best practice: help+type present, no samples until
    // the first ingest lands.
  } else {
    for (const s of ingested.values()) {
      lines.push(`gosleep_events_ingested_total${renderLabels(s.labels)} ${s.value}`);
    }
  }

  // Historical rowcount from SQL — a scrape landing before the first ingest counter fires
  // still sees a real number.
  try {
    const rowcount = db.raw.query("SELECT count(*) AS n FROM events").get() as { n: number };
    writeMeta("gosleep_events_rowcount");
    lines.push(`gosleep_events_rowcount ${rowcount.n}`);
  } catch {
    /* table missing (fresh test DB) */
  }

  // 3. sse subscribers
  writeMeta("gosleep_sse_subscribers");
  lines.push(`gosleep_sse_subscribers ${broadcaster.subscriberCount()}`);

  // 4. indexer lag — max(events.ts) vs newest events/*.jsonl mtime.
  writeMeta("gosleep_indexer_lag_seconds");
  const lagSec = computeIndexerLagSeconds(db, nowMs, events_dir);
  // NaN / null → emit -1 so an alert can distinguish "no data" from 0.
  lines.push(
    `gosleep_indexer_lag_seconds ${lagSec === null ? -1 : lagSec.toFixed(3)}`,
  );

  // 5. DB size
  writeMeta("gosleep_db_size_bytes");
  const dbSize = statDbSize(db.path);
  lines.push(`gosleep_db_size_bytes ${dbSize}`);

  // 6. hook_wait histogram
  writeMeta("gosleep_hook_wait_seconds");
  const hookWait = histograms.get("gosleep_hook_wait_seconds");
  if (hookWait !== undefined) {
    for (const sample of hookWait.values()) {
      for (let i = 0; i < HOOK_WAIT_BUCKETS.length; i++) {
        const bucketLabels = { ...sample.labels, le: String(HOOK_WAIT_BUCKETS[i]) };
        lines.push(
          `gosleep_hook_wait_seconds_bucket${renderLabels(bucketLabels)} ${sample.bucketCounts[i] ?? 0}`,
        );
      }
      const infLabels = { ...sample.labels, le: "+Inf" };
      lines.push(
        `gosleep_hook_wait_seconds_bucket${renderLabels(infLabels)} ${sample.countAll}`,
      );
      lines.push(
        `gosleep_hook_wait_seconds_sum${renderLabels(sample.labels)} ${sample.sum.toFixed(3)}`,
      );
      lines.push(
        `gosleep_hook_wait_seconds_count${renderLabels(sample.labels)} ${sample.countAll}`,
      );
    }
  }

  // 7. questions_open{kind}
  writeMeta("gosleep_questions_open");
  try {
    const rows = db.raw
      .query(
        "SELECT kind, count(*) AS n FROM questions WHERE status = 'open' GROUP BY kind",
      )
      .all() as Array<{ kind: string; n: number }>;
    if (rows.length === 0) {
      // Emit a stable-labelled zero so alerts can `sum(gosleep_questions_open) or vector(0)`.
      lines.push('gosleep_questions_open{kind=""} 0');
    } else {
      for (const r of rows) {
        lines.push(
          `gosleep_questions_open{kind="${escapeLabelValue(r.kind ?? "")}"} ${r.n}`,
        );
      }
    }
  } catch {
    /* questions table missing */
  }

  // 8. security_auth_source — one label active at a time, others 0.
  writeMeta("gosleep_security_auth_source");
  const active = currentAuthSource;
  for (const label of KNOWN_AUTH_SOURCES) {
    lines.push(
      `gosleep_security_auth_source{source="${label}"} ${active === label ? 1 : 0}`,
    );
  }

  // 9. agent_sessions — one gauge per live session (labelled by session_id + name).
  writeMeta("gosleep_agents_live");
  try {
    const liveCount = db.raw
      .query("SELECT count(*) AS n FROM agent_sessions WHERE ended_at IS NULL")
      .get() as { n: number };
    lines.push(`gosleep_agents_live ${liveCount.n}`);
  } catch {
    /* agent_sessions table missing */
  }

  writeMeta("gosleep_agents_context_pct");
  try {
    const rows = db.raw
      .query(
        `SELECT session_id, name, context_pct FROM agent_sessions
         WHERE ended_at IS NULL AND context_pct IS NOT NULL
         ORDER BY updated_at DESC LIMIT 32`,
      )
      .all() as Array<{ session_id: string; name: string; context_pct: number | null }>;
    for (const r of rows) {
      if (r.context_pct === null) continue;
      const labels = {
        session: escapeLabelValue(r.session_id),
        name: escapeLabelValue(r.name ?? ""),
      };
      lines.push(
        `gosleep_agents_context_pct{session="${labels.session}",name="${labels.name}"} ${r.context_pct}`,
      );
    }
  } catch {
    /* agent_sessions table missing */
  }

  // 10. http_requests_total {endpoint,method,status}
  writeMeta("gosleep_http_requests_total");
  const httpFam = counters.get("gosleep_http_requests_total");
  if (httpFam !== undefined) {
    for (const s of httpFam.values()) {
      lines.push(`gosleep_http_requests_total${renderLabels(s.labels)} ${s.value}`);
    }
  }

  // Trailing newline required by the exposition format (a scraper strict-parser may reject
  // otherwise). One newline, not two — extra blank lines are allowed but noisy.
  return lines.join("\n") + "\n";
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_EVENTS_DIR = resolve(HERE, "../../../../docs/lab/events");

function statDbSize(path: string): number {
  if (path === ":memory:") return 0;
  try {
    if (!existsSync(path)) return 0;
    const s = statSync(path);
    return s.size;
  } catch {
    return 0;
  }
}

function computeIndexerLagSeconds(
  db: OpenedDb,
  nowMs: number,
  eventsDirOverride?: string,
): number | null {
  const eventsDir = eventsDirOverride ?? DEFAULT_EVENTS_DIR;
  let newestFileMs: number | null = null;
  try {
    if (existsSync(eventsDir)) {
      const files = readdirSync(eventsDir).filter((n) => n.endsWith(".jsonl"));
      for (const n of files) {
        const st = statSync(join(eventsDir, n));
        const m = st.mtimeMs;
        if (newestFileMs === null || m > newestFileMs) newestFileMs = m;
      }
    }
  } catch {
    /* dir missing */
  }
  if (newestFileMs === null) return null;
  let lastIndexedMs: number | null = null;
  try {
    const row = db.raw
      .query("SELECT MAX(ts) AS ts FROM events")
      .get() as { ts: string | null };
    if (row.ts !== null) {
      const parsed = Date.parse(row.ts);
      if (Number.isFinite(parsed)) lastIndexedMs = parsed;
    }
  } catch {
    /* events table missing */
  }
  // If we have neither, return null so the caller emits -1 (distinguishes "unknown").
  if (lastIndexedMs === null && newestFileMs === null) return null;
  // Prefer the pair delta; if only newestFileMs known, use "now - newestFileMs" as an
  // upper bound (a scrape landing before the very first ingest event).
  const anchor = lastIndexedMs ?? nowMs;
  const lagMs = newestFileMs - anchor;
  return Math.max(0, lagMs / 1000);
}

// Test-only helper: reset every registry to a clean slate. Called at the top of each
// test's `beforeEach` so ordering does not couple assertions.
export function _resetRegistryForTests(): void {
  counters.clear();
  histograms.clear();
  currentAuthSource = null;
}

// Buckets exported for tests to iterate.
export { HOOK_WAIT_BUCKETS };
