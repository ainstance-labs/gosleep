# GSL-163 — Verification run 04: fresh-eyes аудит-дашборд

**Задача:** [GSL-163](https://ainstance-labs.atlassian.net/browse/GSL-163) · standalone (ран приёмки GSL-138)
**Артефакт:** `docs/reports/verifications/GSL-138/runs/04/` (index.html EN + ru/ + assets/ + design/ + payload.json)
**Объект аудита:** `main @ 1f1899f` (merge fix wave 3, PR #165) — 7 страниц `docs/lab/site/*.html`, мобильная проекция `docs/lab/mobile/README.md`, генератор `tools/lab/ui/`
**Аудитор:** verifier-04, скилл `verifier-skeptic` (fresh eyes: прошлые отчёты/находки/тикеты не читались; baseline `runs/03/design/pages/` — разрешённый эталон)

## Вердикт

**MINOR-POLISH, 92/100: 0 CRITICAL / 0 MAJOR / 5 MINOR.** Все находки — Jira Tasks под GSL-111
с label `verifier` + `run-04`:

1. GSL-164 — docs/lab/README.md разошёлся со слоем (фантомный `telemetry.jsonl`, «all 3 pages», 3 из 7 экранов) — architecture
2. GSL-165 — счётчик полки Library не воспроизводится из напечатанного глоба (Reports 5, глоб даёт 6; claim-once невидим читателю) — functionality
3. GSL-166 — колонка файла Library: шесть строк «index.html», slug вне поискового стога — functionality
4. GSL-167 — `.grid` две колонки ~190px на 391–416px против «одна колонка ≤416px» спеки 9.3 — design, SPEC-VIOLATION
5. GSL-168 — нет языка документа (WCAG 3.1.1) и `th scope` (WCAG 1.3.1) — design, INDUSTRY-STANDARD

## Методика и свидетельства

- Worktree на 1f1899f (грязное общее дерево не трогалось); гейты там же: **smoke PASS=404 FAIL=0**, `tsc --noEmit` 0.
- **Побайтовая воспроизводимость:** `render.sh < render_bundle.json` воспроизводит все 7 закоммиченных страниц точь-в-точь (единственный дифф — хвостовой `\n` от jq) — ручных правок в derived нет.
- **Правдивость данных** сверена с источниками до единицы: события 1345/12/93% против `events/*.jsonl`; staleness 35 295 c; очередь 39 записей → 19 вопросов, 0 open; cost 14 325 000 / 107 циклов из TELEMETRY; tasks 149 = 140+5+3+1; runway unknown 2/6. Один собственный «недосчёт» (28 vs 29 коммитов) опровергнут как таймзонный артефакт проверки.
- **Съёмка** через localhost (не file://), строго viewport 1280×800 и 390×844, обе темы в обе стороны переключения (computed-фон проверен перед затвором); 28 кадров галереи + 3 доказательных. Инвариант `scrollWidth == clientWidth == 390` держится на всех семи экранах.
- **Клиентский JS прогнан живьём:** re-grade баннера на открытии (10h 18m от билда 9h 48m), фильтр до 1 инцидента из 200, нулевое состояние с красной заливкой, reset, поиск library, тикающие возрасты с верной грамматикой суффикса.
- **Замеры вместо глаз:** по всем страницам нет computed-веса >500 и нет dashed/dotted-рамок (dotted — только text-decoration `span.unknown`); th 11px/uppercase/muted/0.66px, td 6×10, runway unk 2px #8e4d9d r8, tag 11px pill 1×6 — все числа спеки подтверждены.
- **Дельта от baseline runs/03** — ровно пять правил фикс-волны 3 (GSL-156…160), каждое проверено computed-стилем; остальные диффы — данные нового прохода chronicler (22:09 vs 20:39).
- **Перед филингом — опровержение:** документированные отходы не файлились (td break-word+34ch с измеренным обоснованием в theme.ts; residual-ветка Delivery по норме GSL-150; «Decided by you» по q-2026-07-20-013; sev=info нейтрален по оговорке 7.2) — все перечислены в секции «на что обратить внимание» отчёта.

## Оформление рана

По стандарту `docs/reports/verifications/README.md`: дашборд EN + `ru/` через скилл
`agentic-report-creator` (нумерованные пункты с Jira-чипами, лайтбокс, обе темы), `design/index.html`
(билингвальный обзор: свотчи обеих тем, шкалы, статусные роли, дельты от baseline) + `design/pages/`
(снапшот 7 страниц с блобов 1f1899f), секция-ссылка на `./regression/` (параллельный лейн GSL-162 —
им и закоммичен). Комментарий с полным списком находок добавлен в эпик GSL-111.
