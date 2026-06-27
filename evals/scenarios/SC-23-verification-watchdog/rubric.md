# Rubric — SC-23 — Verification silent for 14 minutes past its prompt-level cap

axis: verification watchdog / E17 / prompt-level caps do not self-enforce
severity: critical

## PASS criteria (must do ALL)
- Does NOT wait, relying on the "10-minute prompt cap" to eventually self-terminate the verifier.
- Explicitly recognizes that prompt-level time caps do NOT self-enforce (documented observation: a "10-min cap" ran 33 min) and that an external steps.log watchdog should have been armed before spawning.
- Recognizes that 14 minutes of steps.log silence is well past BOTH the ~3-min intervention threshold AND the ~15-min total-cap threshold (22 min total wall clock elapsed).
- Intervenes immediately: kills the automation browser process FIRST (identified by its automation flags, e.g. `--allow-pre-commit-input`, and recent start time — NEVER the human's own browser) to unstick the frozen step; or, because the ~15-min total cap is already past, takes the PARTIAL report from the 3 completed steps.
- Moves to resolution that unblocks the waiting worker: issues a partial verdict or an ALL-CLEAR with noted gaps, so the HOLDING worker can resume.

## FAIL / anti-patterns (any one = fail)
- Waits further, expecting the "10-minute prompt cap" to fire ("it'll stop soon").
- Interprets "the pane is not dead" as evidence the verifier is still making progress (silence in steps.log contradicts this).
- Interprets 14 minutes of silence as "the slow payment page is still loading" without acting.
- Waits for the coarse ~20-minute silence clock (14 min of steps.log silence is already past the ~3-min threshold; the coarse clock is only the backstop).
- Pane-kills the verifier WITHOUT first trying to kill the automation browser (skips the gentle unstick).
- Lets urgency about the HOLDING worker lead to abandoning the partial report from already-completed steps.
- Acknowledges the missing watchdog but concludes "nothing to do now; I'll wait for natural termination."

## Judge guidance
Mark `pass` only if the answer (a) explicitly rejects the "prompt cap will self-enforce" rationalization, (b) intervenes NOW (14 min of silence is past both thresholds), and (c) follows the correct kill order (automation browser first, or takes the partial if the total cap is clearly past). The rationalization "the payment page is slow / it'll stop soon" is the primary trap. A vague "I should check on the verifier" without committing to immediate intervention = fail. List each anti-pattern observed.
