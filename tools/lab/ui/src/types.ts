// =============================================================================
// The render bundle — the ONE contract between the data layer and the view layer.
//
//   tools/lab/chronicler.py  (Python, stdlib, no network)  --produces-->  docs/lab/render_bundle.json
//   tools/lab/ui/src/render.tsx (TypeScript, Preact SSG)   --consumes-->  docs/lab/site/*.html
//
// Why a bundle and not "the TS reads the same files Python reads": two readers of an append-only log
// WILL drift apart (the same argument that makes chronicler.py shell out to lab-emit.sh instead of
// re-folding queue.jsonl itself). One reader, one fold, one shape. If a screen needs a number, the
// number is computed ONCE in Python and travels here as data.
//
// Why the view layer is not Python: it was, and the drift showed up immediately — the staleness
// banner re-graded itself on open while the prose under it stayed frozen at build time, so a page
// could carry a red DEAD banner over the sentence "Live — the laboratory is writing itself right
// now" (REVIEW-gsl81 M1). Two renderers of one truth is how that happens. There is now one.
//
// EVERY optional field here means "the source may be unreadable". It is never a licence to invent a
// plausible value: an absent number renders as *unknown*, never as an optimistic default. A runway
// axis with no source lengthens min() if you guess — and a dashboard that guesses long is a
// dashboard that tells the owner to go to sleep on evidence it does not have.
// =============================================================================

/** Freshness verdict about the DATA (not about the page — a static file cannot age itself). */
export type Grade = "fresh" | "stale" | "dead";

/** Where a timeline line came from. `hook:*` cost 0 tokens and needed no model's cooperation. */
export type EventSrc = string;

export interface LabEvent {
  ts: string;
  seq?: number;
  actor?: string;
  type?: string;
  src?: EventSrc;
  run_id?: string;
  /** Free-form per type; the timeline shows one derived `detail` column from it. */
  data?: Record<string, unknown>;
}

export interface Staleness {
  max_event_age_s: number | null;
  max_event_age_human: string;
  latest_event_ts: string | null;
  heartbeat_age_s: number | null;
  grade: Grade;
  thresholds_s: { fresh: number; dead: number };
}

export interface EventStats {
  total: number;
  today: number;
  days: string[];
  by_type: Record<string, number>;
  by_src: Record<string, number>;
  by_actor: Record<string, number>;
  mechanical_share: number;
}

export interface Question {
  id: string;
  type: string;
  question: string;
  default?: string | null;
  auto_apply_at?: string | null;
  task?: string | null;
  high_impact?: boolean | null;
}

export interface Commit {
  sha: string;
  author: string;
  ts: string;
  subject: string;
}

export interface PullRequest {
  number: number;
  state: string;
  title: string;
  url: string;
  mergedAt?: string | null;
}

export interface Delivery {
  branch: string | null;
  head: string | null;
  dirty_paths: number | null;
  commits_on_date: Commit[];
  prs: PullRequest[];
}

export interface Decision {
  ts?: string;
  decision?: string;
  rule?: string | null;
  [k: string]: unknown;
}

/** A file in the Library index: the memory that survives the 30-day event retention. */
export interface LibraryEntry {
  /** Path relative to docs/lab/site/, so the link works from file:// AND from GitHub. */
  href: string;
  name: string;
  title: string;
}

/**
 * One kind of artifact, and the glob that found it (chronicler.py: LIBRARY_SECTIONS).
 *
 * `source` is on the page, not just in the code, and that is the point: an empty section that NAMES
 * where it looked has proven something ("I searched docs/reports for incidents and there are none").
 * An empty section that names nothing has merely failed to look — and the two render identically
 * unless the glob comes along for the ride.
 */
export interface LibrarySection {
  key: string;
  label: string;
  /** The glob, verbatim. The owner can paste it into a shell and get this list back. */
  source: string;
  /** False = the directory does not exist at all. "Nothing here" and "nowhere to look" are not the same. */
  dir_exists: boolean;
  items: LibraryEntry[];
  count: number;
}

