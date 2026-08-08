// @gosleep/core — runway (binding-constraint) calculator (GSL-289).
//
// Owner requirement (PRD Phase 7 F7-S1 first bullet): "the owner sees Overview with
// runway = min()". Definition from PRD-gosleep-evolution.md §R5.1 — a composite hours-until-
// exhaustion header, min() over independent clocks, with the binding constraint highlighted:
//
//     RUNWAY ≈ 4h (binding: quota resets 03:00) | ctx 42% | budget 45% | slots 2/3 | blockers 0
//
// The full six-clock set (context, budget, quota-window, fleet slots, open blockers,
// work-remaining) is R5.1's target end-state. This module ships the honest, live-data subset
// available in the shipped DB today (v1). Each clock declares its own hours-left OR null
// ("insufficient data — do not fabricate"); the aggregator picks the SMALLEST hours-left as
// the binding constraint, or reports `binding: null` when every clock is null.
//
// CLOCKS SHIPPED IN v1 (extend here as new data lands, don't invent):
//
//   * context   — per-live-agent linear extrapolation. For an agent with `context_pct = P`
//                 running for `age_h` hours, hours-until-100% ≈ age_h * (100 - P) / max(P, 1).
//                 We take the SMALLEST hours-left across all live agents (fleet is only as
//                 long-lived as its worst-off session). Null when no live agent has both a
//                 non-null context_pct AND age > 5 min (below that the extrapolation is noise).
//   * blockers  — open BLOCKER/permission questions ARE a binding constraint: any owner-
//                 waiting BLOCKER makes runway = 0 h (the fleet cannot self-drive until the
//                 owner answers). count>0 → hours_left = 0; count=0 → hours_left = null
//                 (blockers do not otherwise cap runway).
//   * slots     — informational today: hours_left is always null because the fleet's slot cap
//                 isn't yet a live constraint (target-arch §R5.1 wires the cap into runway
//                 via manifest; that lands in a later ticket). Reported so the tile can still
//                 render `slots N/cap`.
//
// The output shape is FROZEN in this file so the schema/SDK/web tile all target the same
// contract. Adding a clock = one entry in `clocks`, one branch in the picker, one bump in the
// SDK schema. Never mutate an existing clock's shape without a schema version bump.

import type { OpenedDb } from "./db/client.ts";

// -----------------------------------------------------------------------------
// public shape
// -----------------------------------------------------------------------------

export interface RunwayClock {
  /** Hours until this clock is exhausted; null when the clock has no data yet. */
  hours_left: number | null;
  /** Per-clock read-out; the web tile renders these as a sub-line. */
  readout: string;
  /** Extra structured fields for the tile / any downstream calc. Kept as an unknown-typed
   *  map at the schema layer so a clock-specific addition doesn't force an SDK bump. */
  extra?: Record<string, number | string | null>;
}

export interface RunwayResult {
  /** Smallest non-null hours-left across every clock, or null when every clock is null. */
  hours_left: number | null;
  /** Name of the binding clock (matches a key in `clocks`), or null when hours_left is null. */
  binding: string | null;
  /** Number of live agent_sessions rows (informational for the tile header). */
  live_agents: number;
  clocks: {
    context: RunwayClock;
    blockers: RunwayClock;
    slots: RunwayClock;
  };
  /** ISO timestamp of the calc (for the tile's "as of" line). */
  computed_at: string;
}

// -----------------------------------------------------------------------------
// helpers (exported for the bun tests)
// -----------------------------------------------------------------------------

/**
 * Age of a live session in hours, given its `started_at` ISO string. Returns 0 when the parse
 * fails — the caller then discards the extrapolation (age is a divisor guard). Exported for
 * the unit tests so a fixture with a stamped started_at can produce deterministic hours.
 */
export function sessionAgeHours(startedAt: string, nowMs: number): number {
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (nowMs - t) / 3_600_000);
}

/**
 * Linear extrapolation of hours-until-100%-context. Kept a pure function — the DB read is
 * one query away in the caller. NOISE FLOOR: when age < 5 min OR pct <= 0 OR pct >= 100, the
 * extrapolation is meaningless, so we return null and the caller either picks another agent
 * or falls back to null for the whole clock.
 */
export function contextHoursLeft(ageHours: number, pct: number): number | null {
  if (!Number.isFinite(ageHours) || ageHours < 5 / 60) return null;
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;
  const remaining = 100 - pct;
  const perHour = pct / ageHours; // % consumed per hour so far
  if (perHour <= 0) return null;
  return remaining / perHour;
}

interface LiveAgentRow {
  session_id: string;
  name: string;
  context_pct: number | null;
  started_at: string;
}

interface BlockerCountRow {
  n: number;
}

interface SlotCountRow {
  live: number;
}

// -----------------------------------------------------------------------------
// compute
// -----------------------------------------------------------------------------

export interface ComputeRunwayOptions {
  /** Override "now" for tests (ms since epoch). */
  nowMs?: number;
  /** Test hook: pass a canned live-agent list, skipping the DB read. */
  liveAgents?: Array<{
    session_id: string;
    name: string;
    context_pct: number | null;
    started_at: string;
  }>;
  /** Test hook: pass a canned open-blocker count. */
  openBlockers?: number;
  /** Test hook: override the slot cap. Defaults to 3 (target-arch R5.1 exemplar). */
  slotCap?: number;
}

