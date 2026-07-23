# GSL-156 — Правило .unknown скоуплено на span: контейнерный класс больше не красит прозу карточки

Задача эпика GSL-161 «Fix wave 3: verification run 03 findings» (GH #159).
Jira: GSL-156 · GH: #160 · находка 1 (MAJOR) аудита verifier-skeptic, run 03:
«unscoped .unknown cascade paints whole self-health cards in status magenta».

---

## Часть 1 — человеческим языком

### Что сделано

Класс `unknown` носят не только span-маркеры значения (компонент `Unknown`), но и целые
контейнеры: `class="card sh-m unknown"` (selfhealth.tsx, meterClass) и `class="clock unknown"`
(runway.tsx). Правило `.unknown{color:var(--unk);font-style:normal;cursor:help}` не было
скоуплено по элементу, и в self-health карточке дети без собственного цветового правила —
заголовок `.sh-h`, значение `#sh-data-age` («8h 17m» — ПРОЧИТАННОЕ показание), проза `.sh-row` —
наследовали статусную магенту, а вся карточка получала `cursor:help`. Это правило 2 раздела 1
спеки, нарушенное самим маркером отсутствия.

Фикс — то, что уже было сделано для underline (он был скоуплен на span с самого начала),
доведено до конца: цвет и cursor тоже скоуплены — единое правило
`span.unknown{color…;cursor:help;text-decoration:underline dotted;…}` (theme.ts). Контейнер несёт
состояние на левой грани (`.sh-m.unknown`) или на чернилах значения (`.clock.unknown .clock-val`),
и это не менялось.

### Решённые проблемы

- Отвергнут соблазн «перекрыть детей собственными правилами» (как это сделал `.clock`):
  правильная зона действия — сам маркер; контейнер вообще не должен раздавать чернила детям.

### Оставшиеся проблемы

- Freshness при grade=dead всё ещё несёт `card sh-m unknown` (магентовая ГРАНЬ вместо красной) —
  это отдельная находка GSL-157 (следующий коммит волны), здесь не трогалась.

### Подводные камни

- `span.unknown` проигрывал бы `.tag.unknown` (0,2,0) по специфичности — и это правильно:
  бейдж-маркеры (`tag unknown` в EpicRow) берут тройку бейджа, включая `text-decoration:none`.
- theme.ts — один template literal: бэктики в CSS-комментариях запрещены (урок GSL-146).

### Что не вошло

- Пересборка закоммиченных derived-страниц — по норме docs/lab/README.md последним коммитом волны.

## Часть 2 — техническая справка

### Файлы

- `tools/lab/ui/src/theme.ts` — блок «Absence, rendered ONE way»: правило слито в
  `span.unknown{…}`, несущий комментарий объясняет контейнерные носители класса.
- `tools/lab/smoke.sh` — блок «GSL-156 (fix wave 3)»: греп span-скоупленного правила в собранном
  index.html фикстуры $CR + guard «нет голого `.unknown{`» + контроль невакуумности
  (`class="card sh-m unknown"` реально присутствует).

### Как проверено прогоном

- **Красный прогон** (родительская версия theme.ts = HEAD 4b91dfc, dead-фикстура a-la $CR):
  греп span-правила FAIL, guard голого правила RED, контроль контейнера PASS.
- **Зелёный прогон** (после фикса, та же фикстура): PASS×3; `npx tsc --noEmit` — 0 ошибок.
- **Computed styles (Chromium):** light — заголовок `.sh-h` rgb(26,27,28) = `--fg`, значение
  `#sh-data-age` rgb(26,27,28), cursor карточки `auto`, левая грань rgb(142,77,157) = `--unk`;
  dark — заголовок/значение rgb(240,242,244), грань rgb(213,143,229); сам маркер
  `span.unknown:not(.tag)` сохранил rgb(142,77,157) + underline dotted + cursor:help +
  font-style normal. До фикса заголовок и значение мерились rgb(142,77,157) (отчёт run 03).

### Скриншоты

`docs/dev_history/assets/GSL-156/`: index-1280-light.png, index-1280-dark.png,
index-390-light.png, index-390-dark.png — viewport-кадры (не fullPage) карточки Freshness при
grade=dead, обе темы; computed bg проверен пробой перед затвором (light body rgb(245,247,249),
dark body rgb(13,14,16)); на 390 scrollWidth == clientWidth == 390.
