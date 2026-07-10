# GSL-61 — Go TUI internals autosk — gocui/lazygit стек, 11 паттернов

**Epic:** GSL-58 — AutoSK Anatomy v2 — помодульный код-анализ (CODE-ONLY)
**Branch:** GSL-58-autosk-anatomy
**Phase:** GSL-58 — content research, task 2 of 5

---

## Part 1 — Story

### What was done
Mapped the internals of `autosk lazy`, the Go CLI/TUI — Go side only (`cmd/` + `internal/`, 119
`.go` files, ~15.7k non-test LOC). Headline verdict: it's built on **gocui + lazycore (lazygit's
own stack), NOT bubbletea** — the package doc admits it "mirrors the lazygit shape … in fewer
files." The write-up walks the layers a request passes through: the flat Cobra CLI, the
fresh-dial-per-call UDS RPC client, the two persistent streaming connections, and the single
mutex-guarded state struct with 4 panels. The reusable patterns (TUI-owned reconnect with capped
backoff, stateless per-call transport, auto-spawn of the daemon, three-way auto-init gate, etc.)
are pulled out for gosleep to borrow. Lands as `03-tui.md` (74 lines).

### Problems solved
15.7k LOC is too much to read line-by-line in one context, so the deep-read pass was delegated to
an Explore subagent (sonnet) and the key files (`gui.go`, `client.go`, `connector.go`) were
spot-verified by hand afterward — the standard cheap-read-then-verify split.

### Problems remaining
None for this task — research artifact only.

### Pitfalls & workarounds
- Same gitignored-clone rule as GSL-60: `.research-cache/autosk` @ `fd4c22e` is not committed; the
  markdown carries the file:line anchors so claims survive without the clone.
- Line-count note: the header claims "11 patterns" as the framing; the file itself is the source of
  truth for the exact enumerated list.

### What didn't make it
Nothing dropped. The Bun/TS daemon side is out of scope here (covered by the pi-agent + baseline
docs); this task is deliberately Go-side-only.

---

## Part 2 — Technical reference

**File committed:**
- `docs/research/2026-07-10-autosk-anatomy/03-tui.md` (74 lines, ~15 KB) — Go CLI/TUI internals
- `docs/dev_history/GSL-61-phase-gsl58-tui.md` — this file
- `docs/dev_history/README.md` — index updated

**Deliberately NOT committed:** `.research-cache/` clones (gitignored, re-clone at `fd4c22e`).

**Verified by running:** structural validation against the researcher's report — `wc -l` (74
lines); framework verdict (gocui/lazycore, zero bubbletea imports) and the layer walk
(CLI → RPC client → streaming → state/panels) present with `internal/…:NNN` citations.

**Links:** Jira [GSL-61](https://ainstance-labs.atlassian.net/browse/GSL-61) ·
GitHub [#70](https://github.com/ainstance-labs/gosleep/issues/70) · Epic
[GSL-58](https://ainstance-labs.atlassian.net/browse/GSL-58) / [#67](https://github.com/ainstance-labs/gosleep/issues/67)
