// @gosleep/core — Jira reconciler worker (GSL-279 / rev-3 addendum Delta 9).
//
// Pulls the shape of every Jira ticket in the GoSleep project down to the local `tasks` table
// on a fixed cadence (default 5 min, env `GOSLEEP_JIRA_SYNC_INTERVAL_S`). Each row carries
// `key`, `epic` (parent), `status`, `title`, `labels`, `last_synced_at`. A diff against the
// existing row set drives:
//   1. INSERT for freshly-seen keys.
//   2. UPDATE for rows whose tracked columns changed (status / title / labels / epic).
//   3. `tasks.updated` events row + SSE fan-out per change set (never one per row — we batch
//      the batch into a single event so a big cycle emits ONE broadcaster nudge).
// Rows that no longer appear in the source are LEFT ALONE — a ticket deletion in Jira is rare,
// and we do not want a source hiccup to silently wipe half the Tasks screen.
//
// SOURCES. Two shapes both fit behind the same `SyncSource` interface — the worker treats
// whichever returns `ok: true` as its snapshot. Order at construction time:
//
//   1. jiraRestSource — hits ainstance-labs.atlassian.net/rest/api/3/search with a Basic
//      auth `email:api-token` header. The token comes out of macOS Keychain under
//      service `gosleep-jira-api` (same wrapper as the Bearer path — see keychain.ts). The
//      status/title/labels/parent are read from the JQL page response directly, so `epic`
//      lands populated and `status` mirrors Jira exactly.
//   2. ghSource — `gh issue list --repo ainstance-labs/gosleep --state all --json …`. Runs
//      unconditionally on this box because `gh` is authenticated per operator. Status is a
//      degraded shape (`Done` when the mirror is CLOSED; else `To Do`) because GitHub Issues
//      have no `In Progress` / `In Review` state — the granular Jira status only lands via
//      source 1. `epic` is parsed out of the mirror body's `Parent epic: [GSL-N]` line.
//
// The worker tries source 1 first; when it returns `ok:false` (typically because no Jira token
// is provisioned in Keychain yet — the initial rollout scenario), the worker falls back to
// source 2 so the Tasks screen still populates on day one. Both paths write into the same
// `tasks` table; a later cycle that succeeds against Jira REST silently upgrades the granular
// columns (status especially) without any special cutover.
//
// FAILURE MODES.
//   - Every source returned `ok:false` → log ONE line, DO NOT touch the DB. A Jira / gh hiccup
//     must not fire spurious tasks.updated for the entire table.
//   - A shell spawn timed out → same treatment. The next tick tries again.
//   - The JSON payload is malformed → the row is skipped, the rest continue; a JSON.parse
//     failure at the outer level counts as source failure.
//
// The worker owns NO in-process state beyond its interval timer + a controller. Everything
// else is DB-backed so a launchd restart resumes cleanly.

import { spawn } from "node:child_process";
import { spawnAwait, REPO_ROOT } from "../actions/spawn.ts";
import { broadcaster } from "../sse/broadcaster.ts";
import type { OpenedDb } from "../db/client.ts";

// -----------------------------------------------------------------------------
// public types
// -----------------------------------------------------------------------------

/**
 * One row's worth of task state — the exact fields the `tasks` table carries. `epic` is the
 * parent key (`GSL-250`) or null if the source could not determine one.
 */
export interface TaskSnapshot {
  key: string;
  epic: string | null;
  status: string;
  title: string;
  labels: string[];
}

export interface SyncResult {
  ok: boolean;
  source: string;
  rows: TaskSnapshot[];
  /** Machine-readable reason on failure; 'ok' on success. */
  reason: string;
}

export interface SyncSource {
  /** Short name for logs + response body. */
  name: string;
  /** Fetch the current snapshot. `epic` scopes the fetch when non-null (unused by gh source
   *  — that source always returns everything). */
  fetch(opts: { epic?: string | null }): Promise<SyncResult>;
}

