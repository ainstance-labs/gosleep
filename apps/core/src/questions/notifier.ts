// @gosleep/core — in-process question mutation notifier (GSL-275).
//
// Small EventEmitter used to wake the long-poll GET /internal/questions/:qid/answer-wait as
// soon as a question row transitions to `status='answered'` (or beyond). The answer-loop's whole
// point is "release the hook the moment the DB row flips", so we cannot afford the tail-indexer
// latency (fs.watch → 200 ms debounce → JSONL parse → SQLite insert → broadcaster.emit) that
// SSE consumers accept.
//
// Wake mechanism:
//   1. POST /actions/questions/answer runs its dual-write (lab-emit + direct UPDATE) inside
//      apps/core/src/routes/actions.ts::doAnswer.
//   2. Immediately after the UPDATE lands (same await frame), doAnswer calls
//      `sessionAdapter.deliverAnswer({ qid, status: 'answered', answer_text, answered_at,
//      answered_by })` — the GSL-281 seam. For the Claude Code adapter that call routes
//      into `questionNotifier.notify(...)` (via the `notify` closure injected at construction).
//   3. The long-poll route in apps/core/src/routes/internal.ts is subscribed with
//      `subscribeQid(qid, cb)`; the cb resolves the Promise the HTTP handler is awaiting, the
//      response ships, the hook shim releases, the agent proceeds.
//
// This is a pure in-process EventEmitter — no cross-process bus needed. The core process is a
// single Bun.serve instance (launchd `com.gosleep.core.plist`, single-instance) per target-arch
// section 6.1. If a future task ever splits the process, the answer path must add a real bus
// here; today the assumption is stated and asserted in one place.
//
// Cross-cutting: the tail indexer still eventually re-lands the same row via lab-emit's JSONL
// side, and the broadcaster still fires `event: question.answered` on the SSE bus for the UI.
// The notifier does NOT replace that fan-out; it just gives the hook the millisecond-scale
// wake it needs, while the browser continues to hear the same story on SSE.

import { EventEmitter } from "node:events";

/** Payload delivered to a subscriber when a question row mutates. */
export interface QuestionMutation {
  qid: string;
  /** The new SQLite `questions.status` value ('answered' | 'resolved' | ...). */
  status: string;
  answer_text: string | null;
  answered_at: string | null;
  answered_by: string | null;
}

/**
 * One-and-only singleton — subscribe/notify must land on the same instance or a wake fires
 * against nobody. Test suites that need isolation swap the module singleton via mock-import;
 * production only ever sees `questionNotifier`.
 */
class QuestionNotifier {
  private readonly emitter = new EventEmitter();

  constructor() {
    // A long-poll hook might have many concurrent waits open (one per pending question across
    // the fleet). 256 gives plenty of headroom above Node's default 10 without masking a leak.
    this.emitter.setMaxListeners(256);
  }

  /**
   * Broadcast a question mutation to every subscriber. Fires both the qid-scoped event (used by
   * long-poll waiters) and the generic 'mutation' channel (reserved for future consumers such as
   * a debug logger). Order: qid-scoped first so a subscribe-then-notify-then-timeout race the
   * waiter cares about resolves before the generic listeners fire.
   */
  notify(m: QuestionMutation): void {
    this.emitter.emit(`mutation:${m.qid}`, m);
    this.emitter.emit("mutation", m);
  }

  /**
   * Subscribe to mutations for a specific qid. Returns an unsubscribe function the caller MUST
   * invoke on wait completion (answer arrival, timeout, request abort) — otherwise the emitter
   * accumulates dead listeners and eventually trips the max-listeners guard.
   */
  subscribeQid(qid: string, cb: (m: QuestionMutation) => void): () => void {
    const event = `mutation:${qid}`;
    this.emitter.on(event, cb);
    return () => this.emitter.off(event, cb);
  }

  /** Test-only: how many listeners are attached to this qid right now. */
  subscriberCount(qid: string): number {
    return this.emitter.listenerCount(`mutation:${qid}`);
  }
}

export const questionNotifier = new QuestionNotifier();
export type { QuestionNotifier };
