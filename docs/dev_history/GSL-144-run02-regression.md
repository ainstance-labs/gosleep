# GSL-144 — Verification run 02: regression lane

Standalone-задача (не в эпике). Регрессионный лейн верификационного **run 02** по приёмочному
эпику **GSL-138**, на `main` @ `54fe290`. GH-зеркало: mirror task.

---

## Часть 1 — человеческим языком

### Что сделано

Проверено, что ранее закрытые находки **остаются закрытыми** в закоммиченных артефактах —
без поиска новых проблем (это параллельный fresh-аудитор) и без единой правки продукта
(лейн read-only). Скоуп: 20 находок аудита смены 71 (**GSL-113…GSL-132**, все Done, label
`verifier`) плюс финальные фиксы фикс-волны 1 эпика GSL-141 (**GSL-118/122/123/132** повторно,
**GSL-142/143** как docs-артефакты). Дубли инвариантов между смены-71 и фикс-волной проверены
один раз, отмечены оба ключа.

**Итог: 22 из 22 инвариантов HOLDS. REGRESSED — 0. NOT-VERIFIABLE — 0.** Регрессий не найдено,
новых `[REGRESSION]`-тикетов не заведено.

По каждому тикету выведен один проверяемый инвариант (что обязано быть true в артефакте) и
проверен грепом/чтением. Для GSL-114 — измерение layout в Chromium на 390×844 (viewport, не
fullPage) + два скриншота light/dark в `regression/assets/`.

### Решённые проблемы

- **Грязное рабочее дерево.** На момент лейна `docs/lab/site/*.html`, `mobile/README.md`,
  `render_bundle.json`, `status.json` изменены параллельным chronicler-прогоном оркестратора и
  расходятся с закоммиченными блобами (проверено: `timeline.html` DIFFERS). Поэтому все
  built-инварианты проверялись строго по закоммиченному блобу `git show 54fe290:<path>`,
  извлечённому в scratchpad, а не по файлу на диске. Исходники `tools/lab/ui/src`, `theme.ts`,
  `chronicler.py`, `smoke.sh` — чистые (дерево == HEAD), греп по ним напрямую.
- **Инвариант двух возрастов (GSL-132) сошёлся точно:** `status.json` даёт
  `max_event_age_s = 21411`, а `generated_at − latest_event_ts = 18:18:15 − 12:21:24 = 21411 s`.
  Совпадение до секунды подтверждает фикс «один отсчёт часов на штамп и на возраст».

### Оставшиеся проблемы

- Нет. Все 22 инварианта держатся.
- Несколько MINOR-находок смены 71 (GSL-116, 119, 125) на момент их аудита были невидимы на
  собранной странице (0 открытых вопросов / нет unknown-часов / нужен список эпиков) — их
  инвариант проверялся на уровне исходника/CSS (объявленные классы и модификаторы), что и есть
  доставленный фикс. Отмечено в отчёте как evidence вида `theme.ts:NNN` / `screen.tsx:NNN`.

### Подводные камни

- **Греп по minified-разметке зависает.** Собранные страницы кладут весь body в одну строку
  (100–160 КБ). `grep -oE` с альтернацией по такой строке ушёл в бэктрекинг и был убит по
  таймауту. Извлечение контекста вокруг подстрок сделано через python (плоский `str.find` +
  срез со снятием тегов) — предсказуемо и быстро.
- **`emulate` сбрасывает неуказанные оверрайды.** Вызов только с `colorScheme` вернул viewport
  на 500px; чтобы снять dark на 390px, viewport и colorScheme заданы одним вызовом. Перед
  затвором проверен computed `body background` (dark = rgb(13,14,16), luminance 14 — реально
  тёмный, не светлый лист под именем dark).

### Что не вошло

- Поиск новых дефектов — не роль регрессионного лейна (fresh-аудитор параллельно).
- Правки продукта, тикетов смены 71, чужих незакоммиченных файлов дерева.

## Часть 2 — техническая справка

### Артефакты