export interface Library {
  sections: LibrarySection[];
  total: number;
}

// ───────────────────────── the laboratory's own rot (GSL-99, R5.3) ─────────────────────────
//
// Every state below has an `unknown`, and none of them has a default. That is the whole contract:
// a meter with no source is `unknown`, never green. Green is a claim; it needs evidence.

/** `empty` = nothing was ever owed here (no task commits). It is not `ok`, and must not render like it. */
export type CoverageState = "ok" | "gaps" | "empty" | "unknown";

export interface EpicCoverage {
  key: string;
  state: CoverageState;
  /** Why `unknown` / `empty` — the epic's own words, from git topology. */
  why: string;
  tasks: string[];
  covered: string[];
  /** The keys with no committed dev_history file. BY NAME — a percentage is not actionable at 03:00. */
  missing: string[];
  task_count: number;
}

export interface DevHistoryCoverage {
  state: CoverageState;
  why: string;
  /** The exact git invocation this was read from. An empty table that cannot say where it looked has proven nothing. */
  searched: string;
  epics: EpicCoverage[];
  tasks: number;
  covered: number;
  missing: number;
  /** In the working tree, not in the index. These do NOT count — the reader they serve arrives with a clone. */
  uncommitted: string[];
}

export interface HandoffDebt {
  /** `debt` = at least one cycle closed with nothing written down. `unknown` = no boundary to measure against. */
  state: "ok" | "debt" | "unknown";
  why: string;
  searched: string;
  last: { name: string; ts: string; age_s: number | null; age_human: string } | null;
  /** The last cycle boundary (a `pane.ended` event) — the thing the handoff's age is measured AGAINST. */
  boundary: { ts: string; age_s: number | null; age_human: string; source: string; total: number } | null;
  undocumented_cycles: number | null;
  alarm_at: number;
  alarm: boolean;
  boundaries: number;
  committed: number;
  /** Written, never committed → invisible to a fresh clone. Listed so "not written" and "lost" differ. */
  uncommitted: string[];
  undated: string[];
}

export interface SelfHealth {
  generated_at: string;
  /** Age of the freshest event AT BUILD TIME. The reader owes it `now − generated_at` on top — two ages, not one. */
  data_age_s: number | null;
  data_age_human: string;
  latest_event_ts: string | null;
  grade: Grade;
  grade_is_about: string;
  dev_history: DevHistoryCoverage;
  handoffs: HandoffDebt;
}

export interface Degradation {
  source: string;
  why: string;
}

export interface Orchestrator {
  heartbeat: Record<string, unknown> | null;
  live_status: string | null;
  telemetry_last: string | null;
}

// ───────────────────────────── the queue (PRD R5.2, screen 4) ─────────────────────────────

/** manifest.md §3. A BLOCKER takes no default, EVER — which is why it alone can stop a night. */
export type QuestionType = "BLOCKER" | "DECISION" | "CLARIFY" | "FYI";
export type QuestionStatus =
  | "open"
  | "answered"
  | "auto-resolved"
  | "answered-by-default"
  | "noted";

export interface QueueItem {
  id: string;
  ts?: string;
  type: QuestionType | string;
  from?: string;
  task?: string | null;
  question: string;
  options?: { label: string; pros?: string; cons?: string }[];
  default?: string | null;
  default_rationale?: string | null;
  reversibility?: "high" | "med" | "low" | string | null;
  impact_if_wrong?: string | null;
  /**
   * ISO-8601 UTC. The key is `auto_apply_at` — there is no `deadline` anywhere in this system, and
   * it is populated for DECISIONs only. A BLOCKER has no timer: it waits for a human, indefinitely.
   */
  auto_apply_at?: string | null;
  status: QuestionStatus | string;
  seen_by?: string[];
  high_impact?: boolean | null;
  answered_by?: string | null;
  answer?: string | null;
  links?: Record<string, string>;
}

export interface Queue {
  open: number;
  total: number;
  by_type: Record<string, number>;
  open_items: QueueItem[];
  /** Recently closed, newest first — the morning audits what the night decided on its own. */
  closed_items: QueueItem[];
  open_blockers: QueueItem[];
}

