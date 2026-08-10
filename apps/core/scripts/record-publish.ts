// @gosleep/core — record a skill publish + fold docs/skills/CHANGELOG.jsonl → `skills` table
// (T4, GSL-292; PRD F8-S6).
//
// Two invocations:
//
//   bun run apps/core/scripts/record-publish.ts fold
//     Full re-fold. Reads docs/skills/CHANGELOG.jsonl end-to-end and upserts the projection
//     into the `skills` table. Called at boot (via publish.sh's --post-boot leg — TODO,
//     out of scope tonight) and by hand for reconciliation. Idempotent.
//
//   bun run apps/core/scripts/record-publish.ts write \
//     --skill <name> --task GSL-N --commit <40-char-sha> --lesson <text> \
//     [--status published|draft|reviewed] [--intent-id <server_intents.id>]
//     Appends ONE row to CHANGELOG.jsonl (validating against the schema first) then
//     re-folds the table. Called by tools/skills/publish.sh at the end of a successful
//     rsync so the DB projection is fresh before the endpoint returns.
//
// Env:
//   GOSLEEP_DB_PATH        override the SQLite path (used by the smoke).
//   GOSLEEP_CHANGELOG_PATH override the JSONL path (used by the smoke).
//
// Design notes:
//   - The JSONL is the source of truth (PRD R8.5). This script never invents publish rows;
//     the `write` command adds ONE row keyed by the caller's arguments.
//   - `skills` table row shape (per apps/core/src/db/schema.ts):
//       name, version, status, last_published_at, last_published_by, changelog (JSON array).
//   - version = SHA-4 (first 8 chars of the latest published commit) OR "0.0.0" when there
//     is no published row yet. Human-readable, greppable in the timeline.
//   - status = "published" if any published row exists for the skill, else "clean".
//     The true filesystem-derived status (clean vs has-changes) is computed at read time by
//     GET /skills/:name/diff (T6) — this row's `status` is the registry-only view.
//   - last_published_by is derived: rows with `intent_id != null` are owner-web (came through
//     POST /actions/skills/publish); rows with `intent_id == null` are owner-cli (came
//     through the bare `publish.sh` invocation). A future schema bump may add an explicit
//     `by` field.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase, type OpenedDb } from "../src/db/client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

const DEFAULT_CHANGELOG_PATH = resolve(REPO_ROOT, "docs/skills/CHANGELOG.jsonl");
const DEFAULT_SCHEMA_PATH = resolve(REPO_ROOT, "tools/skills/schema/changelog.schema.json");

const KNOWN_SKILLS = new Set([
  "orchestrating-delivery-agents",
  "delivery-workflow",
  "handoff",
  "using-jira",
  "writing-prds",
  "remote-control",
  "tmux-agents-orchestration",
]);

const STATUS_ENUM = new Set(["draft", "reviewed", "published"]);

// -----------------------------------------------------------------------------
// row shape
// -----------------------------------------------------------------------------

export interface ChangelogRow {
  ts: string;
  skill: string;
  task: string;
  commit: string;
  lesson: string;
  status: "draft" | "reviewed" | "published";
  intent_id?: string | null;
}

export interface SkillRegistryProjection {
  name: string;
  version: string;
  status: "published" | "clean";
  last_published_at: string | null;
  last_published_by: string | null;
  changelog: ChangelogRow[];
}

// -----------------------------------------------------------------------------
// JSONL read + validate (no external jsonschema dep; mirrors validate-changelog.sh)
// -----------------------------------------------------------------------------

