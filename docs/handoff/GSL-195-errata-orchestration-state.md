# GSL-195 — Errata for ORCHESTRATION-STATE.md (red team corrections)

**Status: PREPARED, NOT APPLIED.** `docs/handoff/ORCHESTRATION-STATE.md` is a sovereign file:
only the owner or the shift orchestrator edits it. This document is the exact, mechanically
applicable correction text (old line → new line), prepared by the epic GSL-175 executor for task
GSL-195. The applier performs the pinpoint replacements below and nothing more.

Source of the corrections: calibration by the first red team — `redteam-verdicts.md`
(committed copy: `docs/reports/system-audit-2026-07-24/evidence/redteam-verdicts.md`),
its summary lies in STATE itself as the telemetry line `cycle=109 worker=audit-redteam`
("REFUTED NUMBERS"). The precedence rule — from the evidence base README: where a red team
verdict differs from an original finding, the verdict is right.

## What and why we're correcting

In the telemetry line `cycle=105 worker=audit-autonomy` (section TELEMETRY) three statements
were written that calibration removed AFTER the record:

1. "13 of 19 defaults applied BEFORE the deadline" — actually **10 of 20**.
2. "q-2026-07-23-001 at the same second" — refuted: the auditor compared with the time of
   FILING the question, not the deadline; actually the application was **2 hours before**
   the deadline.
3. "0 of 21 decisions cite a REALLY EXISTING clause" — actually **3 cite an invented clause,
   ~8 cite a real section in a non-canonical format**.

The correction style — like the project's C8 discipline: a fix does not erase history. A refuted
number remains visible inside a "[CORRECTION …: was …]" marker, but the line no longer ASSERTS
it, and a reference to the source stands next to it. The `cycle=109` line (the red team
summary itself) is not touched — it is the source.

## Replacement 1 (line `cycle=105`, fragment about defaults before the deadline)

**Old fragment (verbatim):**

```
и наоборот 13 из 19 дефолтов применены РАНЬШЕ дедлайна (до 11.9ч; q-2026-07-23-001 в ту же секунду) — подушка на вето владельца не работала ни разу.
```

**New fragment:**

```
и наоборот 10 из 20 дефолтов применены РАНЬШЕ дедлайна [ПОПРАВКА красной команды (cycle=109; redteam-verdicts.md): было «13 из 19»; «q-2026-07-23-001 в ту же секунду» опровергнуто — сравнение шло со временем постановки, а не с дедлайном; фактически −2ч до дедлайна] — подушка на вето владельца не работала ни разу.
```

## Replacement 2 (the same line `cycle=105`, fragment about manifest citation)

**Old fragment (verbatim):**

```
Манифест не работает как источник решений: 0 из 21 решения цитируют РЕАЛЬНО существующий пункт, три ссылаются на выдуманный manifest §2.default-hit-at-deadline (grep → NOT FOUND);
```

**New fragment:**

```
Манифест не работает как источник решений: цитирование расшатано — три решения ссылаются на выдуманный manifest §2.default-hit-at-deadline (grep → NOT FOUND), ~8 цитируют реальный раздел в неканоническом формате [ПОПРАВКА красной команды (cycle=109; redteam-verdicts.md): было «0 из 21 цитируют реально существующий пункт»];
```

Note: the two replacement fragments above are kept in the original Russian because they are the
LITERAL text of the STATE line to be inserted verbatim; changing that text would defeat the
mechanical `grep`-based application procedure.

## What was NOT found in the file (verified by grep, no edit needed)

- "the restart budget will burn in three ticks" — occurs only inside the `cycle=109` line as a
  refutation quote; the original claim is not in the file.
- "ctx=98 in 178 lines" — not in the file; the `cycle=104` line says "178/200 lines above
  WD_CONTEXT_CEILING_PCT=80", which the red team confirmed as a correct wording
  (178 is lines with a value at or above 80).
- "14 intervals" — not in the file (only corrected "15" inside `cycle=109`).

## How to verify after application

```
grep -c "13 из 19" docs/handoff/ORCHESTRATION-STATE.md   # 0 outside "было …" markers
grep -c "0 из 21"  docs/handoff/ORCHESTRATION-STATE.md   # 0 outside "было …" markers
grep -c "в ту же секунду" docs/handoff/ORCHESTRATION-STATE.md   # 0 outside "было …" markers
```

More precisely: each of the three phrases must occur only inside "[ПОПРАВКА …: было …]" and
inside the `cycle=109` line (refutation quotes). Next to each corrected number — a reference to
the source (cycle=109; redteam-verdicts.md). This is exactly the GSL-195 acceptance criterion.

---

## Addition from GSL-194 — the "do not silently commit a bundle with grade != fresh" rule

**Status: PREPARED, NOT APPLIED** (the same sovereignty as above). Task GSL-194 requires
recording the rule in the shift-close checklist; the shift-close ritual lives in the sovereign
ORCHESTRATION-STATE.md, so the text is prepared here in the same order. Proposed line for the
"Standing rules / decisions" section:

```
- **2026-07-28 (audit, finding 23; GSL-194, IN FORCE): DO NOT SILENTLY COMMIT A BUNDLE WITH grade != fresh.**
  Lab rebuild — the LAST step of the shift/epic close (norm GSL-150): first all sources
  (dev_history, indexes, reports), then chronicler.sh, then ONE commit of derivatives,
  and between the build and the commit — no other commits. Before the commit, read grade:
  `jq -r .staleness.grade docs/lab/render_bundle.json`. grade != fresh is a close blocker,
  not a note: either rebuild or name the reason in the commit message and in the handoff.
  The operational copy of the rule — docs/lab/README.md, section "Rebuild discipline"
  (GSL-150/GSL-194).
```

Justification: finding 23 (MAJOR) caught in `main` a bundle declaring itself DEAD at the moment
of its own commit, with a fresher build in the working tree; norm GSL-150 by that time was
broken twice (after the build six commits landed, while the requirement is "none" — reinforced
by the red team). The rule adds an explicit GATE on grade to the "rebuild as the last commit"
discipline.