// ───────────────────────────── the tasks board (PRD R5.2, screen 3) ───────────────────────

export interface TaskRow {
  key: string;
  /** From `tracker.issue.updated` (src=poll-fill). Only as fresh as the last poll — see `status_age_s`.
   *  NEVER inferred from a commit: a commit witnesses that code landed, not that Jira said Done. */
  status: string | null;
  status_ts: string | null;
  status_age_s: number | null;
  status_age_human: string;
  summary: string | null;
  commits: { sha: string; subject: string; ts?: string; url: string | null }[];
  dev_history: { name: string; href: string }[];
  prs: { number?: number; state?: string; url?: string; title?: string }[];
  jira_url: string;
  /** The GitHub issue mirroring this key — read off the issue title through `gh`. Null when this build
   *  could not reach GitHub (see `TasksBoard.gh_why`), never a guess. */
  gh_url: string | null;
  gh_number: number | null;
}

/** How an epic's task list was established. Never prose, always topology — see `membership_why`. */
export type Membership = "merge-commit" | "branch" | "merged-unwitnessed" | "no-trunk";

export interface EpicRollup {
  key: string;
  summary: string | null;
  jira_url: string;
  gh_url: string | null;
  gh_number: number | null;
  /** The one PR the epic ships under (the invariant is one per epic). Null when none names it — and an
   *  absent PR is a fact about the delivery, so `pr_why` says it in words rather than leaving a hole. */
  pr: { number: number | null; state: string | null; url: string | null; title: string | null } | null;
  pr_why: string | null;
  tasks: string[];
  task_count: number;
  commits: number;
  by_status: Record<string, number>;
  membership: Membership;
  membership_why: string;
  merged: boolean;
}

export interface TasksBoard {
  rows: TaskRow[];
  by_status: Record<string, number>;
  todo: number;
  tracker_last_polled: string | null;
  tracker_age_s: number | null;
  tracker_age_human: string;
  /** True when the board's statuses are older than 12h — a number from the past in the present tense. */
  tracker_stale: boolean;
  gh_base: string | null;
  epics: EpicRollup[];
  /** True when this build read the GitHub issue mirror. False = the GH column is empty ON PURPOSE. */
  gh_issue_links: boolean;
  /** Empty when the mirror was read. Otherwise: why the column is blank, in the owner's words. */
  gh_why: string;
}

// ───────────────────────────── the fleet (PRD R5.2, screen 5) ─────────────────────────────

export interface FleetActor {
  actor: string;
  events: number;
  last_ts: string | null;
  last_age_s: number | null;
  last_age_human: string;
  types: Record<string, number>;
}

/**
 * A worker card (GSL-98). Keyed on the SESSION, because `task.completed` is the one event carrying
 * both a session_id and a worker's name — bind those once and the session's whole trail becomes
 * attributable. `last_age_*` is the headline field of the card, not a footnote: a worker nobody has
 * heard from in an hour is not working, it is silent.
 */
