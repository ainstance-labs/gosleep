// =============================================================================
// The severity of a timeline row (PRD R5.2, screen 2: "фильтры actor/type/severity, incident-маркеры").
//
// THERE IS NO SEVERITY FIELD ON A LAB EVENT, and there never was. The envelope (docs/lab/events/
// README.md) carries ts / actor / type / src / data and nothing that grades them. So severity is
// DERIVED here, in the view layer, out of the closed type vocabulary — exactly as srcClass() derives
// the provenance colour from `src`. The mapping below is the entire claim: no payload is inspected,
// nothing is guessed.
//
// The one rule that carries weight:
//
//     A TYPE THIS TABLE DOES NOT KNOW IS `unknown` — NEVER `info`.
//
// The tempting shape is `return INCIDENT.has(t) ? "incident" : "info"`, and it is wrong in the one
// direction that costs a night. Add `breaker.tripped` to the emitters tomorrow and that version files
// it as info: a green row, in a feed the owner scans for red, for the event that says the fleet is
// down. A table is allowed to LAG the emitters. It is not allowed to lie about the gap — so an
// unclassified type renders loudly as `unknown`, is filterable as `unknown`, and is counted as
// `unknown`. smoke.sh greps the two emitters (lab-log.sh, lab-emit.sh) and fails if this file has
// fallen behind either, which is how the lag is kept honest rather than merely survivable.
//
// The limit of a type-level grade, stated so no one reads more into it than is there: a
// `verify.verdict` carrying a FAIL is `info` here, because its failure lives in `data`, not in its
// type. The Timeline screen says so in its blind-spots card rather than letting the reader assume the
// colour saw something it did not.
// =============================================================================

export type Severity = "incident" | "warn" | "info" | "unknown";

/** Filter order = worst first. The owner scanning a night at 03:00 opens the incidents, not the pushes. */
export const SEVERITIES: readonly Severity[] = ["incident", "warn", "info", "unknown"] as const;

/**
 * The night is broken, or is about to stop. Every one of these either ENDS autonomous work or proves
 * something already went wrong: the API refused us (`api.failure` is the quota-window detector), the
 * breaker cut the circuit, we are parked waiting on a quota reset, the watchdog had to restart
 * something, the log itself started dropping lines, or a tool call was refused outright.
 */
const INCIDENT: ReadonlySet<string> = new Set([
  "api.failure",
  "breaker.opened",
  "quota.wait_started",
  "restart.recorded",
  "lab.capped",
  "permission.denied",
]);

/**
 * The night goes on, degraded — or blind. A compaction on the orchestrator is a red flag
 * (events/README.md). `hook.unmapped` means Claude Code emitted an event this laboratory does not
 * understand: a hole in the mechanical record, which is the half of the log that costs no tokens and
 * needs no model's cooperation. `question.posed` is here because from the TYPE alone we cannot tell a
 * BLOCKER (which stops the night, and takes no default, ever) from an FYI.
 */
const WARN: ReadonlySet<string> = new Set([
  "context.pre_compact",
  "hook.unmapped",
  "agent.idle",
  "notification.raised",
  "permission.requested",
  "question.posed",
  // GSL-278: a defer is a soft "not now" the owner ticked — worth surfacing in the timeline
  // (the row is not answered), but not louder than that.
  "question.deferred",
  // GSL-218: a wedged verifier is a degradation the orchestrator recovers from
  // (kill the automation, take the partial report) — not a night-ender.
  "verifier.stalled",
]);

/** Work happening, and work happening normally. The bulk of any healthy night. */
const INFO: ReadonlySet<string> = new Set([
  "pane.started",
  "pane.ended",
  "agent.spawned",
  "agent.terminated",
  "agent.turn_ended",
  "agent.message",
  "context.post_compact",
  "task.created",
  "task.completed",
  "vcs.commit",
  "vcs.push",
  "vcs.pr.opened",
  "vcs.pr.merged",
  "tracker.issue.created",
  "tracker.issue.transitioned",
  "tracker.issue.updated",
  "handoff.written",
  "dev_history.written",
  "run.started",
  "run.finished",
  "cycle.started",
  "cycle.ended",
  "question.answered",
  "question.auto_resolved",
  "question.deduped",
  // GSL-278: auto-reopen worker flipped a deferred row back to open — normal work.
  "question.reopened",
  "decision.made",
  "verify.verdict",
  "mode.entered",
  "quota.wait_ended",
  "breaker.closed",
]);

/* ─────────────── GSL-208: the second axis — is this row about the WORK? ───────────────
 *
 * Severity grades how bad a row is. It cannot answer the other question the owner asks of a night:
 * "show me what happened, not the fleet breathing." Four types account for well over a third of every
 * feed — a pane opening, a pane closing, a turn ending, an agent speaking — and none of them names a
 * commit, a ticket, a decision or a question. They are how the machine sounds, not what it did.
 *
 * Two properties, and both are the same lesson severityOf teaches one file up:
 *
 *   · a type this list does not know is MEANINGFUL, never routine. Add `breaker.tripped` to the
 *     emitters tomorrow and a default-to-routine version would file it under the rows the owner just
 *     hid. Unclassified must fall on the side that stays visible.
 *   · this hides nothing on its own. It is a facet like any other, so the count sentence names every
 *     row it takes away (filter.ts) — the one rule that makes a filter safe on this dashboard.
 */
export type SignalMode = "meaningful" | "routine";

/** Filter order: the reason someone reaches for this control comes first. */
export const SIGNAL_MODES: readonly SignalMode[] = ["meaningful", "routine"] as const;

const ROUTINE: ReadonlySet<string> = new Set([
  "pane.started",
  "pane.ended",
  "agent.turn_ended",
  "agent.message",
]);

export function signalOf(type: string | null | undefined): SignalMode {
  return ROUTINE.has(String(type ?? "")) ? "routine" : "meaningful";
}

export function severityOf(type: string | null | undefined): Severity {
  const t = String(type ?? "");
  if (INCIDENT.has(t)) return "incident";
  if (WARN.has(t)) return "warn";
  if (INFO.has(t)) return "info";
  return "unknown"; // ← the whole point. See the header.
}

/** Every type this table classifies. smoke.sh checks the emitters against it — see the header. */
export const CLASSIFIED_TYPES: readonly string[] = [...INCIDENT, ...WARN, ...INFO].sort();
