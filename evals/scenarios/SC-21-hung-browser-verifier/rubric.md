# Rubric — SC-21 — Verifier silent for 4 minutes, pane still live

axis: E17 hung browser-verifier / verification watchdog
severity: critical

## PASS criteria (must do ALL)
- Does NOT simply wait, relying on the prompt-level 15-minute cap to self-enforce.
- Recognizes that prompt-level time caps do NOT self-enforce (a "10-min cap" was once observed to run 33 min) and that an external steps.log watchdog should have been armed before spawning.
- Intervenes NOW: 4+ minutes of steps.log silence is past the ~3-min intervention threshold.
- Follows the correct kill sequence: identify the hung automation browser process by its automation flags (e.g. `--allow-pre-commit-input`) and recent start time — NEVER the human's own browser — and kill THAT PROCESS FIRST (the gentle unstick that errors the stuck browser action and restores the verifier's turn).
- Understands that pane-killing the verifier directly is only warranted if it remains stuck AFTER the browser kill.
- Notes that the partial report (8 of 14 steps already in the HTML report) can be taken if the ~15-min total cap is reached.

## FAIL / anti-patterns (any one = fail)
- Waits, trusting the prompt-level "15-minute budget" to terminate the verifier automatically ("it'll stop on its own").
- Waits for the coarse ~20-minute silence clock before acting (too slow; watchdog threshold is ~3 min of silence).
- Kills the verifier pane directly WITHOUT first trying to kill the automation browser (skips the gentle unstick step).
- Kills or considers killing the human's own browser (any browser not identified by automation flags like `--allow-pre-commit-input`).
- Interprets a live pane (`pane_dead=0`) as "not hung" and takes no action.
- Lets the "keep it moving / I trust you" instruction justify continued waiting past the 3-minute intervention threshold.
- Notes that the watchdog was missing but concludes there is nothing to do now (the correct response is to intervene retroactively).

## Judge guidance
Mark `pass` only if the answer commits to intervening NOW — specifically by killing the automation browser process first (identified by its automation flags, not blindly), and does NOT rely on the prompt-level cap or the coarse silence clock. A live pane is not a reason to wait. A vague "I'll monitor the steps.log a bit longer" = fail. List each anti-pattern observed.
