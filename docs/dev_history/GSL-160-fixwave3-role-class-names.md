# GSL-160 — Заимствованные имена ролей возвращены хозяевам: .scope-note для статических caption'ов, .tag.high-impact для флага

Задача эпика GSL-161 «Fix wave 3: verification run 03 findings» (GH #159).
Jira: GSL-160 · GH: #164 · находка 5 (MINOR) аудита verifier-skeptic, run 03:
«role-borrowed class names — .filter-count as a generic caption (Fleet, Cost) and .tag.BLOCKER
on the high-impact flag».

---

## Часть 1 — человеческим языком

### Что сделано

Три заимствования против нормы «одна роль — одно имя» (прецедент GSL-151):

1. Статический caption Fleet («A card per worker the log can name…») носил `filter-count` —
   класс ЖИВОГО счётчика клиентского фильтра, чей className client.ts переписывает целиком и на
   котором theme.ts прямо запрещает жить layout-классам. На Fleet фильтра нет.
2. Gap-note Cost (с контрактным `data-cycle-gap`) — то же заимствование ради вида.
3. Бейдж «high impact» на Questions носил `tag BLOCKER` — имя типа вопроса: два смысла на одном
   правиле, следующий редактор любого из них молча задел бы второй.

Фикс: новая роль `.scope-note` (статическая подпись «что не на экране»; та же тройка деклараций,
что у базового `.filter-count` — muted, t-sm, отступ) для Fleet-caption и Cost-gap-note; правило
`.tag.high-impact` с dead-тройкой ПО ЗНАЧЕНИЮ (не по имени) для флага. Разметка трёх экранов
переведена на свои имена; `.filter-count` и `.tag.BLOCKER` остались своим родным потребителям.

### Решённые проблемы

- Одна роль или две для Fleet/Cost? Обе надписи — статическая подпись «что не показано на
  экране» (несфильтрованные сессии, циклы без строки), одна роль — одно общее имя. Контракт
  `data-cycle-gap` живёт на атрибуте и сохранён дословно.

### Оставшиеся проблемы

- Нет. Визуальный рендер не менялся нигде (подтверждено computed-замерами до/после — значения
  совпадают с прежними правилами).

### Подводные камни

- Первая версия смоук-грепов держала голые строки `filter-count` / `"tag BLOCKER"` и ловила
  СОБСТВЕННЫЕ комментарии фикса, называющие заимствование в отрицании — урок GSL-152 повторён;
  грепы сужены до формы разметки `class="…"`.

### Что не вошло

- Пересборка закоммиченных derived-страниц — последним коммитом волны (норма docs/lab/README.md).

## Часть 2 — техническая справка

### Файлы

- `tools/lab/ui/src/theme.ts` — `.scope-note{…}` (после блока .filter-count, с комментарием о
  разнице ролей) и `.tag.high-impact{…}` (после .tag.dead,.tag.BLOCKER, с комментарием
  «тройка по значению, не по имени»).
- `tools/lab/ui/src/screens/fleet.tsx`, `cost.tsx` — `class="scope-note"` (+ data-cycle-gap
  сохранён); `questions.tsx` — `class="tag high-impact"`.
- `tools/lab/smoke.sh` — блок «GSL-160 (fix wave 3)»: 3 запрета заимствованной разметки в
  исходниках + пара «scope-note + data-cycle-gap» + `class="scope-note"` на собранном fleet.html
  фикстуры $FL + определённость обоих новых правил в собранном стайлшите + контроль «правило
  .filter-count живо» (переименование ничего не отняло у живого счётчика).

### Как проверено прогоном

- **Красный прогон** (родительские версии 4 файлов = HEAD 9f6ec45, фикстура с воркером и
  high_impact-вопросом): 3 запрета разметки RED, markup/CSS-грепы новых имён FAIL×4.
- **Зелёный прогон** (после фикса): PASS по всем; `npx tsc --noEmit` — 0 ошибок.
- **Computed styles (Chromium):** caption Fleet на `.scope-note` — rgb(104,105,107) = `--muted`,
  12px = `--t-sm` (light); rgb(151,152,155) (dark) — байт-в-байт прежний вид; флаг
  `.tag.high-impact` — light bg rgb(255,239,238) / ink rgb(144,40,40) / border rgb(252,192,186),
  dark bg rgb(55,35,33) / ink rgb(240,127,119) / border rgb(104,56,52) — dead-тройка, прежний вид.

### Скриншоты

`docs/dev_history/assets/GSL-160/`: fleet-1280-light.png, fleet-1280-dark.png,
fleet-390-light.png, fleet-390-dark.png (caption на .scope-note), questions-1280-light.png,
questions-1280-dark.png (флаг high impact на своём классе) — viewport-кадры, обе темы;
computed bg проверен пробой перед затвором; на 390 scrollWidth == clientWidth == 390.
