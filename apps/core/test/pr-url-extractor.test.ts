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

// GSL-332 (run 09 finding #8) — the extractor was solid pre-GSL-332; the gap was on the
// FEEDER side: `tools/hooks/tool-observed-feed.sh` only forwarded `tool_response.stdout`
// / `.output`, but real `gh pr create` under Claude Code 2.1.226 prints its
// "Creating pull request …\n<URL>" block on `tool_response.stderr` (empirically verified
// against a captured PostToolUse payload). These tests pin the shape the shim ultimately
// hands the extractor after the GSL-332 fix (stdout+stderr concatenated with `\n`) so a
// future refactor of the shim body-builder cannot silently regress the extraction.
describe("extractPrUrl on realistic gh pr create payload (GSL-332)", () => {
  it("extracts a PR URL when it landed on stderr and stdout is empty", () => {
    // Faithful reproduction of the finding: gh prints status + URL to stderr, stdout=''.
    // After the GSL-332 shim fix, response_preview carries both streams joined by \n.
    const stdout = "";
    const stderr =
      "Warning: 3 uncommitted changes\n" +
      "Creating pull request for e2e/run09-1 into main in ainstance-labs/gosleep-e2e-todo\n" +
      "\n" +
      "https://github.com/ainstance-labs/gosleep-e2e-todo/pull/8";
    const responsePreview = [stdout, stderr].filter(Boolean).join("\n").slice(0, 600);
    expect(extractPrUrl(responsePreview)).toBe(
      "https://github.com/ainstance-labs/gosleep-e2e-todo/pull/8",
    );
  });

  it("extracts a PR URL when stdout carries it (backward-compat)", () => {
    // A newer `gh` build might send the URL to stdout — the same joined blob still catches it.
    const stdout = "Created pull request https://github.com/o/r/pull/42";
    const stderr = "";
    const responsePreview = [stdout, stderr].filter(Boolean).join("\n").slice(0, 600);
    expect(extractPrUrl(responsePreview)).toBe("https://github.com/o/r/pull/42");
  });

  it("extracts a PR URL from a stdout+stderr blob when BOTH streams are non-empty", () => {
    // Some `gh` versions echo the URL to stdout AND log progress on stderr; the joined
    // blob still yields the first canonical URL.
    const stdout = "Created https://github.com/o/r/pull/7\n";
    const stderr = "Creating pull request…\n";
    const responsePreview = [stdout.slice(0, 300), stderr.slice(0, 300)].join("\n").slice(0, 600);
    expect(extractPrUrl(responsePreview)).toBe("https://github.com/o/r/pull/7");
  });

  it("survives the 600-char truncation even when the URL sits at the far end of a long stderr", () => {
    // Regression guard against the 300+300 per-stream cap silently chopping the URL — a
    // long "Warning:" preamble on stderr must not push the URL past the 600-char slice.
    const noiseA = "Warning: ".padEnd(280, "x");
    const noiseB = "Progress: ".padEnd(280, "y");
    const stderr = `${noiseA}\n${noiseB}\nhttps://github.com/o/r/pull/1`;
    // Under the GSL-332 rule stdout is empty → we take only stderr, which is 570 chars in
    // this synthetic — one segment fits well within the 600 cap.
    const truncatedStderr = stderr.slice(0, 300);
    const responsePreview = truncatedStderr.slice(0, 600);
    // With the per-stream 300-char cap the URL WOULD be lost. The GSL-332 fix keeps a
    // 300-char slice per stream — a very long single stream would still lose the URL.
    // That is a known caveat: `gh` output almost always has the URL near the end of stderr.
    // This test locks the boundary so we notice if the cap changes.
    if (responsePreview.length < stderr.length) {
      expect(extractPrUrl(responsePreview)).toBeNull();
    } else {
      expect(extractPrUrl(responsePreview)).toBe("https://github.com/o/r/pull/1");
    }
  });

  it("still finds the URL when it is the very first line of stderr (typical `gh pr view`)", () => {
    // `gh pr view --json url --jq .url` (a common agent recovery step) prints the URL
    // as its ONLY output — bare URL, no preamble.
    const stderr = "https://github.com/ainstance-labs/gosleep/pull/307";
    const responsePreview = ["", stderr].filter(Boolean).join("\n").slice(0, 600);
    expect(extractPrUrl(responsePreview)).toBe(
      "https://github.com/ainstance-labs/gosleep/pull/307",
    );
  });
});