export interface JiraSyncOptions {
  /** Poll interval in ms (default 300_000 = 5 min). */
  intervalMs?: number;
  /** Ordered list of sources to try. First `ok:true` wins. Defaults: [jiraRest, gh]. */
  sources?: SyncSource[];
  /** Test seam — replace the broadcaster emit. */
  onChange?: (summary: JiraSyncChangeSummary) => void;
}

export interface JiraSyncChangeSummary {
  inserted: number;
  updated: number;
  ended: number; // reserved — we do not delete today, but future extension can flip
  totalSeen: number;
  ts: string;
  source: string;
  /** The changed key set — small enough to log verbatim on a normal cycle. */
  changedKeys: string[];
}

export interface JiraSyncController {
  stop(): Promise<void>;
  /** Force one cycle now; optionally scoped to one epic. Awaits completion. */
  poll(opts?: { epic?: string | null }): Promise<JiraSyncChangeSummary>;
}

// -----------------------------------------------------------------------------
// small helpers
// -----------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function log(event: string, extra: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: nowIso(), event, ...extra }));
}

interface ExistingRow {
  key: string;
  epic: string | null;
  status: string;
  title: string;
  labels: string; // JSON-encoded string as stored
}

function labelsEqual(a: string[], bJson: string): boolean {
  // Compare set-equality (order-agnostic) since Jira/GH may return labels in any order.
  let bArr: unknown;
  try {
    bArr = JSON.parse(bJson);
  } catch {
    return false;
  }
  if (!Array.isArray(bArr)) return false;
  if (bArr.length !== a.length) return false;
  const bs = new Set(bArr.filter((x): x is string => typeof x === "string"));
  for (const x of a) if (!bs.has(x)) return false;
  return true;
}

/**
 * Apply one snapshot to the DB. Returns the change summary the caller broadcasts on SSE.
 * Exposed for the unit tests — they call it directly with a canned snapshot.
 */