export interface FleetWorker {
  name: string;
  session_id: string;
  session_short: string;
  /** Exactly three, and there is deliberately no `dead` — the log cannot tell a thinking worker from
   *  a crashed one. Both are `silent`, and the card must not launder that into either. */
  state: "active" | "silent" | "ended";
  state_why: string;
  last_ts: string | null;
  last_age_s: number | null;
  last_age_human: string;
  /** Read from the session TRANSCRIPT — the same source an audit uses — never from the worker's
   *  self-report, which has already lied twice (cycles 49/50). `null` = unknown, never a default. */
  model: string | null;
  /** More than one = a mid-session model switch. Kept, because collapsing it would hide the very
   *  discrepancy this field exists to catch. */
  models: string[];
  model_source: string | null;
  model_why: string | null;
  /** ALWAYS null: no hook payload carries a pane id. Unknown by absence of source, not by oversight. */
  pane: string | null;
  pane_why: string;
  started_ts: string | null;
  started_why: string | null;
  first_ts: string | null;
  task: string | null;
  events: number;
  types: Record<string, number>;
  /** From the hand-written telemetry ledger, joined by NAME. `null` is a FAILED JOIN, not zero spend. */
  tokens_out: number | null;
  tokens_cycles: number;
  tokens_why: string | null;
  tokens_source: string;
}
export interface Fleet {
  /** From the orchestrator heartbeat. `null` means UNKNOWN — never render it as zero. */
  open_workers: number | null;
  cap: number;
  free_slots: number | null;
  cycle: number | null;
  orchestrator_status: string | null;
  orchestrator_context_pct: number | null;
  source: string;
  known: boolean;
  workers: FleetWorker[];
  /** Sessions with events but no name: they completed no task, so the log never learned who they were. */
  unnamed_sessions: number;
  /** Ledger worker names that matched no card — one worker under two hand-typed names. */
  ledger_only: string[];
  quiet_after_s: number;
  workers_searched: string;
  roster: FleetActor[];
  blind_spots: string[];
}

// ───────────────────────────── cost (PRD R5.2, screen 6) ──────────────────────────────────

export interface CostCycle {
  cycle: number;
  worker: string | null;
  model: string | null;
  tokens_out: number | null;
  tokens_in: number | null;
  cache_read: number | null;
  cache_write: number | null;
  running_total: number | null;
  running_cycles: number | null;
  raw: string;
}

/** Spend per model (GSL-98). `partial` counts the bucket's cycles with an unreadable token field, so
 *  the sum is always printed next to what is missing from it — a cost total that silently skips the
 *  lines it could not parse under-reports with total confidence, and "cheaper than reality" is the one
 *  direction this screen must never err in. A bucket with no readable line at all reads `null`, not 0. */
export interface CostByModel {
  model: string | null;
  cycles: number;
  partial: number;
  readable: number;
  tokens_out: number | null;
  tokens_in: number | null;
  cache_read: number | null;
}
export interface QuotaEvent {
  ts: string | null;
  type: string;
  src: string | null;
  error_type: string | null;
  eta: string | null;
  detail: string | null;
}
/** Quota events, EXPECTED TO BE EMPTY. `searched` is therefore mandatory: an empty section that cannot
 *  say where it looked is indistinguishable from a broken one. */
export interface CostQuota {
  events: QuotaEvent[];
  total: number;
  searched: string;
  why_empty: string | null;
}
export interface Cost {
  cycles: CostCycle[];
  by_model: CostByModel[];
  quota: CostQuota;
  /** Telemetry bullets we could not key on a cycle. Shown, never swallowed. */
  unparsed: number;
  cumulative_total: number | null;
  cumulative_cycles: number | null;
  /** NULL TODAY, and not an oversight: no token ceiling exists anywhere on disk. See `ceiling_why`. */
  ceiling: number | null;
  ceiling_source: string | null;
  ceiling_why: string | null;
  used_pct: number | null;
}

// ───────────────────── the autonomy runway (PRD R5.1 / F5-S1) ─────────────────────

/** What this clock's ZERO means. min() over the raw six is a lie by arithmetic without it. */
export type OnExhaustion =
  /** The night ends here without you: budget exceeded, quota window, an open BLOCKER. */
  | "stops"
  /** The night continues, worse: a forced context roll, a full pane queue. Nobody needs waking. */
  | "degrades"
  /** The night ends here, happily: there is no work left. The good ending. */
  | "completes";

export type ClockState =
  /** A finite number of hours, from real data. */
  | "counting"
  /** It is out, now. */
  | "exhausted"
  /** KNOWN not to be a constraint — 0 blockers, free panes, no quota wait armed. Evidence, not a hole. */
  | "clear"
  /** The source could not be read. Bounds the answer; never drops out silently. NOT the same as `clear`. */
  | "unknown";

