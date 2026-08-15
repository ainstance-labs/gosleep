# GSL-174 verifier run-02 follow-ups (M-1 + m-1 + m-2 fixed; m-3 adjudicated as accepted design deviation)

## Story

Merge candidate at 343f951 (branch head after two merges of `main` — GSL-330
run-09 findings, GSL-334 orphan-rescue) went to verifier as PR #307 CLEAN /
MERGEABLE. Verdict: **MERGE-READY = NO**, 0 CRITICAL / 1 MAJOR / 3 minor
(report `docs/reports/verifications/GSL-174-night/runs/02/index.html`).

The blocker was not a bug from the tonight-build; it was a **merge-time
count drift**. The branch was authored when only 7 dev-copy skills lived in
`skill/`. While the branch sat open, `main` landed GSL-334 Phase 0 — an
orphan-rescue that copied 5 skills from the global tree into the repo
(`agentic-report-creator`, `agentic-scenario-runner`, `efficient-agent-evals`,
`extra-usage`, `verifier-skeptic`) — so `skill/` had 12 entries but every
`KNOWN_SKILLS` set in the branch still enumerated 7. `GET /skills` returned
`count = 7`; the Skills-screen subtitle repeated "seven skills"; the
CHANGELOG JSONL schema's `enum` covered 7; `record-publish.ts`'s
fold-to-DB refused to accept rows for the 5 rescued names. Every surface
was locally coherent and every surface was wrong.

Four items came back from the verifier; three needed code, one was
adjudicated no-change:

- **M-1 (blocker) — KNOWN_SKILLS widened 7 → 12** across every source of
  truth in lockstep. Four `.ts` sets (`apps/core/src/skills/diff.ts`,
  `apps/core/src/actions/publish.ts`, `apps/core/scripts/record-publish.ts`,
  and read via `apps/core/src/routes/read.ts`) + the JSONL schema enum in
  `tools/skills/schema/changelog.schema.json` + amplifier sweep: the
  Skills-screen subtitle became dynamic (`\${q.data?.count ?? "…"} skills`)
  so the UI never re-hardcodes the number; three prose comments referencing
  "seven-skill" / "seven prefetches" / "seven trees" softened to "owned
  skills" / "burst of prefetches" / "every owned skill tree"; the
  `skill/README.md` "Owned skills" table gained 5 rows with GSL-334
  provenance + the ownership rule reminder (global authoritative, `skill/`
  = redundancy copy). No test hardcoded 7 (`grep` over `apps/core/test`
  and `apps/web/test` returned nothing), so no test needed weakening or
  deleting; the JSONL schema tests continue to be the invariant. Commit
  `bca47e3`.

- **m-1 — `publish.sh` `GOSLEEP_SKILLS_PROD_DIR` override + hermetic smoke.**
  A live-proof publish today can only rsync into the real
  `$HOME/.claude/skills` tree, which pollutes the owner's production
  skills. New env override: `PROD_ROOT = ${GOSLEEP_SKILLS_PROD_DIR:-$HOME/.claude/skills}`,
  `PROD_DIR = $PROD_ROOT/$SKILL`. Default unchanged. Every refusal path
  stays intact and unaware of `PROD_ROOT` — the owner gate (TTY /
  `GOSLEEP_WEB_TOKEN`), the belt-and-braces
  `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` refusal, `verify-local.sh`, and
  the GSL-254 DB preflight all run exactly as before. New hermetic smoke
  `tools/skills/tests/prod-dir-override-smoke.sh` pins all seven
  invariants (7/7 PASS): A1 override banner reflects the scratch root;
  A2 refused runs do not `mkdir` the override tree; B1 no TTY + no env
  nonce → rc = 3; B2 `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS` still refuses;
  B3 unmigrated DB still refuses with the GSL-254 fingerprint on stderr;
  B4 `--all` still rc = 2; real `$HOME/.claude/skills/handoff` mtime
  unchanged end-to-end. Also emitted the `publish:   prod = $PROD_DIR`
  banner earlier (right after `PROD_DIR` resolves, before every gate) so
  the destination is visible even when a later gate refuses — harmless
  duplicate of the existing later banner, but it makes the override
  provable from a refused run. Commit `5bc9565`.

