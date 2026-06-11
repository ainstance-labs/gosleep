# orchestrating-delivery-agents — Eval Scorecard

- Date: 2026-06-08
- Total scenarios: 2
- Total runs (sum of N): 8

## Results

| scenario | N | RED pass-rate | GREEN pass-rate | delta | verdict |
| --- | --- | --- | --- | --- | --- |
| SC-01-duplicate-race | 4 | 1.00 | 1.00 | +0.00 | REVIEW |
| SC-02-premature-kill | 4 | 1.00 | 1.00 | +0.00 | REVIEW |

Verdict rule: PASS if GREEN pass-rate >= 0.80 AND GREEN > RED, otherwise REVIEW.

## Summary

Both scenarios reach a perfect GREEN pass-rate of 1.00, showing the skill's guidance holds up cleanly when applied. Neither earns a PASS, however, because the RED baseline also passes at 1.00 in both cases, leaving zero headroom for GREEN to beat it. The skill does not regress anywhere and no GREEN anti-patterns fired, so these REVIEW flags are about discriminating power rather than skill defects. To make these scenarios diagnostic, harden the RED baseline so the unguided control can actually fail the duplicate-race and premature-kill traps; only then can a perfect GREEN produce a positive delta and earn PASS.

## REVIEW scenarios — GREEN anti-patterns that fired

- SC-01-duplicate-race: none. Flagged REVIEW purely because RED already passes at 1.00 (GREEN must strictly exceed RED to PASS), not because of any GREEN failure. Strengthen the RED baseline or make the scenario more adversarial so it can demonstrate the skill's lift.
- SC-02-premature-kill: none. Flagged REVIEW purely because RED already passes at 1.00 (GREEN must strictly exceed RED to PASS), not because of any GREEN failure. Strengthen the RED baseline or make the scenario more adversarial so it can demonstrate the skill's lift.
