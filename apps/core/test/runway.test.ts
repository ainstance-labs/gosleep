// @gosleep/core — runway calculator (GSL-289) unit tests.
//
// Every branch of `computeRunway` is exercised with a fake DB (opts.liveAgents +
// opts.openBlockers hooks) so the tests never touch a real SQLite file. Coverage:
//
//   - No live agents, no blockers → hours_left null, binding null.
//   - One live agent with context 40% for 2h → hours_left ≈ 3h, binding "context".
//   - Multiple live agents → the WORST (smallest hours_left) wins.
//   - Blockers > 0 → hours_left 0, binding "blockers" — even against a healthy context.
//   - Blockers > 0 and no live agents → still binding "blockers".
//   - Live agent with age < 5 min → context clock stays null (extrapolation noise floor).
//   - Live agent with context 0 or ≥ 100 → clock null (guarded division / out-of-range).
//   - Slots always report `slots N/cap` in readout.

import { describe, expect, test } from "bun:test";

import {
  computeRunway,
  contextHoursLeft,
  sessionAgeHours,
} from "../src/runway.ts";
import type { OpenedDb } from "../src/db/client.ts";

// Fake DB shim — computeRunway shouldn't touch it when the opts hooks are set. If any code
// path reaches it, the query() proxy throws which fails the test loudly.
const DB_UNUSED = new Proxy(
  {},
  {
    get() {
      throw new Error("computeRunway must not touch DB when opts hooks are set");
    },
  },
) as unknown as OpenedDb;

describe("sessionAgeHours (GSL-289)", () => {
  test("returns 0 for an unparseable timestamp", () => {
    expect(sessionAgeHours("not-a-date", 1_700_000_000_000)).toBe(0);
  });

  test("computes wall-clock hours between started_at and now", () => {
    const now = Date.parse("2026-08-08T12:00:00Z");
    const started = "2026-08-08T09:00:00Z";
    expect(sessionAgeHours(started, now)).toBeCloseTo(3, 5);
  });

  test("negative delta clamps to 0 (never a negative age)", () => {
    const now = Date.parse("2026-08-08T09:00:00Z");
    const started = "2026-08-08T12:00:00Z";
    expect(sessionAgeHours(started, now)).toBe(0);
  });
});

describe("contextHoursLeft (GSL-289)", () => {
  test("linear extrapolation: 40% after 2h → 3h left", () => {
    // Consuming 20 %/h → 60 % remaining ÷ 20 %/h = 3 h.
    expect(contextHoursLeft(2, 40)).toBeCloseTo(3, 5);
  });

  test("returns null when age < 5 min (noise floor)", () => {
    expect(contextHoursLeft(1 / 60, 40)).toBeNull();
  });

  test("returns null when pct ≤ 0 (empty context)", () => {
    expect(contextHoursLeft(2, 0)).toBeNull();
    expect(contextHoursLeft(2, -1)).toBeNull();
  });

  test("returns null when pct ≥ 100 (already exhausted — no runway)", () => {
    expect(contextHoursLeft(2, 100)).toBeNull();
    expect(contextHoursLeft(2, 101)).toBeNull();
  });
});