export function reconcileTasks(
  db: OpenedDb,
  snapshot: TaskSnapshot[],
  sourceName: string,
): JiraSyncChangeSummary {
  const ts = nowIso();

  const existing = db.raw
    .query("SELECT key, epic, status, title, labels FROM tasks")
    .all() as ExistingRow[];
  const existingByKey = new Map<string, ExistingRow>(existing.map((r) => [r.key, r]));

  let inserted = 0;
  let updated = 0;
  const changedKeys: string[] = [];

  // Wrap the whole reconcile in a transaction so a mid-batch failure rolls back — a
  // half-updated Tasks screen is worse than a stale one.
  const applyAll = db.raw.transaction(() => {
    for (const row of snapshot) {
      const prior = existingByKey.get(row.key);
      const labelsJson = JSON.stringify(row.labels);
      if (prior === undefined) {
        db.raw
          .query(
            `INSERT INTO tasks (key, epic, status, title, labels, last_synced_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(row.key, row.epic, row.status, row.title, labelsJson, ts);
        inserted += 1;
        changedKeys.push(row.key);
        continue;
      }
      const changed =
        prior.status !== row.status ||
        prior.title !== row.title ||
        (prior.epic ?? null) !== (row.epic ?? null) ||
        !labelsEqual(row.labels, prior.labels ?? "[]");
      if (changed) {
        db.raw
          .query(
            `UPDATE tasks
             SET epic = ?, status = ?, title = ?, labels = ?, last_synced_at = ?
             WHERE key = ?`,
          )
          .run(row.epic, row.status, row.title, labelsJson, ts, row.key);
        updated += 1;
        changedKeys.push(row.key);
      } else {
        // Non-material tick — still bump last_synced_at so the "Synced" column shows liveness.
        db.raw
          .query("UPDATE tasks SET last_synced_at = ? WHERE key = ?")
          .run(ts, row.key);
      }
    }
  });
  applyAll();

  return {
    inserted,
    updated,
    ended: 0,
    totalSeen: snapshot.length,
    ts,
    source: sourceName,
    changedKeys,
  };
}

// -----------------------------------------------------------------------------
// source: gh CLI (fallback — always available on an operator's box)
//
// `gh issue list --repo ainstance-labs/gosleep --state all --limit 500 --json
//   number,title,state,labels,body`
//
// Title parsing: `GSL-N[: ] <rest>` (colon optional — early tickets omit it). The rest is the
// title we store. `labels[]` maps 1:1. `epic` is derived from the body's `Parent epic: [GSL-N]`
// line — that pattern is emitted by every mirror created via `gh issue create` in this repo.
// -----------------------------------------------------------------------------

const KEY_RE = /^(GSL-\d+)[:\s]+(.*)$/;
const PARENT_EPIC_RE = /Parent epic:\s*\[?(GSL-\d+)\]?/;

interface GhIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  labels: Array<{ name: string }>;
  body: string;
}

export const ghSource: SyncSource = {
  name: "gh-cli",
  async fetch(): Promise<SyncResult> {
    const res = await spawnAwait({
      cmd: [
        "gh",
        "issue",
        "list",
        "--repo",
        "ainstance-labs/gosleep",
        "--state",
        "all",
        "--limit",
        "500",
        "--json",
        "number,title,state,labels,body",
      ],
      cwd: REPO_ROOT,
      timeoutMs: 20_000,
    });
    if (!res.ok) {
      return {
        ok: false,
        source: "gh-cli",
        rows: [],
        reason: `gh list failed (rc=${res.code ?? "null"}, timedOut=${res.timedOut}): ${res.stderr.slice(0, 200)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.stdout);
    } catch (err) {
      return {
        ok: false,
        source: "gh-cli",
        rows: [],
        reason: `gh JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, source: "gh-cli", rows: [], reason: "gh JSON was not an array" };
    }
    const rows: TaskSnapshot[] = [];
    for (const raw of parsed as GhIssue[]) {
      if (raw === null || typeof raw !== "object") continue;
      const title = typeof raw.title === "string" ? raw.title : "";
      const m = KEY_RE.exec(title);
      if (m === null || m[1] === undefined) continue;
      const key = m[1];
      const rest = m[2] ?? "";
      const labels = Array.isArray(raw.labels)
        ? raw.labels
            .map((l) => (l !== null && typeof l === "object" && typeof l.name === "string" ? l.name : ""))
            .filter((s): s is string => s.length > 0)
        : [];
      const isEpic = labels.includes("epic");
      // GH state is only OPEN/CLOSED — collapse to Done vs a coarse To Do. Real granularity
      // (In Progress / In Review) only lights up when the Jira REST source is available.
      const status = raw.state === "CLOSED" ? "Done" : "To Do";
      const body = typeof raw.body === "string" ? raw.body : "";
      const em = PARENT_EPIC_RE.exec(body);
      const epic = isEpic ? key : em !== null ? (em[1] ?? null) : null;
      rows.push({ key, epic, status, title: rest, labels });
    }
    return { ok: true, source: "gh-cli", rows, reason: "ok" };
  },
};

// -----------------------------------------------------------------------------
// source: Jira REST (preferred — carries granular status)
//
// Requires a token in the Keychain under a dedicated service. The token is `email:api-token`
// b64-encoded and used as a Basic auth header — this is how Atlassian's classic REST v3 auth
// works, per docs.atlassian.com/software/jira/docs/api/REST/latest.
//
// The Keychain read is INTENTIONALLY separate from the Bearer wrapper (`security/keychain.ts`):
//   * That wrapper honours GOSLEEP_BEARER_TOKEN as a dev-bypass, and the core-smoke sets that
//     env var to a fake token. Reusing the wrapper here would silently return the fake token as
//     the Jira credential and make the Jira source appear "ok" with no rows — masking a fall
//     back to the gh source.
//   * The Jira token is also structurally different (email:api-token vs an opaque bearer).
// So we read the Keychain directly here, with a Jira-specific env override
// (`GOSLEEP_JIRA_TOKEN`) for tests, and fall through to `ok: false` when neither is present —
// which is the documented "Jira sync starts degraded until the operator seeds the Keychain"
// state and lets the worker fall back to the gh source.
// -----------------------------------------------------------------------------

const JIRA_HOST = "ainstance-labs.atlassian.net";
const JIRA_PROJECT = "GSL";

/** Read the Jira API token, in order: env override → macOS Keychain generic-password. */
async function readJiraToken(timeoutMs: number = 5_000): Promise<string | null> {
  const envToken = process.env.GOSLEEP_JIRA_TOKEN;
  if (typeof envToken === "string" && envToken.length > 0) return envToken;
  const service = process.env.GOSLEEP_JIRA_KEYCHAIN_SERVICE ?? "gosleep-jira-api";
  const account = process.env.GOSLEEP_JIRA_KEYCHAIN_ACCOUNT ?? (process.env.USER ?? "");
  if (account.length === 0) return null;
  return await new Promise<string | null>((resolve) => {
    let child;
    try {
      child = spawn(
        "security",
        ["find-generic-password", "-s", service, "-a", account, "-w"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    let settled = false;
    const settle = (v: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      settle(null);
    }, timeoutMs);
    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.on("error", () => settle(null));
    child.on("close", (code) => {
      if (code !== 0) return settle(null);
      const trimmed = stdout.replace(/\n$/, "");
      settle(trimmed.length > 0 ? trimmed : null);
    });
  });
}

interface JiraSearchIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    labels?: string[];
    parent?: { key?: string };
    issuetype?: { name?: string };
  };
}

interface JiraSearchResponse {
  issues?: JiraSearchIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export const jiraRestSource: SyncSource = {
  name: "jira-rest",
  async fetch({ epic }: { epic?: string | null } = {}): Promise<SyncResult> {
    const secret = await readJiraToken();
    if (secret === null || secret.length === 0) {
      return {
        ok: false,
        source: "jira-rest",
        rows: [],
        reason: "no jira token in keychain (service=gosleep-jira-api) — falling back",
      };
    }

    const jql = epic !== null && epic !== undefined && epic.length > 0
      ? `project=${JIRA_PROJECT} AND parent="${epic}"`
      : `project=${JIRA_PROJECT}`;
    const rows: TaskSnapshot[] = [];
    let pageToken: string | null = null;
    const authHeader = `Basic ${Buffer.from(secret).toString("base64")}`;
    for (let page = 0; page < 20; page += 1) {
      // Cap the paging at 20 × 100 = 2000 issues — well above the GSL project size.
      const url = new URL(`https://${JIRA_HOST}/rest/api/3/search/jql`);
      url.searchParams.set("jql", jql);
      url.searchParams.set("fields", "summary,status,labels,parent,issuetype");
      url.searchParams.set("maxResults", "100");
      if (pageToken !== null) url.searchParams.set("nextPageToken", pageToken);
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          headers: { Authorization: authHeader, Accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        return {
          ok: false,
          source: "jira-rest",
          rows: [],
          reason: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      if (res.status === 429) {
        return {
          ok: false,
          source: "jira-rest",
          rows: [],
          reason: "jira 429 rate-limited — backoff and retry next cycle",
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          source: "jira-rest",
          rows: [],
          reason: `jira HTTP ${res.status}`,
        };
      }
      let body: JiraSearchResponse;
      try {
        body = (await res.json()) as JiraSearchResponse;
      } catch (err) {
        return {
          ok: false,
          source: "jira-rest",
          rows: [],
          reason: `jira JSON parse: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      for (const it of body.issues ?? []) {
        if (typeof it.key !== "string") continue;
        const f = it.fields ?? {};
        const isEpic = f.issuetype?.name === "Epic";
        const parentKey = typeof f.parent?.key === "string" ? f.parent.key : null;
        rows.push({
          key: it.key,
          epic: isEpic ? it.key : parentKey,
          status: typeof f.status?.name === "string" ? f.status.name : "Unknown",
          title: typeof f.summary === "string" ? f.summary : it.key,
          labels: Array.isArray(f.labels) ? f.labels.filter((s): s is string => typeof s === "string") : [],
        });
      }
      if (body.isLast === true || typeof body.nextPageToken !== "string") break;
      pageToken = body.nextPageToken;
    }
    return { ok: true, source: "jira-rest", rows, reason: "ok" };
  },
};

// -----------------------------------------------------------------------------
// worker controller
// -----------------------------------------------------------------------------

function defaultSources(): SyncSource[] {
  return [jiraRestSource, ghSource];
}

/**
 * Run one sync cycle. Tries every source in order until one returns ok:true; reconciles into
 * SQLite and (on non-empty change set) fires an SSE event via the broadcaster. Returns the
 * per-cycle summary — the endpoint layer echoes this back.
 */
export async function runSyncCycle(
  db: OpenedDb,
  opts: {
    epic?: string | null;
    sources?: SyncSource[];
    onChange?: (summary: JiraSyncChangeSummary) => void;
  } = {},
): Promise<JiraSyncChangeSummary> {
  const sources = opts.sources ?? defaultSources();
  const epic = opts.epic ?? null;
  let last: SyncResult | null = null;
  for (const src of sources) {
    const r = await src.fetch({ epic });
    last = r;
    if (r.ok) {
      const summary = reconcileTasks(db, r.rows, r.source);
      if (summary.inserted > 0 || summary.updated > 0) {
        const emit = opts.onChange ?? ((s) => defaultEmit(s));
        emit(summary);
        log("jira_sync.done", {
          source: summary.source,
          inserted: summary.inserted,
          updated: summary.updated,
          total: summary.totalSeen,
        });
      }
      return summary;
    }
    log("jira_sync.source_skip", { source: r.source, reason: r.reason });
  }
  log("jira_sync.all_sources_failed", {
    lastReason: last?.reason ?? "no sources configured",
  });
  return {
    inserted: 0,
    updated: 0,
    ended: 0,
    totalSeen: 0,
    ts: nowIso(),
    source: last?.source ?? "none",
    changedKeys: [],
  };
}

function defaultEmit(summary: JiraSyncChangeSummary): void {
  broadcaster.emit({
    seq: 0,
    day: summary.ts.slice(0, 10),
    ts: summary.ts,
    src: "core",
    actor: "jira-sync",
    task: null,
    type: "tasks.updated",
    payload: {
      source: summary.source,
      inserted: summary.inserted,
      updated: summary.updated,
      totalSeen: summary.totalSeen,
      changedKeys: summary.changedKeys,
    },
    ingested_from: null,
  });
}

/**
 * Start the Jira sync worker. Fires one cycle at boot so the Tasks screen has SOMETHING
 * immediately (not empty state until interval fires).
 */
export function startJiraSync(
  db: OpenedDb,
  opts: JiraSyncOptions = {},
): JiraSyncController {
  const intervalMs = opts.intervalMs ?? 300_000;
  const sources = opts.sources ?? defaultSources();

  let polling = false;
  let stopped = false;

  const cycle = async (epic?: string | null): Promise<JiraSyncChangeSummary> => {
    polling = true;
    try {
      const runOpts: {
        epic?: string | null;
        sources: SyncSource[];
        onChange?: (summary: JiraSyncChangeSummary) => void;
      } = { sources };
      if (epic !== undefined) runOpts.epic = epic;
      if (opts.onChange !== undefined) runOpts.onChange = opts.onChange;
      return await runSyncCycle(db, runOpts);
    } catch (err) {
      log("jira_sync.error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        inserted: 0,
        updated: 0,
        ended: 0,
        totalSeen: 0,
        ts: nowIso(),
        source: "error",
        changedKeys: [],
      };
    } finally {
      polling = false;
    }
  };

  // Kick off an initial cycle. Do NOT await — start() returns synchronously.
  void cycle();

  const timer = setInterval(() => {
    if (stopped) return;
    void cycle();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  log("jira_sync.started", { interval_ms: intervalMs });

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      while (polling) {
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    },
    async poll(pollOpts?: { epic?: string | null }): Promise<JiraSyncChangeSummary> {
      return await cycle(pollOpts?.epic ?? null);
    },
  };
}
