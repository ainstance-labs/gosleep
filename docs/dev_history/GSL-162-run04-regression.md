# GSL-162 — Verification run 04: regression lane

## Part 1 — the story

Четвёртый регрессионный лейн приёмочного эпика **GSL-138**, на `main` @ `1f1899f` (merge
фикс-волны 3, PR #165). Вопрос лейна один и тот же из рана в ран: **остаются ли уже закрытые
находки закрытыми** в закоммиченных артефактах после очередной фикс-волны. Это не свежие глаза
(их несёт параллельный аудитор) — новых проблем не искал, ничего не чинил, продукт read-only.

Скоуп — 34 инварианта, надстройка над 29 рана 03 за счёт волны 3:

- **Смена 71 (GSL-113…132)** — 20 находок.
- **Docs фикс-волны 1 (GSL-142/143)** — 2.
- **Фикс-волна 2 (GSL-146…152)** — 7.
- **Фикс-волна 3 (GSL-156…160)** — 5, новые этим раном.

**Итог: 34/34 HOLDS, REGRESSED 0, NOT-VERIFIABLE 0.** Регрессий нет, `[REGRESSION]`-тикетов не
заведено.

Что было важно не проспать:

- **Дереву не верить.** Рабочее дерево грязное от параллельного chronicler-прогона
  (`docs/lab/site/*.html`, `status.json`, `render_bundle.json`, `mobile/README.md` — все `M`).
  Поэтому built-инварианты проверялись строго по **закоммиченному блобу**: `git archive 1f1899f`
  в изолированный temp-каталог + `git show 1f1899f:<path>`. Исходники (`tools/lab/ui/src`,
  `chronicler.py`, `smoke.sh`) чисты (дерево == HEAD) — грепались напрямую. Номера строк
  переснимались на 1f1899f (сдвинулись под правки волны 3 и её rebuild).
- **Дубли считать раз, отмечать все ключи.** Стайлшит `theme.ts` инлайнится в каждую из 7
  страниц целиком, поэтому CSS-правила (`span.unknown`, `.runway-bind.ok`, `.scope-note`,
  `.tag.high-impact`) находятся `grep -l` на всех страницах — это ожидаемо, не находка.
- **Две ловушки «широкий греп поймал легитимную прозу».** (1) По Cost всплыли `no token
  ceiling`/`quota` — но дефект GSL-132 был в ДУБЛИРОВАННОМ echo (`«There is no token ceiling on
  disk.» + повтор строчными`), а одиночная подготовленная фраза — норма; счётчики на 1f1899f
  идентичны d632e31, где run 03 их принял; сами дубли (`no token ceiling exists on disk`, `not
  one quota event has EVER been logged`) → 0. (2) `slice(0,90)` по GSL-121 нашёлся 1 раз — но
  только в комментарии, `eventDetail` возвращает значение целиком.
- **Две латентности разобраны честно, а не проглочены.** GSL-159 (clear-бейдж `runway-bind.ok`)
  не рендерится при `bound=unknown` — проверил правило живым пробником (инжектировал
  `<span class="runway-bind ok">`, замерил тройку `--ok-soft`/`--ok`/`--ok-border` целиком).
  GSL-160 high-impact бейдж не рендерится (нет `high_impact:true` вопроса) — но CSS-правило
  `.tag.high-impact` и исходник на месте, а `.scope-note`-половина GSL-160 на Fleet/Cost видна
  вживую.
- **Живые кадры — по блобам, viewport, не fullPage.** Поднял localhost из корня блоба `docs/lab`,
  снял 7 кадров: index@1280 (GSL-156/157 — Freshness рендерится dead-красным, контейнер
  `.clock.unknown` держит прозу muted), fleet@1280 (GSL-146), timeline@390 (GSL-114), tasks@1280
  (GSL-158). Computed-замеры сверены с токенами обеих тем.

Норма rebuild (GSL-150) исполнена волной 3: `a629b6f` — 2-й родитель мержа (`1f1899f^2`), 0
коммитов после. `status.json` называет ветку `GSL-161-fix-wave-3` в Delivery — норм-разрешённый
пост-merge остаток (лечится рутинным проходом на main), решение доступно владельцу.

## Part 2 — technical reference

- **Коммит:** `GSL-162 [Docs][Evals] Verification run 04 regression lane` в `main` (один коммит,
  только `runs/04/regression/**` + этот dev_history + строка индекса; никогда `add -A`).
- **Артефакт:** `docs/reports/verifications/GSL-138/runs/04/regression/index.html` —
  самодостаточный (file://, обе темы, лайтбокс), таблица тикет|инвариант|вердикт|evidence в 4
  секциях (смена 71 / docs волны 1 / волна 2 / волна 3), секция «на что обратить внимание»,
  русская сводка внизу; 7 viewport-кадров в `regression/assets/`.
- **Метод проверки:** `git archive 1f1899f … | tar -x` → temp-дерево `.regr04-tmp/blob`;
  байт-греп по блобам; Chromium (chrome-devtools MCP) для GSL-114/146/156/157/158 — эмуляция
  вьюпорта `1280x800x1` и `390x844x2,mobile`, `colorScheme` обеих тем, `evaluate_script` для
  computed-замеров, `take_screenshot` (viewport, не fullPage).
- **Ключевые сверки:** freshness `card sh-m dead` (0 `sh-m unknown`), край `--dead`
  rgb(144,40,40)/rgb(240,127,119); `.clock.unknown` ось `--muted` rgb(151,152,155), только
  `.clock-val` `--unk`; tasks gh-глиф `--muted` rgb(104,105,107) (не `--dim` rgb(90,91,93));
  `.kpi span.unknown` 28px `--unk`; timeline 390 pageOverflow 0, таблица 888>366 в `.wrap`;
  render_bundle 247 тайтлов / 26 >110 / 0 троеточий; Library dev_history 118==118, handoffs
  47==47; two-ages `35295 == 79779−44484`.
- **Jira:** GSL-162, standalone Task, labels `verifier`,`regression`, assignee owner, In Progress
  → Done. Зеркало GitHub Issue с кросс-ссылкой.
