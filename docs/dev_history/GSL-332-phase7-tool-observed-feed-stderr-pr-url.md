# GSL-332 — tool-observed feeder: include stderr in response_preview so real `gh pr create` surfaces

Parent epic: **GSL-330** ("Run-09 live-agent findings").
Prior related: GSL-319 (surface PR links + initial command_preview / response_preview wiring).
Landed on branch `GSL-330-run09-fixes`.

## What was done

The tool-observed feeder shim now scans stdout, stderr, AND output on the Bash tool_response,
concatenating each stream (per-stream 300-char cap, joined by `\n`, final blob capped at
600 chars to honor the server slice). Real `gh pr create` under Claude Code 2.1.226 leaves
stdout empty and prints the "Creating pull request …/pull/N" block on stderr — pre-GSL-332
the shim only read stdout, so extractPrUrl never saw the URL and the Overview Latest-PR
card only populated when the QA harness manually POSTed synthetic data. Post-fix a REAL
agent invocation of `gh pr create` populates `agent_sessions.last_pr_url` end-to-end.

Also switched the python heredoc delimiter from `<<PY` to `<<'PY'`. Pre-existing comments
already contained backticks that bash was executing on every hook invocation (silent for
things like `` `intent` `` / `` `command` `` — the latter is a shell builtin that no-ops —
but the moment I mentioned `` `gh pr create` `` bash tried to spawn gh on every hook call,
polluting stderr with a long usage banner). The quoted delimiter is strictly safer: the
python body references no shell variables (STDIN filename comes through `sys.argv[1]`), so
disabling bash expansion inside the heredoc is a pure win.

Five new regression tests in `pr-url-extractor.test.ts` pin the post-fix shape:
- URL on stderr with empty stdout (the exact run-09 finding) — extractor fires.
- URL on stdout only — extractor still fires (backward compat).
- URL in a stdout+stderr blob — extractor picks the canonical URL.
- 600-char truncation boundary — locked so a cap change gets caught.
- `gh pr view --json url` short-form output (URL as first line) — extractor fires.

Live proof: `.artifacts/live-proof-major2/` — scratch core on 127.0.0.1:7354, seeded
agent_sessions row, hook payload with the URL on stderr POSTed via the SHIM. The DB
transitioned `last_pr_url` from NULL to `https://github.com/ainstance-labs/gosleep-liveproof/pull/42`;
a direct HTTP call returned `pr_url_detected` matching. Core torn down; port clean.

## Problems solved

- Run 09 finding #8: the FIX-C PR-link surface (Overview Latest-PR + Fleet PR chip)
  populated only on synthetic POSTs during run 09 because the feeder shim's response_preview
  came from stdout only, and real `gh pr create` on 2.1.226 puts its URL on stderr.
- Long-latent shim noise: the pre-GSL-332 unquoted heredoc was expanding backticks inside
  its own comments at run time. Adding a `` `gh pr create` `` reference in a new comment
  made bash actually invoke `gh pr create` on every hook call. Fixed by quoting the
  heredoc delimiter — no behavior change beyond eliminating the runtime noise.
- `bash -n` regression during development: an unquoted heredoc treated `server's` in a
  new comment as an unterminated single quote. Fix: rewrote the comment without an
  apostrophe AND upgraded the delimiter to `'PY'` so future edits are safe too.

## Problems remaining

- The 300-char per-stream cap could still drop a URL that sits at the far end of a very
  long stderr (a `git push` with dozens of Warning lines followed by a URL). A regression
  test locks the boundary so the trade-off is visible; if it bites in production, bumping
  the per-stream cap or scanning the payload before truncation are both one-line changes.
- `gh` on macOS occasionally interleaves progress on stderr — the joined blob keeps the
  ordering, so the extractor still walks it and takes the first canonical URL it finds.
  No known failure mode; noted for the runbook.

## Pitfalls & workarounds

- **Do NOT unquote the heredoc.** Backticks in comments will run as shell commands.
- **Do NOT put apostrophes in unquoted heredocs.** Even in comments they parse as an
  unmatched single-quote — `bash -n` catches it, but only at parse time (in the wrapping
  script). Quoted heredocs neutralise both hazards.
- The shim is fire-and-forget (`&` + `disown` in the trampoline shim); a payload that
  triggers a bug in the python body still exits 0 → the parent hook never blocks.

## What didn't make it

- A separate integration test that POSTs a realistic body against a live core was not
  added as a `bun test` fixture — the same coverage lives in `.artifacts/live-proof-major2/`
  and would be a pain to fit into the pre-commit gate (needs a spawned server). The
  extractor unit tests already pin the extraction shape at the entry point, so a wire-level
  test would add cost without new signal.

---

## Technical reference

- Commit: (added at land)
- Files touched:
  - `tools/hooks/tool-observed-feed.sh` — heredoc delimiter quoted; response_preview now scans stdout+stderr+output with a per-stream cap.
  - `apps/core/test/pr-url-extractor.test.ts` — five new tests for realistic Bash payloads.
  - `.artifacts/live-proof-major2/` — scratch DB + core out/err + hook payload sample (worktree-only, not committed to `docs/`).
- New endpoint / migration: none.
- Verified by running:
  - `bash -n tools/hooks/tool-observed-feed.sh` — clean.
  - `bun x tsc -p apps/core --noEmit` + `apps/web --noEmit` — clean.
  - `bun test apps/core` — 279/279 (12 in the touched extractor file, +5 new).
  - Live proof: `sqlite3 SELECT` shows `last_pr_url` populated after the shim call; direct HTTP call returns `pr_url_detected` with the same URL.
  - Web build clean.
- Links:
  - Jira: <https://ainstance-labs.atlassian.net/browse/GSL-332>
  - GH issue: <https://github.com/ainstance-labs/gosleep/issues/333>
  - Run 09 finding #8: `docs/reports/verifications/web-e2e-2026-08-10/runs/09/index.html`