/**
 * Compute the runway across every live clock. Never throws; a DB read failure produces the
 * empty-data shape (`hours_left: null`, all clocks null) rather than a 500. The route reader
 * folds this into /status.
 */
export function computeRunway(db: OpenedDb, opts: ComputeRunwayOptions = {}): RunwayResult {
  const nowMs = opts.nowMs ?? Date.now();
  const computed_at = new Date(nowMs).toISOString();
  const slotCap =
    typeof opts.slotCap === "number" && opts.slotCap > 0 ? Math.trunc(opts.slotCap) : 3;

  // --- 1. live agents + context clock -------------------------------------
  let liveAgents: LiveAgentRow[];
  if (opts.liveAgents !== undefined) {
    liveAgents = opts.liveAgents.map((a) => ({
      session_id: a.session_id,
      name: a.name,
      context_pct: a.context_pct,
      started_at: a.started_at,
    }));
  } else {
    try {
      liveAgents = db.raw
        .query(
          `SELECT session_id, name, context_pct, started_at
           FROM agent_sessions
           WHERE ended_at IS NULL`,
        )
        .all() as LiveAgentRow[];
    } catch {
      liveAgents = [];
    }
  }

  let bindingAgentName: string | null = null;
  let bindingAgentPct: number | null = null;
  let contextHoursLeftMin: number | null = null;
  let maxPctSeen = -1;
  for (const a of liveAgents) {
    if (a.context_pct === null || a.context_pct === undefined) continue;
    if (a.context_pct > maxPctSeen) maxPctSeen = a.context_pct;
    const age = sessionAgeHours(a.started_at, nowMs);
    const h = contextHoursLeft(age, a.context_pct);
    if (h === null) continue;
    if (contextHoursLeftMin === null || h < contextHoursLeftMin) {
      contextHoursLeftMin = h;
      bindingAgentName = a.name;
      bindingAgentPct = a.context_pct;
    }
  }

  const contextClock: RunwayClock = {
    hours_left: contextHoursLeftMin === null ? null : Number(contextHoursLeftMin.toFixed(2)),
    readout:
      maxPctSeen < 0
        ? "ctx —"
        : bindingAgentName !== null
          ? `ctx ${bindingAgentPct}% (${bindingAgentName})`
          : `ctx ${maxPctSeen}% (no runway yet)`,
    extra: {
      max_pct: maxPctSeen < 0 ? null : maxPctSeen,
      binding_agent: bindingAgentName,
      binding_agent_pct: bindingAgentPct,
    },
  };

  // --- 2. open BLOCKERs clock ---------------------------------------------
  let openBlockers: number;
  if (typeof opts.openBlockers === "number") {
    openBlockers = opts.openBlockers;
  } else {
    try {
      const row = db.raw
        .query(
          `SELECT count(*) AS n FROM questions
           WHERE status = 'open' AND kind IN ('BLOCKER','permission')`,
        )
        .get() as BlockerCountRow | undefined;
      openBlockers = row?.n ?? 0;
    } catch {
      openBlockers = 0;
    }
  }

  const blockersClock: RunwayClock = {
    // An open BLOCKER is a hard stop for the owner-can-sleep question: runway = 0.
    // No open blockers means this clock does not cap the runway (null, not Infinity).
    hours_left: openBlockers > 0 ? 0 : null,
    readout: `blockers ${openBlockers}`,
    extra: { open: openBlockers },
  };

  // --- 3. slot clock (informational v1) -----------------------------------
  let liveCount: number;
  if (opts.liveAgents !== undefined) {
    liveCount = liveAgents.length;
  } else {
    try {
      const row = db.raw
        .query(
          `SELECT count(*) AS live FROM agent_sessions WHERE ended_at IS NULL`,
        )
        .get() as SlotCountRow | undefined;
      liveCount = row?.live ?? 0;
    } catch {
      liveCount = 0;
    }
  }

  const slotsClock: RunwayClock = {
    hours_left: null, // informational until the manifest cap is wired in R5.1
    readout: `slots ${liveCount}/${slotCap}`,
    extra: { live: liveCount, cap: slotCap },
  };

  // --- pick binding constraint --------------------------------------------
  const candidates: Array<{ name: string; h: number }> = [];
  if (contextClock.hours_left !== null)
    candidates.push({ name: "context", h: contextClock.hours_left });
  if (blockersClock.hours_left !== null)
    candidates.push({ name: "blockers", h: blockersClock.hours_left });
  if (slotsClock.hours_left !== null)
    candidates.push({ name: "slots", h: slotsClock.hours_left });

  let hoursLeft: number | null = null;
  let binding: string | null = null;
  for (const c of candidates) {
    if (hoursLeft === null || c.h < hoursLeft) {
      hoursLeft = c.h;
      binding = c.name;
    }
  }

  return {
    hours_left: hoursLeft,
    binding,
    live_agents: liveCount,
    clocks: {
      context: contextClock,
      blockers: blockersClock,
      slots: slotsClock,
    },
    computed_at,
  };
}
