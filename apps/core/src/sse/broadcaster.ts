// @gosleep/core — SSE broadcaster (GSL-263).
//
// In-process EventEmitter that fans out newly-inserted `events` rows (and UTC-day rotation
// markers) to every connected SSE subscriber. This is deliberately in-process — the control
// plane runs as a single Bun process (launchd's `com.gosleep.core.plist`, one instance), so
// no cross-process pub/sub bus (Redis, PostgreSQL LISTEN/NOTIFY, in-DB triggers) is needed.
// Target-arch section 6.1 explicitly names in-process EventEmitter as the mechanism.
//
// Emission model:
//   - `emit(row)` fires an `event` message with `id = row.seq`. This is what the browser sees
//     as its `Last-Event-ID` on reconnect. The row payload is the shape returned by
//     `process.ts::EventRow`.
//   - `emitRotate(day)` fires a `rotate` message when the indexer's rotation watcher observes
//     a UTC day transition. Data = `{new_day: "YYYY-MM-DD"}`. Clients invalidate all queries
//     (target-arch 6.1 last bullet, and it closes the "major red-team finding 5" per ticket).
//
// This module carries NO knowledge of Hono / SSE wire format — that lives in the /events route
// (`routes/events.ts`) which subscribes here and translates each emit into `writeSSE()` calls.
// The separation lets tests (`test/sse.rotation.test.ts`) exercise the broadcaster without
// booting a server.

import { EventEmitter } from "node:events";
import type { EventRow } from "../indexer/process.ts";

/** SSE message shape yielded to subscribers. `id` doubles as the SSE `Last-Event-ID`. */
export interface BroadcastMessage {
  kind: "event" | "rotate" | "observed";
  id: number | null;
  event: string;
  data: unknown;
}

/**
 * GSL-355 — observed-events broadcast shape. Kept in a distinct wire kind (`observed`) so the
 * gosleep timeline (`event`) and the observed timeline (`observed`) can coexist on the same
 * broadcaster without collision (R14.7). The `/events` stream ignores `observed` kinds and a
 * future `/observed/events` SSE stream ignores `event` kinds. `id` is the observed_events.seq.
 */
export interface ObservedEventPayload {
  seq: number;
  ts: string;
  project_slug: string | null;
  kind: string;
  source: string;
  payload: unknown;
}

/**
 * The one-and-only in-process broadcaster. Keep it a singleton — every subscriber and every
 * emitter must land on the same emitter instance, or a client would silently miss events fired
 * on a sibling instance.
 */
class Broadcaster {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Node's default is 10 listeners → warning-and-drop above that. A local dev harness might
    // legitimately want 2-3 tabs open on the dashboard; bump to 64 to give headroom without
    // masking a real leak.
    this.emitter.setMaxListeners(64);
  }

  /**
   * Broadcast a freshly-inserted `events` row. The tail indexer calls this once per row after
   * commit; the SSE route sees it and writes to every open stream.
   */
  emit(row: EventRow): void {
    // Data payload = a subset shaped for the wire. Keep the columns clients need without
    // spilling raw JSON that duplicates already-projected fields.
    const data = {
      seq: row.seq,
      day: row.day,
      ts: row.ts,
      src: row.src,
      actor: row.actor,
      task: row.task,
      type: row.type,
      payload: row.payload,
    };
    const msg: BroadcastMessage = {
      kind: "event",
      id: row.seq,
      event: row.type, // e.g. "cycle.started", "verify.verdict" — clients can filter by name
      data,
    };
    this.emitter.emit("message", msg);
  }

  /**
   * Broadcast a UTC-day rotation. Callers (rotation.ts) pass the NEW day string ("2026-08-08").
   * Rotation carries no `id` — a reconnect using `Last-Event-ID` still resumes from the last
   * event's seq, not the rotate marker; a rotation missed during disconnect is inconsequential
   * because the client will invalidate on the NEXT rotate or on the reconnect backfill query.
   */
  emitRotate(newDay: string): void {
    const msg: BroadcastMessage = {
      kind: "rotate",
      id: null,
      event: "rotate",
      data: { new_day: newDay },
    };
    this.emitter.emit("message", msg);
  }

  /**
   * GSL-355 — broadcast an observed_events row. Kept in its own wire kind so the /events
   * stream never sees it — the /observed/events stream is a distinct topic (R14.7).
   */
  emitObserved(row: ObservedEventPayload): void {
    const msg: BroadcastMessage = {
      kind: "observed",
      id: row.seq,
      event: `observed.${row.kind}`,
      data: row,
    };
    this.emitter.emit("message", msg);
  }

  /** Register a subscriber. Returns an unsubscribe function; call it on stream close. */
  subscribe(cb: (msg: BroadcastMessage) => void): () => void {
    this.emitter.on("message", cb);
    return () => this.emitter.off("message", cb);
  }

  /** Test-only: current subscriber count. */
  subscriberCount(): number {
    return this.emitter.listenerCount("message");
  }
}

export const broadcaster = new Broadcaster();
export type { Broadcaster };
