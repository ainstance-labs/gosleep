# GSL-147 — Статусы Jira на Tasks board получили судейский цвет по спеке 7.2: Done → ok, To Do → warn, In Progress → info

Задача эпика GSL-153 «Fix wave 2: verification run 02 findings» (GH #148).
Jira: GSL-147 · GH: #150 · находка 2 (MAJOR) аудита verifier-skeptic, run 02:
«Jira statuses Done / To Do / In Progress render neutral on the Tasks board —
spec 7.2 assigns them ok / warn / info».

---

## Часть 1 — человеческим языком

### Что сделано

Колонка статусов рендерила каждый polled-статус голым нейтральным чипом
(`<span class="tag">{r.status}</span>`), неотличимым от метаданных вроде MERGED, — при том
что таблица спеки 7.2 «Цветные — только оценка» явно перечисляет статусы задач среди
цветных: `Done` → `--ok`, `To Do` → `--warn`, `In Progress` → `--info`.

Фикс в двух местах:

- **tasks.tsx** — карта `STATUS_TONE` (ровно три статуса из таблицы 7.2) и чип
  `class="tag st <tone>"`. Статус, которого нет в таблице (In Review, Blocked…), остаётся
  голым `tag` — цвет зарабатывается, а не раздаётся всем подряд.
- **theme.ts** — одно новое правило `.tag.st.info{…}` на инфо-тон. Done и To Do едут на
  существующих парах `.tag.ok` / `.tag.warn`.

Ключевое проектное решение — scoped-класс `st` (зеркально идиоме `tag sev …` таймлайна):
голая пара `.tag.info` матчила бы и `class="tag sev info"` — а спека 7.2 отдельной
оговоркой держит sev=info на таймлайне НЕЙТРАЛЬНЫМ (181 из 200 строк; красить дефолт —
красить весь экран). Guard-ассерт в смоуке это закрепляет.

### Решённые проблемы

- Утечка info-тона на таймлайн предотвращена конструкцией селектора, а не дисциплиной
  разметки, и охраняется отдельным guard-грепом (`\.tag\.info{` не должен существовать).

### Оставшиеся проблемы

- Нет.

### Подводные камни

- `chronicler.sh --repo <относительный путь>` молча не доносит site-сборку до фикстуры —
  каталог site/ создаётся пустым. Смоук всегда передаёт абсолютный `$WORK/...`; красный
  прогон сначала споткнулся именно об это.

### Что не вошло

- Пересборка закоммиченных страниц — последним коммитом волны (GSL-150).

## Часть 2 — техническая справка

### Файлы

- `tools/lab/ui/src/screens/tasks.tsx` — `STATUS_TONE` + чип `tag st <tone>` (несущий
  комментарий: почему ровно три статуса и почему scoped).
- `tools/lab/ui/src/theme.ts` — `.tag.st.info{…}` рядом с sev-правилами (несущий
  комментарий: почему НЕ голое `.tag.info`).
- `tools/lab/smoke.sh` — блок «GSL-147 (fix wave 2)»: фикстура из 4 tracker.issue.updated
  (Done / To Do / In Progress / In Review), 3 позитивных грепа + контроль нейтральности
  In Review + guard от голого `.tag.info`.

### Как проверено прогоном

- **Красный прогон** (родительские tasks.tsx + theme.ts, восстановленные `git show HEAD:`,
  сборка фикстуры): FAIL×3 (все три статуса — `class="tag">…<`), подтверждено грепом:
  Done/In Progress/In Review/To Do все по 1 разу как голый tag.
- **Зелёный прогон** (фиксы возвращены, та же фикстура): PASS×4 + PASS guard;
  `npx tsc --noEmit` — 0 ошибок.
- **Computed styles (Chromium, light, живая страница):** Done ×5 → rgb(0,120,53) /
  rgb(230,250,233); To Do ×3 → rgb(151,101,0) / rgb(255,241,223); In Progress ×1 →
  rgb(0,104,165) / rgb(234,245,255) — дословно ожидания тикета (#007835/#e6fae9,
  #976500/#fff1df, #0068a5/#eaf5ff).

### Скриншоты

`docs/dev_history/assets/GSL-147/`: tasks-1280-light.png, tasks-1280-dark.png,
tasks-390-light.png, tasks-390-dark.png + tasks-rows-1280-light.png,
tasks-rows-1280-dark.png (viewport, проскроллен к строкам с Done/To Do — судейский канал
виден рядом с magenta-unknown). Не fullPage.
