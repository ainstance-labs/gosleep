// @gosleep/core — Base64 token encoding tests (GSL-264, rev-3 addendum Delta 5).
//
// Covers the `b64v1:<...>` prefix encoding used to keep on-disk secrets ASCII-safe on Tahoe
// 26.x (avoids the `security -w` HEX regression). Every branch of decodeSecret() has a
// dedicated case here so a future refactor cannot loosen integrity in silence.

import { describe, expect, test } from "bun:test";
import { encodeSecret, decodeSecret, STORAGE_PREFIX } from "../src/security/tokenEncoding.ts";

describe("tokenEncoding — encode + decode round-trip", () => {
  test("round-trips a simple ASCII secret", () => {
    const s = "hunter2";
    const enc = encodeSecret(s);
    expect(enc.startsWith(STORAGE_PREFIX)).toBe(true);
    expect(decodeSecret(enc)).toBe(s);
  });

  test("round-trips a UTF-8 secret with multibyte characters", () => {
    // A real-world secret might legally contain non-ASCII; the Base64 shim MUST preserve it.
    const s = "секрет-🔑-abc";
    expect(decodeSecret(encodeSecret(s))).toBe(s);
  });

  test("round-trips a long random-looking secret", () => {
    const s = "SGVsbG8sIHdvcmxkIQ==-real-token-shape-1234567890abcdef";
    expect(decodeSecret(encodeSecret(s))).toBe(s);
  });

  test("refuses to encode an empty string", () => {
    expect(() => encodeSecret("")).toThrow();
  });
});

describe("tokenEncoding — decode strict integrity", () => {
  test("returns null on empty input", () => {
    expect(decodeSecret("")).toBeNull();
  });

  test("returns null on a b64v1: prefix with corrupted body (invalid characters)", () => {
    expect(decodeSecret("b64v1:not*valid*base64$$")).toBeNull();
  });

  test("returns null on a b64v1: prefix with non-multiple-of-4 body", () => {
    // 'abc' is a valid alphabet substring but not padded to length-mod-4.
    expect(decodeSecret("b64v1:abc")).toBeNull();
  });

  test("returns null on a b64v1: prefix with empty body", () => {
    expect(decodeSecret("b64v1:")).toBeNull();
  });

  test("returns raw string when there is NO b64v1: prefix (rescue-mode plain secret)", () => {
    // Operators may write a plain string during recovery; the reader must NOT reject it just
    // because it lacks the prefix. This is the documented rescue path.
    expect(decodeSecret("plain-secret")).toBe("plain-secret");
  });

  test("returns null when b64v1: body decodes to empty bytes", () => {
    // An all-padding body decodes to zero bytes. That is not a legal secret.
    // Manually build: encode "" would throw, so construct the pathological input directly.
    expect(decodeSecret("b64v1:====")).toBeNull();
  });

  test("returns null when a b64v1: body has slightly-wrong padding (round-trip mismatch)", () => {
    // Buffer.from is lenient — 'AAAA=' decodes to the same bytes as 'AAAA' but re-encodes as
    // 'AAAA'. We reject that via the round-trip check.
    expect(decodeSecret("b64v1:AAAA=")).toBeNull();
  });
});
