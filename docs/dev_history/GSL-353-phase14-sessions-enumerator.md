# GSL-353 — Machine-wide Claude session enumerator + work-topic heuristic

**Epic:** GSL-350 · **Branch:** `GSL-350-observer-mode-phase-a` · **Base:** `origin/main` @ `cc09415`.

`apps/core/src/observed/sessions.ts` — polls `~/.claude/projects/*/*.jsonl` every 5 s
(R14.5). Every project on the host, not only gosleep. Reads each transcript's HEAD (first
line, for cwd) + TAIL (last ~64 KB, for liveness / last-message summary) — NEVER the body
between. Model picked from the first frame that names one. Idle if `now - transcript_mtime >
IDLE_THRESHOLD_MS` (60 s per R14.5 default).

Attribution: `observed_only=1` for any cwd NOT under `GOSLEEP_REPO_ROOT` (env-overridable so
hermetic tests can flip the boundary). Gosleep-native rows get their `project_slug` +
`cwd_project_root` backfilled but the enumerator never overwrites their status — that stays
owned by the fleet-poll worker.

**Work-topic heuristic** (owner decision 2026-08-16, depth = FACTS + WORK-TOPIC — reverses
PRD Q4's default):
- Scans the last ~256 KB of transcript backward for a
  `{"type":"last-prompt","lastPrompt":"…"}` frame OR a
  `{"type":"user","message":{"content":[{"type":"text","text":"…"}]}}` frame.
- Returns the first match, whitespace-collapsed, sliced to `WORK_TOPIC_MAX_LEN` (60 char)
  with a trailing ellipsis.
- Panel labels the line **"inferred"** — it is NOT ground truth.

Emits `observed_events` rows on `session_appeared` (first sighting), `session_idle` (active
→ idle transition), and `transcript_activity` (updated_at drift while status stays active).
All rows carry `source='transcript-mtime'` per R14.4 vocabulary.

## Tests

`apps/core/test/observed.sessions.test.ts` — fixture `~/.claude` with two project dirs
(native + observed-only), asserts correct `observed_only` flag, cwd/model read from the
transcript header, work-topic heuristic finds the last-prompt line, foldSessions writes the
observed-only row + a `session_appeared` event, and does NOT overwrite the gosleep-native
row's status.
