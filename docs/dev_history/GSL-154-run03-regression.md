# GSL-154 — verification run 03, регрессионный лейн

Standalone-задача (не в эпике). Регрессионный лейн приёмочного эпика **GSL-138**, на `main` @ `d632e31`
(merge fix wave 2, PR #156). Jira: GSL-154. По брифу оркестратора.

## Что проверялось

Что ранее закрытые находки **остаются закрытыми** в закоммиченных артефактах после фикс-волны 2.
Это регрессия поверх пунктов прошлых ранов, не свежий аудит: новые проблемы не искал (параллельный
fresh-аудитор), продукт не трогал, ничего не чинил.

Скоуп — 29 инвариантов в трёх группах:

1. **Аудит смены 71** — GSL-113…GSL-132 (20 тикетов, все Done, label `verifier`).
2. **Фикс-волна 1 (GSL-141)** — финальные фиксы GSL-118/122/123/132 (перепроверены в группе 1) плюс
   docs-артефакты GSL-142 (конвенция per-task ассетов) и GSL-143 (стандарт verification runs).
3. **Фикс-волна 2 (GSL-153)** — GSL-146/147/148/149/150/151/152.

## Метод

Рабочее дерево грязное от параллельного chronicler-прогона, поэтому каждый built-инвариант проверялся
по **закоммиченному блобу** (`git show d632e31:<path>`), а не по изменённому файлу на диске. Блобы
`site/*.html`, `mobile/README.md`, `render_bundle.json`, `status.json` выгружены в scratchpad и
проверены грепом/`jq`/python. Исходники `tools/lab/ui/src/**` и `tools/lab/chronicler.py` чисты
(дерево == HEAD) — грепались напрямую.

Два визуальных инварианта измерены вживую в Chromium по тем же блобам, поданным с localhost, —
viewport-кадры, не fullPage:

- **GSL-114** — Timeline @ 390×844: `scrollWidth==clientWidth==390`, pageOverflow 0, широкая сводная
  таблица (888px) скроллится внутри `.wrap` (overflow-x:auto, 366px), не переполняя страницу.
- **GSL-146** — Fleet @ 1280×800: computed-стиль `.kpi span.unknown` = 28px, `rgb(142,77,157)`
  (магента `--unk`), inline; соседний label-span = 11px muted block. `.wk-f span.unknown` = 13px
  магента. Каскад `:not(.unknown)` не «съедает» значение-отсутствие.

## Итог

**29/29 инвариантов HOLDS. 0 REGRESSED. 0 NOT-VERIFIABLE.** Регрессий не найдено — новых
`[REGRESSION]`-тикетов не заведено.

Проверенные ключевые факты: dev_history count 111 == 111 реальных файлов (handoffs 47==47), инвариант
двух возрастов сошёлся точно (`max_event_age_s 29861 == generated_at − latest 29861`), rebuild-коммит
`6c0b08e` — второй родитель мержа и финальный коммит волны (0 коммитов после), severity-фильтр Timeline
worst-first (incident→warn→info), статусы Tasks получили тона ok/warn/info.

## Две тонкости (в отчёте — секция «на что обратить внимание»)

- **GSL-148 — намеренный `&amp;amp;`, не регрессия.** В `render_bundle.json` ровно одно литеральное
  `&amp;amp;` — внутри markdown-заголовка dev_history-файла про сам GSL-148, который буквально говорит
  о строке-сущности. `doc_title` декодирует сущности только для HTML (`<title>`/`<h1>`), не для
  markdown-заголовков (by design). Три реальных HTML-тайтла отчётов, где был баг двойного экранирования,
  теперь несут настоящий `&`. Положительный кейс декодирования подтверждён.
- **GSL-150 — `status.json delivery.branch = GSL-153-fix-wave-2`, и это по норме.** Бриф сформулировал
  инвариант как «branch=main», но сама норма GSL-150 (docs/lab/README.md, подсекция «Rebuild discipline»,
  строки 66–69) явно допускает: «after the merge, the derivatives still describe the branch tip … the
  Delivery card names the branch it ran on. That residue is healed by the next routine chronicler pass
  on main». Настоящий инвариант (rebuild — финальный коммит волны, без недосчёта) держится. Владельцу
  доступно решение: прогнать один рутинный chronicler-проход на `main`, если карта Delivery должна
  читать `main` прямо сейчас (опционально по норме).

## Выход

- `docs/reports/verifications/GSL-138/runs/03/regression/index.html` — самодостаточная страница
  (file://, светлая+тёмная тема через `prefers-color-scheme` + тумблер `data-theme`): таблица
  тикет | инвариант | вердикт | evidence по трём группам, секция «на что обратить внимание», русская
  сводка, лайтбокс на кадрах.
- `regression/assets/` — 4 кадра: `timeline-390-{light,dark}.png` (GSL-114),
  `fleet-1280-{light,dark}.png` (GSL-146).

## Гейты / дисциплина

Read-only по продукту (никаких правок `tools/lab/**`, `docs/lab/**`). Коммит — только
`runs/03/regression/**` + этот dev_history + строка индекса; никогда `add -A`; чужие грязные файлы
(site/mobile/bundle/status от chronicler) и untracked-скретч не коммичены. Значок параграфа в текстах
не использован (в evidence — «раздел N» словами; `§` из product-страницы cost.html не воспроизводился).