- `docs/reports/verifications/GSL-138/runs/02/regression/index.html` — самодостаточная страница
  (file://, zero-deps, светлая+тёмная тема через `prefers-color-scheme` + `data-theme`-тумблер):
  заголовок «Run 02 — Regression lane», две таблицы (тикет | инвариант | вердикт | evidence),
  секция evidence-кадров GSL-114, русская сводка внизу.
- `regression/assets/timeline-390-light.png`, `timeline-390-dark.png` — строго viewport 390×844.

### Инварианты (все HOLDS)

| Ключ | Инвариант (кратко) | Evidence |
| --- | --- | --- |
| GSL-113 | мобильная проекция деградирует, не FRESH вечно | mobile/README.md:3,5 «DEAD at build … at that moment» |
| GSL-114 | Timeline 390px: нет переполнения, сводные таблицы фитятся | Chromium scrollWidth==clientWidth==390; таблицы 366==366 в `.wrap` |
| GSL-115 | без JS шапка не утверждает FRESH·Live | index.html `<noscript>` «frozen at the build» |
| GSL-116 | тип вопроса на Overview с семантическим цветом | overview.tsx:73 `tag ${i.type}` |
| GSL-117 | границы контролов ≥ 3:1 | theme.ts:432–436 `--line-strong` (3.95/3.87) |
| GSL-118 | «(rolls at Y%)», нет «N% of M%» | chronicler.py:1328; 0 в built |
| GSL-119 | `.unknown` не курсивит контейнер часов | theme.ts:355–356, 235–236 |
| GSL-120 | Cost объявляет усечение | cost.html «30 of 107 cycles … LOW» |
| GSL-121 | detail-значения целиком + wrap | components.tsx:207–218 |
| GSL-122 | «that 93% of the log» | timeline.html:469; timeline.tsx:178 |
| GSL-123 | untitled → маркер unknown, 0 пустых ячеек | library.html (1 маркер/171 строка) |
| GSL-124 | `.ok/.warn/.dead` объявлены | theme.ts:324–326, 346–348 |
| GSL-125 | чип ok ≠ warn по цвету | theme.ts:324–325 |
| GSL-126 | баннер переоценивает возраст каждую секунду | client.ts:41–63 `regradeStaleness` |
| GSL-127 | Library files — реальный счёт, не кап 40 | library.tsx:108–112 (99/47) |
| GSL-128 | ответ владельца → «Decided by you» | questions.tsx:160–164 |
| GSL-129 | «N live workers» примирён с ended-карточками | fleet.tsx:149–159 bridge note |
| GSL-130 | нет дублей `#NNN#NNN` | tasks.html (0 пар) |
| GSL-131 | заголовки не режутся на 110 | render_bundle.json (19 >110, 0 …) |
| GSL-132 | «ago»+data-age-suffix; нет тавтологий; 21411==21411 | tasks.tsx:176, client.ts:195, status.json |
| GSL-142 | конвенция per-task ассетов задокументирована | dev_history/README.md:12–31 |
| GSL-143 | стандарт verification runs полон | verifications/README.md |

### Как проверено

- Built-артефакты: `git show 54fe290:<path>` → scratchpad; греп/чтение/python-извлечение.
- Исходники: прямой греп по чистому дереву (`tools/lab/ui/src`, `theme.ts`, `chronicler.py`).
- GSL-114: `mcp chrome-devtools` — emulate 390×844, evaluate `scrollWidth/clientWidth`, таблицы
  и `.wrap` overflow-x; скриншоты viewport. Dark подтверждён computed background.
- Отчёт: открыт из file://, pageOverflow 0, 22 HOLDS-бейджа, оба изображения загружены,
  0 внешних (не-Jira) запросов; тёмная тема — bg rgb(13,14,16).

### Jira / коммит

- Задача **GSL-144** (standalone, In Progress → Done), assignee — владелец.
- Один коммит в `main`: пути `runs/02/regression/**` + этот dev_history + строка индекса.
  Чужие файлы (`runs/02/index.html` и др., грязные `docs/lab/*`) не включены.
