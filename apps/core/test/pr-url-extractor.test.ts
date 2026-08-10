// GSL-319 — unit tests for the PR-URL extractor + the tool-observed handler wiring.
//
// The extractor is the smallest piece the fix rests on: given any string field the panel
// might carry (a Bash command, a stdout preview, a shim intent line), pick out the
// canonical GitHub PR URL and normalise it. Run 06 finding #2 was that none of these
// fields were ever scanned; these tests pin the shape so a regex refactor cannot silently
// break the "here is what your agent shipped" surface.

import { describe, expect, it } from "bun:test";

import { extractPrUrl } from "../src/routes/internal.ts";

describe("extractPrUrl (GSL-319)", () => {
  it("extracts the canonical PR URL from a bare command string", () => {
    const cmd = 'gh pr view https://github.com/ainstance-labs/gosleep-e2e-todo/pull/3';
    expect(extractPrUrl(cmd)).toBe(
      "https://github.com/ainstance-labs/gosleep-e2e-todo/pull/3",
    );
  });

  it("extracts a PR URL embedded in stdout from `gh pr create`", () => {
    // Real gh pr create stdout — three lines including the URL. The extractor should find
    // it whether the URL is on its own line or embedded in prose.
    const stdout = `Creating pull request for GSL-315-todo-app into main in ainstance-labs/gosleep-e2e-todo

https://github.com/ainstance-labs/gosleep-e2e-todo/pull/3
`;
    expect(extractPrUrl(stdout)).toBe(
      "https://github.com/ainstance-labs/gosleep-e2e-todo/pull/3",
    );
  });

  it("strips query strings and fragments (returns the canonical URL)", () => {
    const s = "see https://github.com/ainstance-labs/gosleep/pull/307?w=1#issuecomment-42 for context";
    expect(extractPrUrl(s)).toBe("https://github.com/ainstance-labs/gosleep/pull/307");
  });

  it("returns null when the URL is not a GitHub PR", () => {
    expect(extractPrUrl("https://github.com/ainstance-labs/gosleep/issues/42")).toBeNull();
    expect(extractPrUrl("https://gitlab.com/foo/bar/pull/1")).toBeNull();
    expect(extractPrUrl("no url in this string at all")).toBeNull();
  });

  it("returns null on empty / undefined / whitespace-only inputs", () => {
    expect(extractPrUrl(null, undefined, "")).toBeNull();
    expect(extractPrUrl("   ")).toBeNull();
  });

  it("scans across multiple source strings and returns the first hit", () => {
    // The tool-observed handler calls extractPrUrl(commandPreview, responsePreview, intent).
    // If the command_preview has nothing, we still want to find the URL in response_preview.
    const cmd = "bun install";
    const resp = "Creating pull request... https://github.com/o/r/pull/1";
    const intent = "PermissionRequest pending owner decision";
    expect(extractPrUrl(cmd, resp, intent)).toBe("https://github.com/o/r/pull/1");
  });

  it("accepts owner/repo segments with dots, dashes, underscores", () => {
    // GitHub allows these; the extractor should follow suit.
    expect(extractPrUrl("https://github.com/some_org/repo.name-2/pull/99")).toBe(
      "https://github.com/some_org/repo.name-2/pull/99",
    );
  });
});
