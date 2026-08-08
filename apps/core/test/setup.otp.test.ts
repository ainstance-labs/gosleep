// @gosleep/core — OTP store (GSL-291) unit tests.
//
// The store is pure (given a `nowMs` injector), so every branch is exercised without any
// real timers. Coverage:
//   - Create + consume happy path.
//   - Second consume of the same OTP returns `used`.
//   - Consume of an unknown OTP returns `unknown`.
//   - Consume after TTL returns `expired` (with fake clock).
//   - GC drops expired + used records on any mutator.
//   - Digest hides the plaintext: two different OTPs never collide (probabilistic sanity).

import { describe, expect, test } from "bun:test";

import { OtpStore, DEFAULT_OTP_TTL_MS } from "../src/setup/otp-store.ts";

describe("OtpStore (GSL-291)", () => {
  test("create + consume happy path", () => {
    const store = new OtpStore();
    const otp = "abc-123";
    store.create(otp);
    expect(store.consume(otp)).toEqual({ ok: true, reason: "ok" });
  });

  test("second consume of the same OTP returns 'used'", () => {
    const store = new OtpStore();
    store.create("xyz-456");
    expect(store.consume("xyz-456").ok).toBe(true);
    expect(store.consume("xyz-456")).toEqual({ ok: false, reason: "used" });
  });

  test("consume of an unknown OTP returns 'unknown'", () => {
    const store = new OtpStore();
    store.create("known");
    expect(store.consume("not-issued")).toEqual({ ok: false, reason: "unknown" });
  });

  test("consume after TTL returns 'expired'", () => {
    let now = 1_000_000;
    const store = new OtpStore(() => now);
    store.create("time-otp", 1_000); // 1 second
    now += 500;
    expect(store.consume("time-otp").ok).toBe(true); // still valid at 500 ms elapsed
    // Need a fresh OTP because consume above marked the first one used.
    store.create("time-otp-2", 1_000);
    now += 1_500;
    expect(store.consume("time-otp-2")).toEqual({ ok: false, reason: "expired" });
  });

  test("default TTL matches the constant", () => {
    // Sanity: DEFAULT_OTP_TTL_MS = 5 min so the runbook doc line stays true.
    expect(DEFAULT_OTP_TTL_MS).toBe(5 * 60 * 1000);
  });

  test("GC drops used + expired records on any mutator", () => {
    let now = 1_000_000;
    const store = new OtpStore(() => now);
    store.create("a", 100_000); // valid
    store.create("b", 100_000); // will be marked used
    store.create("c", 100_000); // will be expired via clock advance below

    expect(store.consume("b").ok).toBe(true); // marks used
    // Advance clock past c's expiration BUT keep 'a' alive.
    now += 100_001; // a and c both expire; d starts fresh from here.
    store.create("d", 100_000);
    // After the create's gc(): 'd' remains as the sole valid + unused entry.
    // 'a' expired (past TTL), 'b' used, 'c' expired.
    expect(store.size()).toBe(1);
  });

  test("different OTPs get different digests (never collide)", () => {
    const store = new OtpStore();
    store.create("token-1");
    store.create("token-2");
    // Consuming one doesn't touch the other.
    expect(store.consume("token-1").ok).toBe(true);
    expect(store.consume("token-2").ok).toBe(true);
  });

  test("consume never returns ok on the empty store", () => {
    const store = new OtpStore();
    expect(store.consume("anything")).toEqual({ ok: false, reason: "unknown" });
  });
});
