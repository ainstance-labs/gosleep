// @gosleep/web — regression: stable Idempotency-Key (GSL-314 minor#1).
//
// QA run 04 minor#1: `newIdempotencyKey()` used to mint a fresh crypto.randomUUID() per
// invocation, so 5 rapid clicks on Allow generated 5 distinct server intents (1 ok + 4
// wasted 409s + ledger pollution). The replacement derives the key from
// (session, action, stable-serialized input, 2 s time bucket) so a burst collapses to one
// key and the server_intents replay cache returns the cached ok for clicks 2..5.

import { describe, expect, test } from "bun:test";

import { IDEMPOTENCY_BUCKET_MS, stableIdempotencyKey } from "../src/data/queries";

describe("stableIdempotencyKey (GSL-314)", () => {
  test("two same-argument calls in the same 2 s window collapse to one key", () => {
    const t = 1_700_000_000_000;
    const a = stableIdempotencyKey("decide", { qid: "p-1", decision: "allow" }, t);
    const b = stableIdempotencyKey("decide", { qid: "p-1", decision: "allow" }, t + 500);
    expect(a).toBe(b);
  });

  test("five rapid clicks inside the same bucket collapse to a single key", () => {
    const t = 1_700_000_000_000;
    const keys = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      keys.add(stableIdempotencyKey("decide", { qid: "p-burst", decision: "allow" }, t + i * 10));
    }
    expect(keys.size).toBe(1);
  });

  test("a deliberate re-click after the bucket rotates gets a fresh key", () => {
    const t = 1_700_000_000_000;
    const a = stableIdempotencyKey("decide", { qid: "p-2", decision: "allow" }, t);
    const b = stableIdempotencyKey(
      "decide",
      { qid: "p-2", decision: "allow" },
      t + IDEMPOTENCY_BUCKET_MS * 2,
    );
    expect(a).not.toBe(b);
  });

  test("different actions on the same target do not collide", () => {
    const t = 1_700_000_000_000;
    const decide = stableIdempotencyKey("decide", { qid: "p-3" }, t);
    const defer = stableIdempotencyKey("defer", { qid: "p-3" }, t);
    expect(decide).not.toBe(defer);
  });

  test("different targets under the same action do not collide", () => {
    const t = 1_700_000_000_000;
    const a = stableIdempotencyKey("decide", { qid: "p-a", decision: "allow" }, t);
    const b = stableIdempotencyKey("decide", { qid: "p-b", decision: "allow" }, t);
    expect(a).not.toBe(b);
  });

  test("input key order does not change the resulting key (stable serializer)", () => {
    const t = 1_700_000_000_000;
    const a = stableIdempotencyKey("answer", { qid: "q-1", answer: "yes", by: "owner" }, t);
    const b = stableIdempotencyKey("answer", { by: "owner", answer: "yes", qid: "q-1" }, t);
    expect(a).toBe(b);
  });

  test("key is ASCII printable and ≤ 128 chars (withTimeline contract)", () => {
    const t = 1_700_000_000_000;
    const k = stableIdempotencyKey(
      "applyManifest",
      { qid: "q-with-a-fairly-long-id", rule_id: "R-42", by: "owner-web" },
      t,
    );
    expect(k.length).toBeLessThanOrEqual(128);
    expect(k).toMatch(/^[\x21-\x7e]+$/);
  });

  test("undefined and empty-object inputs are distinguishable", () => {
    const t = 1_700_000_000_000;
    const a = stableIdempotencyKey("tick", undefined, t);
    const b = stableIdempotencyKey("tick", {}, t);
    expect(a).not.toBe(b);
  });
});
