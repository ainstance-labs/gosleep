# Handoff 54 — impl-178: epic GSL-178 executed in full, PR #255 open (2026-08-02)

## Part 1 — plain words

I built the watchdog's observe mode over the orchestrator and started it running. The watchdog now
judges the orchestrator's aliveness from the platform itself (`claude agents --json` — a standard
machine list of live sessions), not from tmux scraping; session identity travels in the pulse itself
(`session`/`session_id` written by the new writer `tools/lab/heartbeat.sh` straight from the roster
— a typo is impossible, and audit finding F2's "fleet double-vision" is structurally excluded).
By default the watchdog ONLY OBSERVES: the whole decision tree runs, but every action is only
recorded in the ledger as `would_*` — nothing is killed and nothing is spawned; arming is done
only by the explicit line `WD_MODE=armed` in the owner's config plus his launchctl. The
"alive but useless" failure mode (audit finding number one) is now caught at zero tokens: a
freeze detector on cycle+context_pct. State classes appeared (ZFC, bias "better skip than kill
someone alive"), a three-step intervention ladder (remind → revive the same session via
`claude --resume` → bring up a fresh one), thresholds from MEASURED cadence (900→3900s;
context ceiling off — on live data it would have "cured" a healthy system), a CLI version in every
pulse, a reality gate `armed-check` (green on the live machine, red on a foreign session name in
seconds; the web tile "armed" is built from its receipt), a minimal circuit breaker (a line in
STATE + a mechanical reader), and a stalled-verifier poller. The observe run is ALREADY RUNNING:
its carrier is the tick engine (each tick = one watchdog observe-tick), the first live ledger line
has been captured and archived. What's left for the owner: give the run three days, read the
ledger per runbook section 0 — and decide whether to arm.

## ORCHESTRATOR REPORT

- **Epic:** GSL-178 → In Review. **PR #255** (NOT merged — epic rule), branch
  `GSL-178-supervisor-observe`, 11 commits (10 tasks + bundle grade=fresh as the last), base 725fce7.
- **Jira:** all 10 tasks GSL-211…GSL-220 → Done; GH mirrors #211-#220 will close on merge
  (closes before every number in the PR body).
- **Gates:** watchdog smoke 75→168/0; lab smoke 545/0 (base preserved: 3 expectations evolved
  1:1 — 3→4 declared gates, armed_check=rc=N, +verifier.stalled in severity); hooks 19; tsc 0;
  chronicler fresh before every commit. Receipts in .artifacts/lab/gates/.
- **Questions:** q-2026-07-28-006/007/008 — defaults applied (run carrier = tick.sh; skill deltas
  only via errata; synthetic breaker.opened on a fixture per q-005's lesson).
- **NEEDS YOU (orchestrator):**
  1. Apply the errata: `docs/handoff/GSL-178-errata-orchestration-state.md` (cli= and
     breaker= lines in STATE; after that `tools/lab/breaker-check.sh` will turn green — right now
     it is honestly rc1) and `docs/handoff/GSL-178-errata-skill-heartbeat.md` (6 replacements in the
     GLOBAL skill; every old fragment verified with grep -cF=1).
  2. Switch to the pulse writer: `tools/lab/heartbeat.sh --cycle N --context-pct N
     --open-workers N [--status ...]` instead of hand-written JSON (will give session/session_id/cli
     in the pulse; until the switch the watchdog matches by cwd_single — works, but weaker).
  3. Merge PR #255 (regular merge), close mirrors, epic → Done.
- **FOR THE OWNER:** give the observe run three days (tick carrier; if you want — one-action
  launchd tick via preflight GSL-201), read the ledger per runbooks/watchdog.md section 0; arming
  = section 1 (WD_MODE=armed + plist + launchctl — only your hands).

## Formal part

- **Commits (per task):** 859d145 GSL-212 · a7885a9 GSL-213 · c54d8ff GSL-215 · ee58fe4 GSL-216 ·
  a3c011b GSL-217 · 8f468e4 GSL-219 · d36378b GSL-211 · 189159a GSL-214 · 347f3d4 GSL-218 ·
  97fec6d GSL-220 · 171f78d bundle fresh.
- **New tools:** tools/lab/heartbeat.sh, armed-check.sh, breaker-check.sh,
  verifier-watch.sh; watchdog.sh v0.5.1→v0.6.5 (observe/armed, platform aliveness source,
  session_mismatch/platform_unknown, freeze, classes, ladder with resume, mode-scoped memory,
  tick line with justification); tick.sh steps 4/4b; chronicler: EXPECTED_GATES+armed-check;
  lab-emit: +verifier.stalled; severity.ts: WARN.
- **Thresholds (222 pulse lines measured):** busy med=436/p90=620; idle med=1856/p90=5120; all
  breaks >3900s — owner-standby → stale=3900, slow=1950, grace 600; context ceiling 100=off until
  GSL-182 (ctx median 93 on live data, max 98).
- **dev_history:** 10 files GSL-2xx-audit5-*.md + index (epic GSL-178 section).
- **Deviations/findings:** transient smoke lab red during the full gate (race with the debounce
  hook; single run green — the rule "recheck with a single run before editing code" is written
  down in dev_history GSL-218); the supervision archive lags the live watchdog ledger by one
  chronicler pass (order of tick steps; the next tick catches up); the subscription pause
  07-28→08-02 landed mid-GSL-218 — work resumed with no losses, the first observe line was captured
  already at cycle=150.
- **Deliberately not done:** launchctl was not invoked; live panes/orchestrator were not touched;
  STATE and the global skill were not edited (errata); local skill/ was not touched (lags the
  global); no live breaker.opened (will appear on the first real OPEN).
