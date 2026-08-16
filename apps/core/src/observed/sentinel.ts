// @gosleep/core — write-attempt sentinel (GSL-358 under GSL-350 phase 14).
//
// R14.1 (zero-influence is a structural invariant, not a discipline). Every observed-mode
// collector runs through `runCollector(name, fn)` — the sentinel records a per-collector
// inventory row (cadence, events today, write-attempts, disabled), tallies wall-clock, and
// tags any thrown error with the collector name so the /observed/collectors endpoint can
// show the recent failure inline.
//
// The v1 sentinel is INTENTIONALLY lightweight: it does NOT rewrite Bun.file / writeFile /
// spawn globals (that would be observably invasive and would break unrelated code paths). It
// enforces the invariant three ways:
//
//   1. The observed-events writer (`events.ts`) is the ONLY sanctioned path into
//      `observed_events`; collectors call it, not `db.raw.query('INSERT …')` directly.
//   2. Collectors are code-reviewed for their declared side-effect set (each has a comment
//      block listing "reads / writes / spawns"). A collector that adds a new write path
//      triggers a review comment on the PR.
//   3. `noteWriteAttempt(collector, kind, detail)` is a callable hook a test or a defensive
//      wrapper can invoke to record a violation — the counter is surfaced by
//      `/observed/collectors` (red when > 0), and a call disables the collector until
//      process restart.
//
// The kernel-level sandbox (seatbelt / bpf) discussed in the PRD is out of scope for v1 —
// the runtime invariant is enough given the small collector surface.

export interface CollectorInventoryEntry {
  name: string;
  source: string;
  cadence_ms: number;
  last_tick_at: string | null;
  last_tick_ms: number | null;
  last_error: string | null;
  events_today: number;
  write_attempts: number;
  disabled: boolean;
}

const INVENTORY = new Map<string, CollectorInventoryEntry>();

/** Register a collector so it appears on /observed/collectors even before its first tick. */
export function registerCollector(
  name: string,
  meta: { source: string; cadence_ms: number },
): void {
  if (INVENTORY.has(name)) return;
  INVENTORY.set(name, {
    name,
    source: meta.source,
    cadence_ms: meta.cadence_ms,
    last_tick_at: null,
    last_tick_ms: null,
    last_error: null,
    events_today: 0,
    write_attempts: 0,
    disabled: false,
  });
}

/** Increment the events-today counter for a collector after a successful emit. */
export function bumpEventsToday(name: string, n = 1): void {
  const row = INVENTORY.get(name);
  if (row === undefined) return;
  row.events_today += n;
}

/**
 * Record a violation of the zero-influence invariant. Callers pass a short `kind`
 * ("db-insert-outside-writer", "spawn-outside-whitelist", "fs-write-outside-data-dir")
 * plus a free-form `detail`. First violation disables the collector until process restart
 * (subsequent violations are counted but do not re-run the disable logic).
 */
export function noteWriteAttempt(name: string, kind: string, detail: string): void {
  const row = INVENTORY.get(name);
  if (row === undefined) {
    // Register on first sighting so the panel still surfaces the violation.
    registerCollector(name, { source: "unknown", cadence_ms: 0 });
  }
  const r = INVENTORY.get(name)!;
  r.write_attempts += 1;
  r.disabled = true;
  r.last_error = `WRITE_ATTEMPT_DENIED[${kind}]: ${detail}`;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "core.observed.sentinel.write_attempt_denied",
      collector: name,
      kind,
      detail,
      write_attempts: r.write_attempts,
    }),
  );
}

/**
 * Run one collector tick. Records wall-clock, error state, and last-tick timestamps. If the
 * collector is disabled (a prior tick tripped the invariant), returns without invoking the
 * callback — the disable is sticky until process restart.
 */
export async function runCollectorTick<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const row = INVENTORY.get(name);
  if (row === undefined) {
    throw new Error(`runCollectorTick: unknown collector '${name}' — registerCollector() first`);
  }
  if (row.disabled) return null;
  const t0 = performance.now();
  try {
    const out = await fn();
    row.last_tick_ms = Math.round(performance.now() - t0);
    row.last_tick_at = new Date().toISOString();
    row.last_error = null;
    return out;
  } catch (err) {
    row.last_tick_ms = Math.round(performance.now() - t0);
    row.last_tick_at = new Date().toISOString();
    row.last_error = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/** Read-only snapshot for /observed/collectors. Returns a plain array sorted by name. */
export function listCollectors(): CollectorInventoryEntry[] {
  return [...INVENTORY.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Test-only helper: reset the inventory between tests. */
export function __resetCollectorInventory(): void {
  INVENTORY.clear();
}