function validateRow(row: unknown, lineNo: number): ChangelogRow {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`row ${lineNo}: top-level value must be an object`);
  }
  const r = row as Record<string, unknown>;
  const need = ["ts", "skill", "task", "commit", "lesson", "status"];
  for (const k of need) {
    if (!(k in r)) throw new Error(`row ${lineNo}: missing required field '${k}'`);
  }
  const ts = r.ts;
  if (typeof ts !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(ts)) {
    throw new Error(`row ${lineNo}: 'ts' must match ISO-8601 UTC (got ${JSON.stringify(ts)})`);
  }
  const skill = r.skill;
  if (typeof skill !== "string" || !KNOWN_SKILLS.has(skill)) {
    throw new Error(`row ${lineNo}: 'skill' unknown (got ${JSON.stringify(skill)})`);
  }
  const task = r.task;
  if (typeof task !== "string" || !/^GSL-\d+$/.test(task)) {
    throw new Error(`row ${lineNo}: 'task' must match /^GSL-\\d+$/ (got ${JSON.stringify(task)})`);
  }
  const commit = r.commit;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`row ${lineNo}: 'commit' must be a 40-char lowercase git SHA`);
  }
  const lesson = r.lesson;
  if (typeof lesson !== "string" || lesson.length > 4096) {
    throw new Error(`row ${lineNo}: 'lesson' must be a string <= 4096 chars`);
  }
  const status = r.status;
  if (typeof status !== "string" || !STATUS_ENUM.has(status)) {
    throw new Error(`row ${lineNo}: 'status' invalid (got ${JSON.stringify(status)})`);
  }
  let intent_id: string | null | undefined;
  if ("intent_id" in r) {
    const iid = r.intent_id;
    if (iid === null) {
      intent_id = null;
    } else if (typeof iid === "string" && iid.length >= 1 && iid.length <= 128 && /^[\x21-\x7e]+$/.test(iid)) {
      intent_id = iid;
    } else {
      throw new Error(`row ${lineNo}: 'intent_id' must be null or 1..128 printable ASCII`);
    }
  }
  const out: ChangelogRow = {
    ts,
    skill,
    task,
    commit,
    lesson,
    status: status as ChangelogRow["status"],
  };
  if (intent_id !== undefined) out.intent_id = intent_id;
  return out;
}

export function readChangelog(path: string): ChangelogRow[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const rows: ChangelogRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`row ${i + 1}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`);
    }
    rows.push(validateRow(parsed, i + 1));
  }
  return rows;
}

// -----------------------------------------------------------------------------
// fold rows → projection map
// -----------------------------------------------------------------------------

export function foldRows(rows: ChangelogRow[]): Map<string, SkillRegistryProjection> {
  const perSkill = new Map<string, ChangelogRow[]>();
  for (const row of rows) {
    const arr = perSkill.get(row.skill) ?? [];
    arr.push(row);
    perSkill.set(row.skill, arr);
  }
  const result = new Map<string, SkillRegistryProjection>();
  for (const [skill, arr] of perSkill) {
    // Sort by ts ascending so the last element is the latest.
    arr.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const publishedRows = arr.filter((r) => r.status === "published");
    const latestPublished = publishedRows[publishedRows.length - 1];
    const version = latestPublished
      ? `sha-${latestPublished.commit.slice(0, 8)}`
      : "0.0.0";
    const lastBy = latestPublished
      ? (typeof latestPublished.intent_id === "string" && latestPublished.intent_id.length > 0
          ? "owner-web"
          : "owner-cli")
      : null;
    result.set(skill, {
      name: skill,
      version,
      status: latestPublished !== undefined ? "published" : "clean",
      last_published_at: latestPublished?.ts ?? null,
      last_published_by: lastBy,
      changelog: arr,
    });
  }
  // Skills never touched still deserve a row for the /skills endpoint. Insert placeholders
  // for every known skill absent from the JSONL so the Skills screen sees the full set.
  for (const skill of KNOWN_SKILLS) {
    if (!result.has(skill)) {
      result.set(skill, {
        name: skill,
        version: "0.0.0",
        status: "clean",
        last_published_at: null,
        last_published_by: null,
        changelog: [],
      });
    }
  }
  return result;
}

// -----------------------------------------------------------------------------
// upsert projection → skills table
// -----------------------------------------------------------------------------

export function upsertProjection(opened: OpenedDb, projection: Map<string, SkillRegistryProjection>): {
  upserted: number;
} {
  const stmt = opened.raw.query(
    `INSERT INTO skills (name, version, status, last_published_at, last_published_by, changelog)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       version = excluded.version,
       status = excluded.status,
       last_published_at = excluded.last_published_at,
       last_published_by = excluded.last_published_by,
       changelog = excluded.changelog`,
  );
  let n = 0;
  for (const row of projection.values()) {
    stmt.run(
      row.name,
      row.version,
      row.status,
      row.last_published_at,
      row.last_published_by,
      JSON.stringify(row.changelog),
    );
    n++;
  }
  return { upserted: n };
}

