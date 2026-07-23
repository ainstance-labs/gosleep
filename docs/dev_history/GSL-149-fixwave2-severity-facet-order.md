# GSL-149 — Severity-фасет Timeline упорядочен worst-first, как и обещал его собственный комментарий

Задача эпика GSL-153 «Fix wave 2: verification run 02 findings» (GH #148).
Jira: GSL-149 · GH: #152 · находка 4 (MINOR) аудита verifier-skeptic, run 02:
«Timeline severity filter options are appearance-ordered (info, warn, incident), not
worst-first as the code itself promises».

---

## Часть 1 — человеческим языком

### Что сделано

Фасет severity строился generic-функцией `facetValues()` — порядок первого появления в
фиде. На реальной странице это давало `info, warn, incident`: владелец, сканирующий ночь
на предмет беды, находил `incident` в конце списка. При этом комментарий прямо над фасетом
декларировал обратное («Worst-first, not alphabetical: at 03:00 the owner opens incident»),
а `severity.ts` экспортирует `SEVERITIES` ровно в этом worst-first порядке — фасет просто
никогда с ним не сверялся.

Фикс — одна строка: `values: SEVERITIES.filter((s) => rows.some((r) => r.severity === s))`.
Порядок несёт `SEVERITIES` (incident, warn, info, unknown); пересечение с фактически
присутствующими значениями сохранено — бокс по-прежнему не предлагает грейд, который ничему
не соответствует («no invented options»).

### Решённые проблемы

- Комментарий-обещание и код сведены: намерение теперь исполняется тем самым экспортом,
  который его формализует, — новый порядок появится сам, если SEVERITIES расширят.

### Оставшиеся проблемы

- Нет.

### Подводные камни

- Опция «all» рендерится как `<option value>` (preact схлопывает пустой атрибут), поэтому
  ассерт-экстрактор матчит только value-полные опции (`value="([^"]+)"`) — иначе красный
  прогон ловил бы не тот дефект.

### Что не вошло

- Пересборка закоммиченных страниц — последним коммитом волны (GSL-150).

## Часть 2 — техническая справка

### Файлы

- `tools/lab/ui/src/screens/timeline.tsx` — импорт `SEVERITIES`, фасет строится из него
  с пересечением по факту; комментарий дополнен ссылкой на GSL-149.
- `tools/lab/smoke.sh` — блок «GSL-149 (fix wave 2)»: python-экстракция опций
  `select[data-facet="severity"]` из построенного timeline.html фикстуры $FT (в ней все
  четыре severity, benign-первые в фиде — ровно ловушка порядка появления); требуемая
  строка `incident,warn,info,unknown`.

### Как проверено прогоном

- **Красный прогон** (родительский timeline.tsx, реальная страница worktree):
  `severity options: info,warn,incident` — порядок появления, incident последним.
- **Зелёный прогон** (после фикса + пересборка): `severity options: incident,warn,info` —
  worst-first; unknown в реальном фиде отсутствует и честно не предлагается.
  Фикстурный случай со всеми четырьмя значениями держит смоук-ассерт.
  `npx tsc --noEmit` — 0 ошибок.

### Скриншоты

`docs/dev_history/assets/GSL-149/`: timeline-1280-light.png, timeline-1280-dark.png,
timeline-390-light.png, timeline-390-dark.png — viewport-кадры фильтр-бара. Порядок опций
внутри закрытого нативного select на кадре не виден — доказательство порядка несут
DOM-пробы выше и смоук-ассерт.