- **m-2 — Skills notice-banner dark-theme fix (`--color-surface-sunken` →
  `--color-sunken`).** The TouchID-paused notice banner referenced a
  token name that does not exist in `apps/web/src/theme/globals.css` —
  the real sunken token is `--color-sunken`, used by the `.sunken`
  utility class and mirrored across the Card system. CSS resolves an
  unset `var()` to its (missing) fallback → transparent background. In a
  light body that reads white; in a dark body it reads translucent, so
  the banner looked stuck-light while the rest of the Skills screen
  flipped. Swapped to `--color-sunken` (defined in bare `:root` + the
  `prefers-color-scheme: dark` @media block + `html[data-theme="dark"]`
  override, so both the system default and the manual toggle work in
  both directions). Single-hit fix — no other `--color-surface-sunken`
  reference existed elsewhere. Left an inline comment naming the
  verifier finding so a future author does not reintroduce the wrong
  name. Commit `95afa27`.

- **m-3 (cards-vs-table) — adjudicated as an accepted design deviation.**
  Verifier flagged that the Skills screen renders a card grid with a
  details drawer rather than a table. Team-lead adjudication after
  cross-referencing the app aesthetic: **NO CHANGE**. The card grid is
  consistent with how other screens on this control plane surface
  per-entity data (`Overview` uses card tiles for KPIs, `Fleet` uses
  cards per session, `Timeline` uses cards per epoch); a table here
  would be the outlier, not the norm. The drawer is the shared modal
  primitive from `apps/web/src/components/ui/Dialog.tsx` — same
  affordance the `Questions` and `Tasks` screens use for detail panes.
  This entry exists so the deviation is recorded in the shift's dev
  history the verifier can see and future skeptics do not re-file the
  same observation from a fresh read.

## Known minor (verifier run 02b, do not fix in this PR)

The `Card` primitive used by the Skills grid renders on `--color-surface`
(via the `.surface` utility class in `apps/web/src/theme/globals.css`). In
current run-02b observation the surface reads light under dark theme while
the surrounding page background + sidebar + the (now-fixed) notice banner
flip correctly. Because `--color-surface` IS defined in both the bare
`:root` block AND the `prefers-color-scheme: dark` @media block AND the
`html[data-theme="dark"]` override with distinct values (`#ffffff` vs
`#141518`), a card that reads light in dark must be a specificity /
inheritance issue at the class layer rather than a missing token — a
different failure mode than the m-2 typo fix. Left as an info observation
by team-lead adjudication; the Card system is shared with every other
screen, so it is not a Skills-only regression and any fix belongs in a
scoped design-tokens task rather than this epic's merge.

## Reference

- Verifier report: `docs/reports/verifications/GSL-174-night/runs/02/index.html`.
- Merge-drift commit (found during the same pass, pre-verifier): `a441784` —
  `usePublishSkill` used `newIdempotencyKey()` (removed by GSL-314 stable-idem
  rename on main); replaced with `stableIdempotencyKey("publishSkill", input)`
  matching every other mutation on the SPA.
- Cross-source-of-truth widen (M-1): every `KNOWN_SKILLS` now lists **all 12**.
  When a new skill lands under `skill/<name>/` (or a rescue adds another), the
  four `.ts` sets + the JSONL schema enum + `skill/README.md` table + this
  `dev_history` note need to move together.
- Test-guard invariants after these three fixes: `bun test apps/core` 292,
  `bun test apps/web` 58, `bash tools/lab/tests/core-smoke.sh` 102,
  `bash tools/skills/tests/preflight-smoke.sh` OK,
  `bash tools/skills/tests/prod-dir-override-smoke.sh` OK.