// -----------------------------------------------------------------------------
// append row (write mode) — validates, appends, then re-folds
// -----------------------------------------------------------------------------

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function appendRow(path: string, row: ChangelogRow): void {
  // Validate the shape one more time via validateRow — same code path used on read.
  validateRow(row, -1);
  ensureParentDir(path);
  const line = JSON.stringify(row);
  appendFileSync(path, `${line}\n`, "utf8");
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

interface CliArgs {
  mode: "fold" | "write" | "check";
  skill?: string;
  task?: string;
  commit?: string;
  lesson?: string;
  status?: ChangelogRow["status"];
  intentId?: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0) throw new Error("usage: record-publish.ts fold | write --skill … --task … --commit … --lesson … | check");
  const mode = argv[0];
  if (mode === "fold") return { mode: "fold" };
  if (mode === "check") return { mode: "check" };
  if (mode !== "write") throw new Error(`unknown mode: ${mode}`);
  const out: CliArgs = { mode: "write" };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (flag === undefined || val === undefined) break;
    switch (flag) {
      case "--skill":
        out.skill = val; i++; break;
      case "--task":
        out.task = val; i++; break;
      case "--commit":
        out.commit = val; i++; break;
      case "--lesson":
        out.lesson = val; i++; break;
      case "--status":
        out.status = val as ChangelogRow["status"]; i++; break;
      case "--intent-id":
        out.intentId = val.length > 0 ? val : null; i++; break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (!out.skill || !out.task || !out.commit || out.lesson === undefined) {
    throw new Error("write mode requires --skill, --task, --commit, --lesson");
  }
  return out;
}

async function main(): Promise<void> {
  const changelogPath = process.env.GOSLEEP_CHANGELOG_PATH
    && process.env.GOSLEEP_CHANGELOG_PATH.length > 0
    ? resolve(process.env.GOSLEEP_CHANGELOG_PATH)
    : DEFAULT_CHANGELOG_PATH;
  const args = parseArgs(process.argv.slice(2));

  // `check` — read-only preflight used by publish.sh (GSL-254 M1 finding, verifier
  // GSL-174-night). Verifies the target DB is migrated (the `skills` table exists)
  // BEFORE publish.sh performs any rsync or CHANGELOG append. Never mutates state.
  // Exits 0 when the table is present, 1 otherwise. The launchd-managed core migrates
  // at boot; a bare CLI invocation on a fresh checkout needs `bun run apps/core/scripts/migrate.ts`
  // first.
  if (args.mode === "check") {
    const opened = openDatabase();
    try {
      opened.raw.query("SELECT 1 FROM skills LIMIT 1").get();
      console.log(
        JSON.stringify({
          event: "skills.record-publish.check.ok",
          db: opened.path,
        }),
      );
      opened.raw.close();
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        JSON.stringify({
          event: "skills.record-publish.check.fail",
          db: opened.path,
          error: message,
        }),
      );
      opened.raw.close();
      process.exit(1);
    }
  }

  if (args.mode === "write") {
    const row: ChangelogRow = {
      ts: new Date().toISOString(),
      skill: args.skill!,
      task: args.task!,
      commit: args.commit!,
      lesson: args.lesson!,
      status: args.status ?? "published",
    };
    if (args.intentId !== undefined) row.intent_id = args.intentId;
    appendRow(changelogPath, row);
    console.log(JSON.stringify({ event: "skills.record-publish.appended", path: changelogPath, row }));
  }

  const rows = readChangelog(changelogPath);
  const projection = foldRows(rows);
  const opened = openDatabase();
  const { upserted } = upsertProjection(opened, projection);
  console.log(
    JSON.stringify({
      event: "skills.record-publish.folded",
      db: opened.path,
      changelog: changelogPath,
      rowsScanned: rows.length,
      skillsUpserted: upserted,
    }),
  );
  opened.raw.close();
}

// Only run as a CLI when invoked directly — allow tests / callers to import individual funcs.
// import.meta.main is Bun-specific; the exports above are stable regardless.
if ((import.meta as unknown as { main?: boolean }).main === true) {
  main().catch((err) => {
    console.error(JSON.stringify({
      event: "skills.record-publish.error",
      error: err instanceof Error ? err.message : String(err),
    }));
    process.exit(1);
  });
}

// Exported for the smoke and for tests.
export { DEFAULT_CHANGELOG_PATH, DEFAULT_SCHEMA_PATH, KNOWN_SKILLS };
