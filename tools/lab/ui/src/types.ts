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

/**
 * What Python hands the renderer. Version it: a screen that reads a field the producer stopped
 * emitting must fail loudly at build time, not render a blank card at 03:00.
 */
export interface RenderBundle {
  schema: "gosleep.lab.render/1";
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
  decisions: { total: number; recent: Decision[] };
  delivery: Delivery;
  orchestrator: Orchestrator;
  library: Library;
  degraded: Degradation[];
  narrative: { text?: string } | null;
}
