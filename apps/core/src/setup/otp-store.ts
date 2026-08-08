// @gosleep/core — one-shot OTP store for the /setup Bearer-discovery flow (GSL-291).
//
// Rationale: the /setup route needs to hand the owner's Bearer to the SPA WITHOUT putting
// it in a URL that would land in browser history. The pattern: an operator on the loopback
// (via `plist.sh setup-url`) requests an OTP; the OTP is one-shot, TTL 5 min, and lives in
// process memory only. The URL that gets pasted into a browser carries the OTP, not the
// Bearer. On visit, /setup exchanges the OTP for the Bearer and renders the SPA with the
// Bearer in a <meta> tag — the SPA reads it into sessionStorage and removes the tag.
//
// Why in-memory (no DB):
//   - The OTP is worth NOTHING after 5 min or after one use — no need to survive a restart.
//   - Adding a table for this would need a migration + a purge job, both unnecessary.
//   - The process is single-instance (target-arch §6.1).
//
// Storage shape: `Map<sha256-hex, {expires_at_ms, used}>`. We store the SHA-256 of the raw
// OTP so a memory dump does not leak plaintext tokens. Time-based comparison in `consume()`
// uses `timingSafeEqual` on the digest bytes.

import { createHash } from "node:crypto";

export interface OtpRecord {
  /** Epoch ms after which the OTP is considered expired regardless of use. */
  expires_at_ms: number;
  /** Flipped true on first consume; second attempt returns `used`. */
  used: boolean;
}

export type OtpConsumeReason = "ok" | "unknown" | "expired" | "used";

export interface OtpConsumeResult {
  ok: boolean;
  reason: OtpConsumeReason;
}

/** Default TTL for /setup OTPs (5 min). Explicitly named so callers see the number. */
export const DEFAULT_OTP_TTL_MS = 5 * 60 * 1000;

const digestHex = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

export class OtpStore {
  private map = new Map<string, OtpRecord>();

  constructor(private readonly nowMs: () => number = Date.now) {}

  /**
   * Store an OTP with a TTL. Returns the epoch ms at which the OTP expires so the caller
   * can echo it to the operator ("expires in 5 minutes, at HH:MM").
   */
  create(otp: string, ttlMs: number = DEFAULT_OTP_TTL_MS): number {
    this.gc();
    const now = this.nowMs();
    const expires_at_ms = now + ttlMs;
    this.map.set(digestHex(otp), { expires_at_ms, used: false });
    return expires_at_ms;
  }

  /**
   * Try to consume an OTP. Single-use — a second attempt with the same OTP returns
   * `{ok: false, reason: "used"}` even before the TTL fires. NOTE: consume() does NOT
   * gc(), because that would drop `used` records and a repeat attempt would degrade from
   * "used" to "unknown" — a meaningfully worse diagnostic for the operator. GC fires only
   * on `create()` mutators; the store stays small under normal traffic (few OTPs, minutes).
   */
  consume(otp: string): OtpConsumeResult {
    const hash = digestHex(otp);
    const rec = this.map.get(hash);
    if (rec === undefined) return { ok: false, reason: "unknown" };
    if (rec.used) return { ok: false, reason: "used" };
    if (rec.expires_at_ms < this.nowMs()) return { ok: false, reason: "expired" };
    rec.used = true;
    return { ok: true, reason: "ok" };
  }

  /** Drop expired + used records to keep the map small. Fires on every `create()`. */
  gc(): void {
    const now = this.nowMs();
    for (const [k, v] of this.map) {
      if (v.used || v.expires_at_ms < now) {
        this.map.delete(k);
      }
    }
  }

  /** Test-only: size of the map (for asserting GC behaviour). */
  size(): number {
    return this.map.size;
  }
}

/** Process-wide singleton — the setup route + the internal-secret create endpoint share it. */
export const otpStore = new OtpStore();
