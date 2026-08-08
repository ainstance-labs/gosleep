// @gosleep/core — SSE rotation tests (GSL-263).
//
// UTC-day rotation contract (target-arch 6.1, "closes major red-team finding 5"): when the
// server's wall clock crosses 00:00 UTC, the SSE broadcaster fires ONE `event: rotate` frame
// with `data: {new_day: "YYYY-MM-DD"}`. Clients invalidate their caches. Missing that fire =
// stale dashboards for the next 24 hours.
//
// Tests inject a fake `now()` so we can advance the wall clock synchronously without waiting
// for the real timer. The rotation watcher also accepts an `emit` override so the assertion
// checks direct callback invocation rather than routing through the global broadcaster.

import { describe, expect, test } from "bun:test";

import { startRotationWatcher, utcDay } from "../src/sse/rotation.ts";
import { broadcaster } from "../src/sse/broadcaster.ts";

describe("rotation watcher", () => {
  test("fires exactly one rotate on UTC day change", () => {
    let simulatedNow = new Date("2026-08-07T23:59:00.000Z");
    const fired: string[] = [];
    const watcher = startRotationWatcher({
      intervalMs: 1_000_000,
      now: () => simulatedNow,
      emit: (newDay) => fired.push(newDay),
    });
    expect(watcher.currentDay()).toBe("2026-08-07");

    // First check within same day — no emit.
    watcher.check();
    expect(fired.length).toBe(0);

    // Cross the boundary.
    simulatedNow = new Date("2026-08-08T00:00:30.000Z");
    watcher.check();
    expect(fired).toEqual(["2026-08-08"]);
    expect(watcher.currentDay()).toBe("2026-08-08");

    // Same day again — no additional emit.
    simulatedNow = new Date("2026-08-08T12:00:00.000Z");
    watcher.check();
    expect(fired.length).toBe(1);

    // Cross another boundary.
    simulatedNow = new Date("2026-08-09T00:05:00.000Z");
    watcher.check();
    expect(fired).toEqual(["2026-08-08", "2026-08-09"]);
    watcher.stop();
  });

  test("does NOT emit on the first tick after boot (prime only)", () => {
    let simulatedNow = new Date("2026-08-07T23:59:00.000Z");
    const fired: string[] = [];
    const watcher = startRotationWatcher({
      intervalMs: 1_000_000,
      now: () => simulatedNow,
      emit: (day) => fired.push(day),
    });
    // Not moving the clock: check() must be a no-op.
    watcher.check();
    watcher.check();
    watcher.check();
    expect(fired).toEqual([]);
    watcher.stop();
  });

  test("subscriber-throwing does not disable the watcher", () => {
    let simulatedNow = new Date("2026-08-07T23:59:00.000Z");
    let calls = 0;
    const watcher = startRotationWatcher({
      intervalMs: 1_000_000,
      now: () => simulatedNow,
      emit: () => {
        calls += 1;
        throw new Error("subscriber failure");
      },
    });

    simulatedNow = new Date("2026-08-08T00:00:00.000Z");
    watcher.check(); // emit throws → swallowed
    simulatedNow = new Date("2026-08-09T00:00:00.000Z");
    watcher.check(); // emit runs again despite prior throw
    expect(calls).toBe(2);
    expect(watcher.currentDay()).toBe("2026-08-09");
    watcher.stop();
  });

  test("utcDay derives the correct 'YYYY-MM-DD' bucket", () => {
    expect(utcDay(new Date("2026-08-07T23:59:59.999Z"))).toBe("2026-08-07");
    expect(utcDay(new Date("2026-08-08T00:00:00.000Z"))).toBe("2026-08-08");
    // Timezone-independent — even if local TZ is behind UTC, the bucket stays UTC.
    expect(utcDay(new Date("2026-08-08T00:00:00.000+02:00"))).toBe("2026-08-07");
  });

  test("broadcaster emits rotate message with new_day payload", () => {
    const received: Array<{ event: string; data: unknown }> = [];
    const unsub = broadcaster.subscribe((msg) => {
      if (msg.event === "rotate") received.push({ event: msg.event, data: msg.data });
    });
    broadcaster.emitRotate("2026-08-08");
    unsub();
    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ event: "rotate", data: { new_day: "2026-08-08" } });
  });
});
