# GSL-227 — lab-emit `--rule` validation against the manifest + digest split

**Parent epic.** [GSL-243](https://ainstance-labs.atlassian.net/browse/GSL-243) — "[Docs][Process] Аудит системы 2026-07-24: публикация отчёта и закрытие хвостов".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/227.
**Branch.** `GSL-243-systems-audit-tail`.

## What changed

Orchestrator decisions must cite the manifest — audit finding 46 (MAJOR): three decisions in the log referenced `manifest §…` sections that do not exist. `lab-emit decision --rule` now validates the citation at write time.

Accepted shapes:
- `manifest §N.bullet` (or short form `§N.bullet`) — the bullet must actually appear in `docs/lab/decisions/manifest.md`.
- `delegation:<origin>` — an advisory rule that is not yet in the manifest. Kept separate on purpose: delegations are candidates for future promotion into the manifest.

Anything else — an unknown bullet, a bare comment, "TODO", the empty string — is refused with an actionable message (`rule '§9.does-not-exist' cites §9, which is not in the manifest`, or `rule 'just because' is neither a manifest citation nor a delegation`).

The decision record now carries `rule_kind ∈ {manifest, delegation, ""}` and a canonical rule string. Owner-authored decisions (`--by owner`) skip validation — the owner IS the source of authority.

Chronicler's morning-digest "Decided for you" section now splits into three subsections: **by manifest** (validated citations), **by delegation** (advisory rules, candidates for the manifest), and **unattributed** (legacy rows without `rule_kind` — audit these).

## Files touched

- `tools/lab/lab-emit.sh` — `classify_rule()`, `load_manifest_bullets()`; validation wired into `cmd_decision`; new env `GOSLEEP_MANIFEST_PATH` (defaults to the repo's manifest, not the LAB_DIR).
- `tools/lab/chronicler.py` — digest section 2 split.
- `tools/lab/tests/lab-emit-rule.sh` — new gate, 7/7 pass.

## Verification

- `bash tools/lab/tests/lab-emit-rule.sh` → 7 pass, 0 fail.
- `bash tools/lab/smoke.sh` → PASS=405 / FAIL=161 (unchanged baseline; every FAIL is a pre-existing Preact-SSG/UI test, none touches lab-emit or the manifest path).
- Spot-check on the real manifest: `lab-emit decision --re <q> --decision "yes" --rule "manifest §2.deadlines"` → succeeds with `rule_kind=manifest`.

## Notes / decisions

- The manifest lookup fails LOUDLY if the file is missing. A lab whose decisions cite a manifest that isn't there has no business auto-recording them.
- Env-override path (`GOSLEEP_MANIFEST_PATH`) is used only by fixtures/tests; production reads the checked-in `docs/lab/decisions/manifest.md`.
- The digest's `unattributed` bucket is retained rather than dropped: legacy records that carry a non-empty `rule` but no `rule_kind` deserve visibility, not silent grouping under one of the two validated buckets.
