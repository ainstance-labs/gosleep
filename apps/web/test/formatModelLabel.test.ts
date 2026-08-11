// @gosleep/web — GSL-327 friendly model label mapper.
//
// Live-fire E2E run 08 flagged raw model ids on Fleet (`claude-fable-5`,
// `claude-opus-4-8`, `claude-haiku-4-5-20251001`) as unreadable. This test
// pins the mapper contract: known family → marketing label; sentinels pass
// through verbatim; unknown ids fall back to a readable cleaned label; the
// UI never receives an empty string or a throw.

import { describe, expect, test } from "bun:test";

import { formatModelLabel } from "../src/lib/format";

describe("formatModelLabel (GSL-327)", () => {
  describe("known families → marketing label", () => {
    test.each([
      ["claude-opus-4-8", "Opus 4.8"],
      ["claude-opus-4-7", "Opus 4.7"],
      ["claude-opus-4-5", "Opus 4.5"],
      ["claude-opus-4-1", "Opus 4.1"],
      ["claude-opus-4", "Opus 4"],
      ["claude-sonnet-5", "Sonnet 5"],
      ["claude-sonnet-4-5", "Sonnet 4.5"],
      ["claude-sonnet-4", "Sonnet 4"],
      ["claude-sonnet-3-7", "Sonnet 3.7"],
      ["claude-fable-5", "Fable 5"],
      ["claude-haiku-4-5", "Haiku 4.5"],
      ["claude-haiku-4", "Haiku 4"],
      ["claude-haiku-3-5", "Haiku 3.5"],
    ])("%s → %s", (id, expected) => {
      expect(formatModelLabel(id)).toBe(expected);
    });
  });

  describe("dated snapshot suffixes still match their family", () => {
    test("claude-haiku-4-5-20251001 → Haiku 4.5 (the E2E-run08 case)", () => {
      expect(formatModelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    });
    test("claude-opus-4-7-20260101 → Opus 4.7", () => {
      expect(formatModelLabel("claude-opus-4-7-20260101")).toBe("Opus 4.7");
    });
    test("claude-sonnet-5-20260601 → Sonnet 5", () => {
      expect(formatModelLabel("claude-sonnet-5-20260601")).toBe("Sonnet 5");
    });
  });

  describe("boot-window sentinels pass through verbatim", () => {
    test("'unknown' stays 'unknown' (GSL-321 transcript-first sentinel)", () => {
      expect(formatModelLabel("unknown")).toBe("unknown");
    });
    test("'starting' stays 'starting' (GSL-325 boot-window sentinel)", () => {
      expect(formatModelLabel("starting")).toBe("starting");
    });
  });

  describe("unknown ids → graceful readable fallback", () => {
    test("unknown claude-* id is TitleCased with prefix stripped", () => {
      expect(formatModelLabel("claude-nova-9")).toBe("Nova 9");
    });
    test("unknown id with dated suffix strips the date", () => {
      expect(formatModelLabel("claude-nova-9-20301231")).toBe("Nova 9");
    });
    test("non-claude id is still TitleCased, never blank", () => {
      expect(formatModelLabel("gpt-5-turbo")).toBe("Gpt 5 Turbo");
    });
    test("fallback never returns an empty string for a non-empty id", () => {
      expect(formatModelLabel("x")).not.toBe("");
      expect(formatModelLabel("random-id").length).toBeGreaterThan(0);
    });
  });

  describe("null-ish / empty inputs", () => {
    test("null → 'unknown'", () => {
      expect(formatModelLabel(null)).toBe("unknown");
    });
    test("undefined → 'unknown'", () => {
      expect(formatModelLabel(undefined)).toBe("unknown");
    });
    test("empty string → 'unknown'", () => {
      expect(formatModelLabel("")).toBe("unknown");
    });
    test("whitespace only → 'unknown'", () => {
      expect(formatModelLabel("   ")).toBe("unknown");
    });
  });

  describe("prefix boundary safety", () => {
    test("'claude-fable-5-foo' still resolves as Fable 5 (dash-separated tail)", () => {
      expect(formatModelLabel("claude-fable-5-foo")).toBe("Fable 5");
    });
    test("'claude-fable-50' does NOT match Fable 5 (no boundary)", () => {
      // Falls back — never silently mis-labels a similar-sounding id.
      expect(formatModelLabel("claude-fable-50")).toBe("Fable 50");
    });
  });
});
