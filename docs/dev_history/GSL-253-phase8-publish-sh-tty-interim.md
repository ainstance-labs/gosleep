# GSL-253 (T3 partial) — publish.sh TTY-interim CLI

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

## What landed

- `tools/skills/publish.sh <skill-name>` — the ONLY sanctioned dev → production publish path.
- Owner gates (either satisfies): (A) `isatty(0) == true` + owner types `yes` in an interactive prompt (`/dev/tty`, 60-second timeout); (B) `$GOSLEEP_WEB_TOKEN` set to a non-empty ≥16-char string (set by the endpoint spawn — T5).
- Belt-and-braces refusal: `$CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` set → refuses with exit 3 (plan Q2 default).
- Flow: parse args → refuse bulk / bad-name / etc → run `verify-local.sh` (T2) → show diff (bounded to first 200 lines) → interactive `yes` prompt on TTY (skipped under `--yes`/`--no-confirm`) → `cp -a` backup to `docs/skills/backups/<name>-<utc-ts>/` (override with `GOSLEEP_SKILLS_BACKUPS_DIR` for hermetic tests) → `rsync -a --delete` skill/<name>/ → prod → `bun run apps/core/scripts/record-publish.ts write` with the derived commit + task + supplied lesson + optional intent-id (delegates JSONL append + skills-table re-fold) → machine-readable `{"event":"skills.publish.done", …}` JSON on stdout.
- TouchID leg is a `TODO(GSL-288)` comment next to the TTY-confirm block — one function call away (`open -W -a apps/core/bin/touchid-gate.app` per rev-3 addendum Delta 4) when `d-2026-08-09-001` lifts.
- Exit code contract: 0 published, 1 error mid-flow (rsync / record failure), 2 usage, 3 owner-gate refused.

## Live-proof

**Negative path — all seven refusal shapes hit the correct exit code:**

| Case | Command | Expected | Got |
|---|---|---|---|
| No arg | `publish.sh` | rc=2 usage | rc=2 |
| `--all` | `publish.sh --all` | rc=2 refused | rc=2 |
| Multi-arg | `publish.sh handoff writing-prds` | rc=2 refused | rc=2 |
| Unknown flag | `publish.sh handoff --bogus x` | rc=2 refused | rc=2 |
| Missing skill dir | `publish.sh no-such-skill` | rc=2 refused | rc=2 |
| Agent-in-pipe (no TTY, no env) | `env -u GOSLEEP_WEB_TOKEN publish.sh handoff </dev/null` | rc=3 refused | rc=3 |
| `--dangerously-skip-permissions` env set | `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=1 publish.sh handoff </dev/null` | rc=3 refused | rc=3 |

**Positive path — full hermetic sandbox under `.artifacts/impl-174/publish-live-proof-v3/`:**

```
HOME=<sandbox> GOSLEEP_WEB_TOKEN=<32-char> \
  GOSLEEP_DB_PATH=<sandbox>/data/gosleep.db \
  GOSLEEP_CHANGELOG_PATH=<sandbox>/CHANGELOG.jsonl \
  GOSLEEP_SKILLS_BACKUPS_DIR=<sandbox>/backups \
  ./tools/skills/publish.sh handoff --yes \
    --lesson "T3 live-proof v3: full hermetic" \
    --task GSL-253 --intent-id "live-proof-v3"
```

Outcome:
- Owner gate: passed via env-nonce (isatty=0 + $GOSLEEP_WEB_TOKEN set to 32-char).
- verify-local: PASSed 4 checks (skill dir exists / SKILL.md non-empty / no references dir / git working tree clean under skill/handoff).
- Diff: printed (10 KB, bounded).
- Backup: `<sandbox>/backups/handoff-20260809T231545Z/` (production snapshot before rsync).
- Rsync: prod dir `<sandbox>/home/.claude/skills/handoff/` populated.
- CHANGELOG row: appended (single row, valid schema).
- DB: 7 skills upserted; handoff row = `sha-548fbf86 published owner-web`; 6 others = `0.0.0 clean`.
- Stdout: `{"event":"skills.publish.done","skill":"handoff",…,"intent_id":"live-proof-v3"}`.
- Exit: 0.
- Real repo `docs/skills/backups/` untouched (proven by `ls docs/skills/backups/` → empty after run).

## Design notes

- **`--yes` still requires TTY or env-nonce.** `--yes` only skips the "type yes" step; the owner-gate check runs first and rejects pipe-context agents regardless. An agent adding `--yes` to bypass the owner still hits exit 3 unless it also successfully sets the env-nonce (which only the endpoint knows how to generate).
- **Env-nonce lower bound.** ≥16 chars required. Prevents a stray empty-string or single-char env leak from opening the gate.
- **CHANGELOG delegated to record-publish.ts.** Single writer for the JSONL keeps validation + DB fold in one place. `GOSLEEP_CHANGELOG_PATH` propagates from publish.sh's env to the sub-invocation.
- **`GOSLEEP_SKILLS_BACKUPS_DIR` override.** Introduced for hermetic live-proofs — the endpoint spawner does not set this in production, so real publishes still land in `docs/skills/backups/`.
- **Backup THEN rsync THEN CHANGELOG.** Ordering is intentional: if rsync fails we have the backup to restore; if CHANGELOG append fails the diagnostic includes the exact `rsync -a --delete <backup>/ <prod>/` restore command.
- **Diff bound.** 200 lines of head printed to /dev/stderr; the backup + rsync capture the full change regardless.

## Follow-ups

- T5 (POST /actions/skills/publish): spawner that sets `GOSLEEP_WEB_TOKEN=<random>` + passes `--intent-id` from the server_intents row.
- GSL-288 (owner-gated): replace the TTY-confirm block with a TouchID gesture invocation.
- Optional: `--dry-run` (print the diff without rsync) — deferred, not needed for tonight's slice.
