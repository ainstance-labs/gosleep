# GSL-148 — doc_title декодирует HTML-сущности: Library больше не печатает литеральный «&amp;» в тайтлах отчётов

Задача эпика GSL-153 «Fix wave 2: verification run 02 findings» (GH #148).
Jira: GSL-148 · GH: #151 · находка 3 (MINOR) аудита verifier-skeptic, run 02:
«Library shows literal «&amp;» in two report titles — chronicler doc_title does not decode
HTML entities, preact escapes again».

---

## Часть 1 — человеческим языком

### Что сделано

Двойной эскейп через два слоя: `doc_title()` поднимал сырой текст `<title>` HTML-отчёта без
декодирования сущностей — бандл нёс `&amp;`; preact-вью экранировал строку второй раз, и на
построенной странице читатель видел пять символов «&amp;» в двух тайтлах Reports. Та же
строка с сущностью сериализовалась в поисковый остров — свободный поиск по «&» эти строки
не находил.

Фикс — одна строка данных: HTML-ветка `doc_title()` теперь возвращает
`html.unescape(<очищенный от тегов текст>)` (+ `html` в списке импортов). Декодирование
идёт ПОСЛЕ снятия тегов: литеральная «&lt;b&gt;» в тайтле останется текстом, а не станет
тегом под нож. Markdown-ветка не тронута — сущностям в `# Заголовок` взяться неоткуда.

### Решённые проблемы

- Ремонт сделан в data-слое (бандл несёт сам символ), а не заплаткой во вью: вью обязан
  экранировать ровно один раз, и теперь это инвариант, который держит смоук.

### Оставшиеся проблемы

- Нет.

### Подводные камни

- Порядок операций важен: unescape ДО снятия тегов превратил бы «&lt;b&gt;» из текста в тег
  и потерял бы его. Несущий комментарий в chronicler.py это фиксирует.

### Что не вошло

- Пересборка закоммиченных страниц — последним коммитом волны (GSL-150). Локальная
  пересборка в worktree уже показывает: 0 вхождений «&amp;amp;» в library.html, оба
  реальных тайтла излечены.

## Часть 2 — техническая справка

### Файлы

- `tools/lab/chronicler.py` — импорт `html`; `doc_title()` HTML-ветка возвращает
  `html.unescape(...)` с несущим комментарием (GSL-148).
- `tools/lab/smoke.sh` — блок «GSL-148 (fix wave 2)»: фикстура-отчёт
  `<title>Amp &amp; sand — fixture</title>` → jq-проверка бандла (title == «Amp & sand —
  fixture», сам символ), греп единожды-экранированной формы на странице, греп-запрет
  «&amp;amp;» на всей построенной Library.

### Как проверено прогоном

- **Красный прогон** (родительский chronicler.py из `git show HEAD:`): FAIL bundle-decoded
  (бандл нёс «Amp &amp; sand — fixture»), на странице подтверждён двойной эскейп
  «&amp;amp;».
- **Зелёный прогон** (фикс возвращён, та же фикстура): PASS bundle-decoded, PASS
  once-escaped, PASS no-double-escape; `python3 -c "import ast; ast.parse(...)"` — синтаксис
  чист.
- **Реальные данные** (пересборка worktree): `grep -c '&amp;amp;' library.html` → 0;
  DOM-проба Chromium: td.textContent == «…Subscription & Orchestrator Supervision…», ни
  одна ячейка не содержит литеральный «&amp;».

### Скриншоты

`docs/dev_history/assets/GSL-148/`: library-1280-light.png, library-1280-dark.png,
library-390-light.png, library-390-dark.png + library-amp-1280-light.png,
library-amp-1280-dark.png (viewport, проскроллен к Reports-строке с амперсандом).
