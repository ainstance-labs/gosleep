// @gosleep/web — GSL-329 friendly PR chip label parser.
//
// Live-fire E2E run 08 minor finding: the Latest-PR anchor + Fleet PR chip
// both used the FULL URL as their visible text — noisy on a small chip. The
// parser turns any `/pull/<digits>` URL into `#N`; anchors keep the full URL
// in `href` and `title`, so click behaviour + operator clipboard are
// unchanged. Unparseable → `"PR"`, NEVER the raw URL (defeats the whole
// point).

import { describe, expect, test } from "bun:test";

import { formatPrLabel } from "../src/lib/format";

describe("formatPrLabel (GSL-329)", () => {
  describe("canonical GitHub PR URLs", () => {
    test.each([
      ["https://github.com/ainstance-labs/gosleep/pull/9", "#9"],
      ["https://github.com/ainstance-labs/gosleep-e2e-todo/pull/9999", "#9999"],
      ["https://github.com/o/r/pull/1", "#1"],
      ["https://github.com/o/r/pull/123456", "#123456"],
    ])("%s → %s", (url, expected) => {
      expect(formatPrLabel(url)).toBe(expected);
    });
  });

  describe("URL variants still resolve", () => {
    test("trailing slash", () => {
      expect(formatPrLabel("https://github.com/o/r/pull/42/")).toBe("#42");
    });
    test("query string", () => {
      expect(formatPrLabel("https://github.com/o/r/pull/42?diff=split")).toBe("#42");
    });
    test("fragment", () => {
      expect(formatPrLabel("https://github.com/o/r/pull/42#issuecomment-1")).toBe("#42");
    });
    test("sub-path (files, commits)", () => {
      expect(formatPrLabel("https://github.com/o/r/pull/42/files")).toBe("#42");
    });
    test("http scheme still works", () => {
      expect(formatPrLabel("http://github.com/o/r/pull/7")).toBe("#7");
    });
    test("leading/trailing whitespace tolerated", () => {
      expect(formatPrLabel("  https://github.com/o/r/pull/7  ")).toBe("#7");
    });
  });

  describe("non-GitHub mirrors still resolve when the path shape matches", () => {
    // The parser cares about `/pull/N`, not the host — a private GHES / fork /
    // mirror still gets a compact chip.
    test("GitHub Enterprise-style host", () => {
      expect(formatPrLabel("https://ghe.example.com/team/repo/pull/13")).toBe("#13");
    });
    test("bare /pull/N path (no scheme, no host)", () => {
      expect(formatPrLabel("/o/r/pull/13")).toBe("#13");
    });
  });

  describe("unparseable → 'PR' fallback (never the raw URL)", () => {
    test("null → 'PR'", () => {
      expect(formatPrLabel(null)).toBe("PR");
    });
    test("undefined → 'PR'", () => {
      expect(formatPrLabel(undefined)).toBe("PR");
    });
    test("empty string → 'PR'", () => {
      expect(formatPrLabel("")).toBe("PR");
    });
    test("whitespace only → 'PR'", () => {
      expect(formatPrLabel("   ")).toBe("PR");
    });
    test("bare hostname → 'PR'", () => {
      expect(formatPrLabel("https://github.com/")).toBe("PR");
    });
    test("repo URL with no PR path → 'PR'", () => {
      expect(formatPrLabel("https://github.com/o/r")).toBe("PR");
    });
    test("issues URL is not a PR URL → 'PR'", () => {
      expect(formatPrLabel("https://github.com/o/r/issues/42")).toBe("PR");
    });
    test("pull path with non-numeric slug → 'PR'", () => {
      expect(formatPrLabel("https://github.com/o/r/pull/draft")).toBe("PR");
    });
    test("garbage string → 'PR'", () => {
      expect(formatPrLabel("not a url at all")).toBe("PR");
    });
  });

  describe("never returns the raw URL", () => {
    test("the fallback path yields exactly 'PR', not the input", () => {
      const noisy = "https://github.com/o/r";
      expect(formatPrLabel(noisy)).not.toBe(noisy);
      expect(formatPrLabel(noisy)).toBe("PR");
    });
  });
});
