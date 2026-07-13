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

export interface Library {
  digests: LibraryEntry[];
  handoffs: LibraryEntry[];
  dev_history: LibraryEntry[];
  reports: LibraryEntry[];
  prd: LibraryEntry[];
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
  /** From `tracker.issue.updated` (src=poll-fill). Only as fresh as the last poll — see `status_age_s`. */
  status: string | null;
  status_ts: string | null;
  status_age_s: number | null;
  status_age_human: string;
  summary: string | null;
  commits: { sha: string; subject: string; ts?: string; url: string | null }[];
  dev_history: { name: string; href: string }[];
  prs: { number?: number; state?: string; url?: string; title?: string }[];
  jira_url: string;
  /** Always null today: no machine-readable source maps a Jira key to a GitHub issue number. */
  gh_url: string | null;
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
  gh_issue_links: false;
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

export interface Cost {
  cycles: CostCycle[];
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
  schema: "gosleep.lab.render/3";
  runway: Runway;
  generated_at: string;
  generated_by: string;
  date: string;
  staleness: Staleness;
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
}