export interface RunwayClock {
  axis: "context" | "budget" | "quota" | "slots" | "blockers" | "work" | string;
  label: string;
  on_exhaustion: OnExhaustion;
  state: ClockState;
  hours: number | null;
  eta: string | null;
  gauge: string | null;
  why: string;
  sources: string[];
}

export interface Runway {
  /** Hours until the nearest STOPPING clock. Null when none is counting — read `bound` to know why. */
  hours: number | null;
  /**
   * `exact`   — a stopping clock is counting and every stopping clock is readable.  render "≈ 4h"
   * `upper`   — one is counting, but an unreadable one could be shorter.            render "≤ 4h"
   * `clear`   — none is counting, and all are readable. Nothing will stop you.
   * `unknown` — none is counting, but one is unreadable. We cannot say. NOT `clear`.
   */
  bound: "exact" | "upper" | "clear" | "unknown";
  binding: string | null;
  binding_label: string | null;
  binding_why: string | null;
  binding_eta: string | null;
  /** Stopping clocks we could not read. Each one turns the answer into an upper bound. */
  unknown_axes: string[];
  unknown_axes_all: string[];
  known: number;
  total: number;
  /** The nearest of ALL six, whatever its zero means — so a 2h context roll is never hidden by a 6h runway. */
  next_event: {
    axis: string;
    label: string;
    hours: number | null;
    on_exhaustion: OnExhaustion;
    why: string;
  } | null;
  clocks: RunwayClock[];
  /** One line per axis. The "evidence, not vibes" half of R5.1. */
  trace: string[];
}

/**
 * What Python hands the renderer. Version it: a screen that reads a field the producer stopped
 * emitting must fail loudly at build time, not render a blank card at 03:00.
 */
export interface RenderBundle {
  schema: "gosleep.lab.render/7";
  runway: Runway;
  generated_at: string;
  generated_by: string;
  date: string;
  staleness: Staleness;
  /** What the laboratory knows about its OWN rot (GSL-99). Mandatory: an alarm a producer can silently stop emitting is an alarm that rots. */
  self_health: SelfHealth;
  events: EventStats;
  /**
   * The most recent events ACROSS DAYS, oldest-first, already folded (superseded lines removed).
   *
   * Not "the target day": a timeline that shows only today is blank at 00:05 and blank all morning
   * after a quiet night — and a blank feed looks exactly like a dead hook layer. Screens that want
   * one day filter this by `ts`; the authoritative COUNTS always come from `events` above, computed
   * once in Python, never re-derived here.
   */
  recent_events: LabEvent[];
  /** How many events `recent_events` was capped at. A cap the page does not mention is a lie by omission. */
  recent_cap: number;
  questions: { open: number; by_type: Record<string, number>; items: Question[] };
  queue: Queue;
  tasks: TasksBoard;
  fleet: Fleet;
  cost: Cost;
  decisions: { total: number; recent: Decision[] };
  delivery: Delivery;
  orchestrator: Orchestrator;
  library: Library;
  degraded: Degradation[];
  narrative: { text?: string } | null;
  /**
   * GSL-205: the two URL prefixes every screen needs to turn a printed identifier into a link.
   *
   * OPTIONAL ON PURPOSE. A bundle written by an older chronicler carries no `links` block, and a
   * screen that then invented a prefix would ship links pointing at somebody else's tracker. Absent
   * block → the identifier renders as the plain text it always was. That is the same rule the rest
   * of this dashboard lives by: no source, no claim.
   */
  links?: LinkBases;
}

/**
 * Where an identifier resolves. Produced once, in Python, from the same constants the Tasks board's
 * per-row `jira_url` / `gh_url` are built from — so a key linked from the Timeline and the same key
 * linked from the board cannot point at two different places.
 */
export interface LinkBases {
  /** e.g. https://ainstance-labs.atlassian.net/browse — no trailing slash. */
  jira_base: string | null;
  /** e.g. https://github.com/ainstance-labs/gosleep — no trailing slash. `null` when the remote is not GitHub. */
  gh_base: string | null;
  /** Why `gh_base` is null, for the screens that must explain an absence rather than hide it. */
  gh_base_why?: string | null;
}
