# GSL-151 — Ячейка «missing from these sums» на Cost носит собственный класс .partial-note, а не заимствованный .wk-models

Задача эпика GSL-153 «Fix wave 2: verification run 02 findings» (GH #148).
Jira: GSL-151 · GH: #154 · находка 6 (MINOR) аудита verifier-skeptic, run 02:
«Cost per-model table borrows .wk-models (a Fleet worker-card class) as a generic amber —
class name no longer means what it says».

---

## Часть 1 — человеческим языком

### Что сделано

Ячейка «missing from these sums» per-model таблицы Cost красилась в amber классом
`.wk-models` — классом, определённым для (и названным в честь) строки-предупреждения
воркер-карточки Fleet «в транскрипте больше одной модели». Цвет был правильный, словарь —
нет: следующий редактор `.wk-models` не мог знать, что от класса зависит второй экран, и
принцип «одна роль = одно имя» (спека, раздел 4 строит палитру на именованных ролях) был
нарушен.

Фикс: собственный класс роли `.partial-note{color:var(--warn)}` в theme.ts (с несущим
комментарием — почему своё имя и почему не .wk-models) и замена в cost.tsx:
`class={m.partial > 0 ? "partial-note" : "dim"}`. `.wk-models` остался ровно там, куда
указывает его имя, — на воркер-карточке Fleet.

### Решённые проблемы

- Ноль визуальных изменений — тот же `var(--warn)` в обеих темах; фикс чисто словарный,
  что подтверждено computed-пробами.

### Оставшиеся проблемы

- Нет.

### Подводные камни

- Стайлшит инлайнится в КАЖДУЮ страницу, поэтому греп «wk-models отсутствует на cost.html»
  ложно краснел бы вечно — правило `.wk-models{}` есть в общем CSS любой страницы. Ассерт
  сужен до разметки: `class="wk-models"`.
- Парсер TELEMETRY (`chronicler.py`) требует СЛЕДУЮЩЕГО `## `-заголовка после секции
  (lookahead в регексе): фикстурный ORCHESTRATION-STATE.md без завершающей секции молча
  даёт пустой леджер. Фикстура закрыта секцией `## NOTES`.

### Что не вошло

- Пересборка закоммиченных страниц — последним коммитом волны (GSL-150).

## Часть 2 — техническая справка

### Файлы

- `tools/lab/ui/src/theme.ts` — `.partial-note{color:var(--warn)}` рядом с `.stale-note`
  (зона «caveat»-классов), несущий комментарий про GSL-151 и «one role = one name».
- `tools/lab/ui/src/screens/cost.tsx` — ячейка partial носит `partial-note`.
- `tools/lab/smoke.sh` — блок «GSL-151 (fix wave 2)»: греп исходника cost.tsx (нет
  wk-models), греп разметки `class="partial-note"` на построенном cost.html фикстуры $FL
  (в её леджере partial=1), греп-запрет разметки `class="wk-models"` на cost.html,
  контроль «правило .partial-note определено» (некрашеная роль — не фикс).

### Как проверено прогоном

- **Красный прогон** (родительские cost.tsx + theme.ts, минимальная фикстура с
  `tokens_out=est-unavailable` → by_model partial=1): подтверждено
  `class="wk-models"` на ячейке, partial-note отсутствует.
- **Зелёный прогон** (фиксы возвращены, та же фикстура): PASS partial-note cell,
  PASS no-markup-wk-models, PASS rule-defined, PASS source-clean; `.wk-models` остался
  только в theme.ts (определение + self-health комментарий) и fleet.tsx (использование);
  `npx tsc --noEmit` — 0 ошибок.
- **Computed (Chromium):** ячейка `.partial-note` → rgb(151,101,0) = `--warn` light,
  rgb(255,198,115) = `--warn` dark — тот же amber, что раньше, слово другое.

### Скриншоты

`docs/dev_history/assets/GSL-151/`: cost-fixture-partial-1280-light.png,
cost-fixture-partial-1280-dark.png, cost-fixture-partial-390-light.png,
cost-fixture-partial-390-dark.png — фикстурная Cost-страница с amber-ячейкой partial
(на живых данных partial-строк сейчас нет), viewport, обе темы.
