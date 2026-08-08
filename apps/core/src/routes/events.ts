// @gosleep/core — SSE events route (GSL-263).
//
//   GET /events?since=<seq>
//
// Server-Sent Events stream of everything landing in the `events` table plus UTC-day rotation
// notifications. Requires a Bearer (same as every other read endpoint that touches data).
//
// Reconnect / resume protocol (target-arch section 6.1):
//   - The browser stores the SSE `id:` of the last message it saw and sends it back as the
//     `Last-Event-ID` header on reconnect. We prefer that header over the `?since=` query
//     parameter (per the SSE standard, `Last-Event-ID` is the resume authority — a client
//     sending `?since=0` on reconnect would otherwise re-flood).
//   - On connect we query events with `seq > lastSeen` in ascending order and write them all
//     as normal `event:` frames. This is the "backfill" that guarantees no message loss
//     across a disconnect window.
//   - After backfill we subscribe to the in-process broadcaster (`sse/broadcaster.ts`). Every
//     `events` row the tail indexer inserts after commit fires the subscriber. Every UTC-day
//     transition fires an `event: rotate` frame with `data: {new_day: "…"}`.
//
// Never-resolve-early (per Hono issue #2050, rev-3 addendum): `streamSSE`'s callback MUST NOT
// return while the connection is open, or Hono treats the stream as complete and shuts the
// response mid-flight. We satisfy this by looping on a "message OR heartbeat OR abort" race —
// the loop exits ONLY when `stream.aborted` flips true (client disconnected) or the response
// context is torn down.
//
// Heartbeat: an SSE comment (`: keepalive\n\n`) every 20 s so intermediary buffers (Nginx,
// some browser tabs on iOS) do not idle-close the stream. 20 s is inside the target-arch's
// 15-30 s window; 20 s is a round number that lets us assert "at least one heartbeat within
// 30 s" without race flakes in tests.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { requireBearer } from "../security/bearer.ts";
import { broadcaster, type BroadcastMessage } from "../sse/broadcaster.ts";
import { getDb } from "../db/client.ts";

export const eventsRoutes = new Hono();

/** Heartbeat cadence in ms. Target-arch says 15-30 s; we pick 20. */
const HEARTBEAT_MS = 20_000;

/** How many rows to page-through when serving the backfill. Bounded so a first-time
 *  connection with a huge event log does not stall the response for seconds. */
const BACKFILL_PAGE = 500;

/**
 * Parse the resume position. `Last-Event-ID` (SSE standard) wins over `?since=` — a browser
 * that just reconnected always has a Last-Event-ID; a first-time subscriber has neither and
 * defaults to seq=0 (backfill everything).
 *
 * A malformed value coerces to 0 rather than 400 — the client should still succeed on a
 * corrupted resume cursor; the backfill starts from the beginning and the client de-dupes
 * on its own `id` state.
 */
function resolveResumeSeq(header: string | undefined, query: string | undefined): number {
  const raw = header !== undefined && header.length > 0 ? header : (query ?? "");
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

eventsRoutes.get("/events", requireBearer, async (c) => {
  const lastEventIdHeader = c.req.header("last-event-id");
  const sinceQuery = c.req.query("since");
  const startSeq = resolveResumeSeq(lastEventIdHeader, sinceQuery);

  return streamSSE(c, async (stream) => {
    // --- 1. Message queue + notification primitive ----------------------------
    // The broadcaster fires callbacks synchronously — we push into a queue so a burst of
    // events cannot back-pressure the emitter. The loop drains the queue between waits.
    const queue: BroadcastMessage[] = [];
    let notify: (() => void) | null = null;

    const push = (msg: BroadcastMessage): void => {
      queue.push(msg);
      if (notify !== null) {
        const fn = notify;
        notify = null;
        fn();
      }
    };

    // --- 2. Backfill from SQLite ---------------------------------------------
    // Every row with seq > startSeq gets written before we subscribe to live events. Paginated
    // so a very large backfill does not block the loop; each page yields to the event loop.
    const db = getDb();
    let cursor = startSeq;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = db.raw
        .query(
          `SELECT seq, day, ts, src, actor, task, type, payload
           FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?`,
        )
        .all(cursor, BACKFILL_PAGE) as Array<{
          seq: number;
          day: string;
          ts: string;
          src: string;
          actor: string;
          task: string | null;
          type: string;
          payload: string;
        }>;
      if (rows.length === 0) break;
      for (const r of rows) {
        if (stream.aborted || stream.closed) return;
        let payload: unknown = r.payload;
        try {
          payload = JSON.parse(r.payload);
        } catch {
          // leave as string
        }
        await stream.writeSSE({
          id: String(r.seq),
          event: r.type,
          data: JSON.stringify({
            seq: r.seq,
            day: r.day,
            ts: r.ts,
            src: r.src,
            actor: r.actor,
            task: r.task,
            type: r.type,
            payload,
          }),
        });
        cursor = r.seq;
      }
      if (rows.length < BACKFILL_PAGE) break;
    }

    // --- 3. Subscribe to live events -----------------------------------------
    // Buffered subscription: only messages STRICTLY AFTER the backfill cursor go on the wire
    // (a race is possible where the tail commits a row between our SELECT and our subscribe;
    // suppressing seq <= cursor removes the duplicate).
    const unsubscribe = broadcaster.subscribe((msg) => {
      if (stream.aborted || stream.closed) return;
      if (msg.kind === "event" && typeof msg.id === "number" && msg.id <= cursor) return;
      push(msg);
    });

    // Wire an abort listener so the loop wakes up and exits promptly on disconnect.
    stream.onAbort(() => {
      unsubscribe();
      // Wake the wait so the loop condition re-checks stream.aborted.
      if (notify !== null) {
        const fn = notify;
        notify = null;
        fn();
      }
    });

    // --- 4. Live loop --------------------------------------------------------
    // Never resolve while the client is still connected (Hono #2050): loop until aborted.
    try {
      while (!stream.aborted && !stream.closed) {
        // Drain queued messages first.
        while (queue.length > 0) {
          if (stream.aborted || stream.closed) break;
          const msg = queue.shift()!;
          if (msg.kind === "event") {
            await stream.writeSSE({
              id: typeof msg.id === "number" ? String(msg.id) : undefined,
              event: msg.event,
              data: JSON.stringify(msg.data),
            });
            if (typeof msg.id === "number") cursor = msg.id;
          } else if (msg.kind === "rotate") {
            await stream.writeSSE({
              event: "rotate",
              data: JSON.stringify(msg.data),
            });
          }
        }
        if (stream.aborted || stream.closed) break;

        // Wait for either a new message or the heartbeat interval, whichever comes first.
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = (): void => {
            if (done) return;
            done = true;
            resolve();
          };
          notify = finish;
          setTimeout(finish, HEARTBEAT_MS);
        });

        // If nothing arrived, write a keepalive comment. SSE comments are lines beginning with
        // ':' — they arrive at the client without triggering a message event but reset the
        // proxy/browser idle timers.
        if (queue.length === 0 && !stream.aborted && !stream.closed) {
          await stream.write(`: keepalive ${new Date().toISOString()}\n\n`);
        }
      }
    } finally {
      unsubscribe();
    }
  });
});
