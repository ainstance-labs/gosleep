# GSL-385 — Harden touchid bypass guard: realpath normalization (fail-closed)

**Parent epic.** [GSL-387](https://ainstance-labs.atlassian.net/browse/GSL-387) — "[Core][Web][Tooling] Shift-79 verifier follow-up bundle".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/378 (parent epic #377).
**Branch.** `GSL-387-verifier-followups`.

## What changed

The `GOSLEEP_TOUCHID_BYPASS=1` refusal branch in `tools/skills/publish.sh` was a textual `case` glob against the raw env-var expansions of `GOSLEEP_SKILLS_PROD_DIR` and `GOSLEEP_SKILLS_BACKUPS_DIR`. The GSL-288 adversarial verifier (`docs/reports/verifications/GSL-288/runs/01/`) reproduced six end-to-end defeats against the pre-GSL-385 shape — each landed dev content in the real `~/.claude/skills` tree under `GOSLEEP_TOUCHID=1 GOSLEEP_TOUCHID_BYPASS=1`:

1. Symlink into real prod.
2. Uppercase path segments on case-insensitive HFS+/APFS-CI.
3. Relative-path symlink into real prod.
4. `HOME` rewrite (`HOME=/decoy GOSLEEP_SKILLS_PROD_DIR=$HOME/.claude/skills`).
5. `../` traversal (`$WORK/deep/nested/../../../../../.claude/skills`).
6. Backups symlink into real backups tree.

The block is latent under the current default-off shape (neither the launchd plist nor `apps/core/src/actions/publish.ts` sets `GOSLEEP_TOUCHID=1`), but flipping the flag on before this hardening lands would be an active foot-gun. Per the ticket description, this task **blocks** any future flag flip.

## Fix — publish.sh

Replaced the `case`-glob with a realpath-normalized comparison. New helpers (all prefixed `_touchid_`):

- `_touchid_realpath` — `realpath -q` with a manual walk-up fallback for paths that do not exist yet (mkdir hasn't run). Empty in → empty out.
- `_touchid_case_insensitive_fs` — treat Darwin as case-insensitive (conservative).
- `_touchid_inode_key` — `stat -f '%d:%i'` on macOS, `stat -c '%d:%i'` on Linux.
- `_touchid_same_or_under` — true if the override equals the anchor or is a descendant, checked (a) as lower-cased text on case-insensitive filesystems and (b) as `(device, inode)` identity walked up every ancestor of the override.
- `_touchid_real_home` — anchor `HOME` independently of the caller's `$HOME`. `dscl . -read /Users/$USER NFSHomeDirectory` on macOS, `getent passwd $USER` on Linux, `$HOME` as last-resort fallback. Test override: `GOSLEEP_TOUCHID_ANCHOR_HOME`.
- `_touchid_real_repo` — same for the repo anchor used to derive `REPO_ROOT/docs/skills/backups`. Test override: `GOSLEEP_TOUCHID_ANCHOR_REPO`.

The guard now:

1. Resolves `GOSLEEP_SKILLS_PROD_DIR` and `GOSLEEP_SKILLS_BACKUPS_DIR` to their physical paths.
2. Resolves both forbidden anchors (`$REAL_HOME/.claude/skills` and `$REAL_REPO/docs/skills/backups`) the same way — no more asymmetric compare.
3. Refuses (exit 3) if either override sits at, or under, either forbidden anchor. Both directions are checked (prod-under-backups and backups-under-prod), so the ticket's D6 cross-tree defeat also refuses.

The refusal message names the exact anchor and the resolved path so operators can see why.

## Fix — touchid-gate-smoke.sh

Rewritten from 11 invariants (E1 + C1-C4 + D1-D4 + 2 real-tree leak-checks) to **17 invariants**:

- E1 — default-off inert stub (unchanged).
- C1-C4 — opt-in gate exit-code steering (unchanged).
- D1 — bypass without hermetic overrides refuses (unchanged).
- D2 — bypass with hermetic overrides + decoy anchors succeeds.
- **D3-D8 — the six defeat classes, each MUST refuse.** Every attack is aimed at a decoy home fixture under `$WORK/decoy-home/.claude/skills` and a decoy repo under `$WORK/decoy-repo/docs/skills/backups`, populated with canary files. The guard is steered at those decoy trees via `GOSLEEP_TOUCHID_ANCHOR_HOME` and `GOSLEEP_TOUCHID_ANCHOR_REPO` (test-only overrides, documented in `publish.sh`).
- Decoy prod tree + canary unchanged.
- Decoy backups tree + canary unchanged.
- Real prod tree mtime unchanged (belt-and-braces).
- Real backups tree mtime unchanged (belt-and-braces).

D4 (uppercase-on-APFS-CI) reports PASS on non-Darwin without running the attack — the attack is not applicable on a case-sensitive filesystem.

**None of the defeat demonstrations touch the real `~/.claude` tree** — the decoy fixture is the entire attack surface. The real-tree mtime snapshots at the top and bottom of the run remain as defensive leak-checks; they are the ONLY reads of the real trees.

## Files touched

- `tools/skills/publish.sh` — realpath-normalization helpers + refactored `GOSLEEP_TOUCHID_BYPASS` guard.
- `tools/skills/tests/touchid-gate-smoke.sh` — rewritten with the six defeat classes against a decoy fixture.
- `docs/runbooks/gosleep-core.md` §10 — updated to describe the new guard shape, dropped the "latent-only" caveat, documented the two test-only anchor overrides.

## Verification

- `bash -n tools/skills/publish.sh` — clean.
- `bash -n tools/skills/tests/touchid-gate-smoke.sh` — clean.
- `bash tools/skills/tests/touchid-gate-smoke.sh` — **17 / 17 invariants green**. Each D3-D8 case logs `refusing bypass — <reason>` from the hardened guard; decoy prod + backups canaries unchanged; real prod + backups trees mtime unchanged.

## Notes / decisions

- Kept `GOSLEEP_TOUCHID_BYPASS` (the ticket's "optional simplification" would have dropped it). The bypass is a load-bearing surface for hermetic verification — the smoke's C1-C4 cases exercise it, and dropping it would push all mock-driven testing through the biometric subsystem. Instead, hardened the guard so the bypass is safe to leave in.
- The two anchor-override env vars (`GOSLEEP_TOUCHID_ANCHOR_HOME`, `GOSLEEP_TOUCHID_ANCHOR_REPO`) are grep-safe test-only surfaces — `git grep GOSLEEP_TOUCHID_ANCHOR` shows only the smoke and the guard's helper block. The launchd plist and the endpoint spawner don't reference them.
- Inode-identity + lowercase text is intentional belt-and-suspenders: `stat` requires the path to exist; the manual walk-up in `_touchid_realpath` handles the mkdir-hasn't-run case; lower-case is the fallback. Both signals must fail for the guard to pass.
