# GSL-270 — Deprecate Preact-SSG: chronicler stops invoking render.sh

**Epic:** GSL-250 (Interactive management web interface / control plane)
**Branch:** `GSL-250-control-plane`
**Cycle:** 210 (shift 75, night)
**Worker:** impl-web-13 (Opus 4.7)

## What was done

Turned off the Preact-SSG view layer by default. The `docs/lab/site/*.html` files remain
committed as a rollback surface for 1-2 months, but `tools/lab/chronicler.sh` no longer
invokes `tools/lab/ui/render.sh` on its normal cycle. The owner reads live data from the
web control plane at `http://127.0.0.1:7331` (gosleep-core) instead.

Concrete changes:

- **`tools/lab/chronicler.py`** — new env flag `GOSLEEP_KEEP_STATIC_SITE`, defaults to `"0"`.
  When unset or `"0"`, the chronicler skips both `render_site(bundle)` AND
  `apply_degrade_banner(...)` and records `status.json.ui.reason = "ssg-disabled"`. When
  set to `"1"` the pre-GSL-270 behaviour returns unchanged (render + degrade banner). The
  bundle, mobile README, digest, and status.json are still written in **both** modes — those
  are read by the web control plane and the phone surface and cannot depend on this flag.
- **`SITE_README` constant + `docs/lab/site/README.md`** — top-of-file deprecation notice
  pointing at the web control plane, the rollback env var, and the fact that
  `mobile/README.md` keeps updating regardless.
- **`tools/lab/smoke.sh`** —
  1. Set `export GOSLEEP_KEEP_STATIC_SITE=1` at the top of the existing chronicler smoke
     section (GSL-86) so the ~250 lines of rendered-HTML assertions further down keep
     exercising the renderer.
  2. New section `GSL-270: Preact-SSG deprecated — GOSLEEP_KEEP_STATIC_SITE gates render.sh`.
     Five probes: default → `ui.reason == "ssg-disabled"`; default still writes
     `render_bundle.json`; default does **not** create `site/index.html`; default keeps
     `mobile/README.md` updating; `=1` opt-in has `ui.reason != "ssg-disabled"` (proof
     `render.sh` was invoked).
  3. `unset GOSLEEP_KEEP_STATIC_SITE` at end of the block to restore production defaults for
     downstream sections that must not race the frozen `.html` files.

## Problems solved

- **How to add the flag without breaking the 250-line rendered-HTML smoke section.**
  Solved by opting-in the section (`export GOSLEEP_KEEP_STATIC_SITE=1`) — the flag is a
  process-level env var, so a single export at the top of the chronicler block covers every
  `bash "$CH"` invocation inside it. Downstream sections that don't need the renderer get
  the production default back via `unset`.
- **What to do about the "site is degraded, red banner stamped" path.** In SSG-disabled
  mode, `apply_degrade_banner(...)` MUST NOT run — the existing `.html` files are frozen
  on purpose (the rollback surface), and stamping "site not built" over deliberately-frozen
  files would be a lie. The gate keeps banner logic strictly inside the `keep_static_site`
  branch.

## Problems remaining

None specific to GSL-270. The Preact-SSG deprecation is complete for the daily-operator
path. If the owner ever needs the static site to keep updating (e.g., during a control
plane outage) they set `GOSLEEP_KEEP_STATIC_SITE=1` in the shell running the chronicler.

## Pitfalls & workarounds

- **The `.html` files stay in git and stay stale on purpose.** Anyone reading `git status`
  a week from now will see `docs/lab/site/*.html` looking like abandoned artifacts — they
  are exactly that, by design, as the rollback window. The GSL-270 marker in
  `docs/lab/site/README.md` and the top of the corresponding `SITE_README` constant say so
  in one paragraph.
- **The `--dry-run` path still calls `render_site` when opt-in.** GSL-270 does not change
  that — `--dry-run` was designed to exercise the renderer as a pure function (see the
  comment on the original branch). With the default (`ssg-disabled`), `--dry-run` also skips
  the render call. Anyone probing "does the renderer still build?" outside a real regen
  must set `=1` explicitly.
- **Env-var name.** `GOSLEEP_KEEP_STATIC_SITE=1` reads "keep the static site alive" — the
  reversed polarity from the Jira description's "default 1 until this step, 0 after" is
  intentional: the meaningful state is "keep or don't keep" from the operator's POV, not
  "on/off from the pre-migration state". Reader-facing.

## What didn't make it

- **Deleting `docs/lab/ui/` or `render.sh`.** Task said the `.html` files stay for 1-2
  months as a rollback surface — that means the RENDERER must stay too, otherwise
  `GOSLEEP_KEEP_STATIC_SITE=1` would break the day someone flipped it. Nothing under
  `tools/lab/ui/` was touched.
- **Wiring the flag into a launchd plist or the tick carrier.** The daily operator path
  is `tools/lab/chronicler.sh` invoked from `.claude/settings.json` PostToolUse hooks and
  from `gate.sh` — those inherit the shell env, and the shell default is "0" now, which
  is exactly the intent. No plist change needed.

## Technical

- **Commit:** (this task)
- **Files touched:**
  - `tools/lab/chronicler.py` (render gate + `SITE_README` deprecation notice)
  - `docs/lab/site/README.md` (deprecation banner at top)
  - `tools/lab/smoke.sh` (env opt-in in existing chronicler section + new GSL-270 section)
- **Gates:**
  - `bash tools/lab/gate.sh --offline` → all green (11/11 hooks-verify, tsc clean, chronicler
    green under `--no-poll`).
  - `bash tools/lab/smoke.sh` → **PASS=556 FAIL=0** (including the 5 new GSL-270 probes;
    the 3 pre-existing FAIL/flakes flagged in the shift 75 cycle-210 brief were not
    reproduced this run).
  - `bun x tsc -p apps/core --noEmit` → clean.
  - `bash tools/lab/tests/core-smoke.sh` → **pass=66 fail=0**.
- **Verification "by running":** GSL-270 smoke probes A + B directly exercise both flag
  values against a throwaway lab dir and assert the on-disk artifacts (bundle exists,
  site/index.html absent in default mode; ui.reason flips as expected).
- **Sources:**
  - Jira: `GSL-270` [Web] Deprecate Preact-SSG: chronicler stops invoking render.sh
  - Target architecture: `docs/reports/web-harness-research-2026-08-03/target-architecture.md`
    section 9, step 11.