describe("computeRunway (GSL-289)", () => {
  const NOW = Date.parse("2026-08-08T12:00:00Z");

  test("empty fleet, zero blockers → all clocks null, binding null", () => {
    const r = computeRunway(DB_UNUSED, {
      nowMs: NOW,
      liveAgents: [],
      openBlockers: 0,
    });
    expect(r.hours_left).toBeNull();
    expect(r.binding).toBeNull();
    expect(r.live_agents).toBe(0);
    expect(r.clocks.context.hours_left).toBeNull();
    expect(r.clocks.blockers.hours_left).toBeNull();
    expect(r.clocks.slots.hours_left).toBeNull();
    expect(r.clocks.slots.readout).toBe("slots 0/3");
  });

  test("one live agent at 40% for 2h → context is binding at ~3h", () => {
    const r = computeRunway(DB_UNUSED, {
      nowMs: NOW,
      liveAgents: [
        {
          session_id: "a",
          name: "gosleep-1",
          context_pct: 40,
          started_at: "2026-08-08T10:00:00Z",
        },
      ],
      openBlockers: 0,
    });
    expect(r.binding).toBe("context");
    expect(r.hours_left).toBeCloseTo(3, 1);
    expect(r.live_agents).toBe(1);
    expect(r.clocks.context.readout).toContain("gosleep-1");
    expect(r.clocks.context.extra?.binding_agent).toBe("gosleep-1");
  });

  test("multiple live agents — the worst runway wins the binding label", () => {
    const r = computeRunway(DB_UNUSED, {
      nowMs: NOW,
      liveAgents: [
        // Healthy: 10% after 4h → 36h left.
        { session_id: "a", name: "healthy", context_pct: 10, started_at: "2026-08-08T08:00:00Z" },
        // Worst: 80% after 2h → 0.5h left. Binding.
        { session_id: "b", name: "worst", context_pct: 80, started_at: "2026-08-08T10:00:00Z" },
      ],
      openBlockers: 0,
    });
    expect(r.binding).toBe("context");
    expect(r.hours_left).toBeCloseTo(0.5, 1);
    expect(r.clocks.context.readout).toContain("worst");
  });

  test("open BLOCKERs beat a healthy context — binding is 'blockers', runway is 0", () => {
    const r = computeRunway(DB_UNUSED, {
      nowMs: NOW,
      liveAgents: [
        // Healthy 10% for 4h → context clock ~36h.
        { session_id: "a", name: "ok", context_pct: 10, started_at: "2026-08-08T08:00:00Z" },
      ],
      openBlockers: 3,
    });
    expect(r.binding).toBe("blockers");
    expect(r.hours_left).toBe(0);
    expect(r.clocks.blockers.readout).toBe("blockers 3");
  });

  test("blockers with no live agents still binds to 0h", () => {
    const r = computeRunway(DB_UNUSED, {
      nowMs: NOW,
      liveAgents: [],
      openBlockers: 1,
    });
    expect(r.binding).toBe("blockers");
    expect(r.hours_left).toBe(0);
  });

  test("live agent aged 1 min → context clock still null (below noise floor)", () => {
    const r = computeRunway(DB_UNUSED, {
      nowMs: NOW,
      liveAgents: [
        {
          session_id: "a",
          name: "brand-new",
          context_pct: 40,
          started_at: "2026-08-08T11:59:00Z",
        },
      ],
      openBlockers: 0,
    });
    expect(r.clocks.context.hours_left).toBeNull();
    expect(r.hours_left).toBeNull();
    expect(r.binding).toBeNull();
    // But max_pct is still surfaced so the tile can show "ctx 40% (no runway yet)".
    expect(r.clocks.context.readout).toContain("no runway yet");
  });

  test("readout stays truthful when every agent's context_pct is null", () => {
    const r = computeRunway(DB_UNUSED, {
      nowMs: NOW,
      liveAgents: [
        { session_id: "a", name: "x", context_pct: null, started_at: "2026-08-08T09:00:00Z" },
      ],
      openBlockers: 0,
    });
    expect(r.clocks.context.readout).toBe("ctx —");
    expect(r.clocks.context.hours_left).toBeNull();
    expect(r.live_agents).toBe(1);
  });

  test("slot cap is configurable — read-out reflects the passed cap", () => {
    const r = computeRunway(DB_UNUSED, {
      nowMs: NOW,
      liveAgents: [
        { session_id: "a", name: "x", context_pct: null, started_at: "2026-08-08T09:00:00Z" },
        { session_id: "b", name: "y", context_pct: null, started_at: "2026-08-08T09:00:00Z" },
      ],
      openBlockers: 0,
      slotCap: 5,
    });
    expect(r.clocks.slots.readout).toBe("slots 2/5");
    expect(r.clocks.slots.extra?.cap).toBe(5);
    expect(r.clocks.slots.extra?.live).toBe(2);
  });

  test("computed_at echoes the injected nowMs", () => {
    const r = computeRunway(DB_UNUSED, {
      nowMs: NOW,
      liveAgents: [],
      openBlockers: 0,
    });
    expect(r.computed_at).toBe(new Date(NOW).toISOString());
  });
});
