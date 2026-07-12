# GSL-76 — decisions/manifest.md: owner-sovereign манифест, 6 секций (seed из Standing rules + denylist)

**Epic:** GSL-72 — Question buffer + decision manifest (PRD Phase 3)
**Branch:** GSL-72-question-buffer
**Phase:** PRD Phase 3, requirement R3.3 (decision manifest)

---

## Part 1 — Story

### What was done
- **`docs/lab/decisions/manifest.md` v1** — единственный рукотворный файл в `docs/lab/`.
  Шапка фиксирует суверенитет: агенты ЧИТАЮТ каждый цикл, ПРЕДЛАГАЮТ diff в дайджесте, НИКОГДА
  не правят молча; формат provenance-ссылки `manifest §N.<bullet>` (напр. `§2.merge-strategy`) —
  им обязано цитироваться каждое автономное решение (F3-S3). Секции (05 §4.3):
  1. **Always autonomous** — seed из Standing rules STATE: reversible delivery, merge-green
     (owner 2026-06-29), milestone-continue (owner 2026-07-10), transient-error-recover
     (validated 2026-07-07), spawn-queue cap-3, quota-wait.
  2. **Decide-by-default** — дефолтные дедлайны (ночь → 10:00, день → +2h — те же, что зашиты в
     lab-emit), merge-strategy (regular, never squash), model-policy (Fable 5 / Opus-механика,
     owner 2026-07-10), eval-N=2, scope-ambiguity.
  3. **Always ask** — denylist VERBATIM из скилла (7 пунктов) + BUDGET_EXCEEDED.
  4. **Escalation & channels** — **канонический дом activeHours** (09:00–24:00; night
     00:00–08:30), quiet-hours push-политика (только BLOCKER + critical-список), порядок каналов
     (до Ф6 «пуш» = запись + STATE/digest), re-push повисших BLOCKER.
  5. **Budget & runway** — phase ceiling, 80%→FYI / 100%→BUDGET_EXCEEDED, restart budget
     (GSL-53), слоты 2/3.
  6. **Standing preferences** — язык (RU владельцу / EN skill+код), delivery-конвенции, review
     strictness, safety-инварианты, execute-nothing.
- **SKILL.md** — новая секция «Decision manifest — decide by the owner's manifest»: где лежит,
  суверенитет, 6 секций, правило разрешения развилки (§1 → act+log с цитатой; §3 → BLOCKER без
  исключений; между → DECISION с default+deadline через lab-emit; решение без цитируемого правила
  = не автономное). Night mode «Where declared» перенаправлен на manifest §4 как канонический дом
  (Standing-rules строка — зеркало/временный override), как и обещал текст GSL-68.

### Problems solved
- **Политика была размазана** по Standing rules, MEMORY и чат-директивам — теперь у неё дом,
  который читает тулинг и версионирует владелец (05 §4.3: «home the tooling can read»).
- **«Решай сам» получил проверяемую границу:** автономно = есть пункт §1; спорно = DECISION с
  дефолтом по §2; опасно = §3 verbatim denylist. Расхождение манифеста со скиллом → строже +
  эскалация (манифест не изобретает политику — C8).

### Where the bodies are buried
- Манифест «живой» и правится ТОЛЬКО владельцем — если владелец его не трогает, v1-дефолты и
  есть политика (они сняты с действующих Standing rules, ничего нового).
- §4.channel-order до Ф6 деградирует в «запись + дайджест» — пуш-каналы появятся в Mobile-фазе.
- Learning loop (§4.4 дизайна) сюда НЕ входит — это GSL-77 (log.jsonl + candidates).

## Part 2 — Reference

- **Files:** `docs/lab/decisions/manifest.md` (new, v1),
  `skill/orchestrating-delivery-agents/SKILL.md` (new "Decision manifest" section; Night mode
  "Where declared" → manifest §4).
- **Acceptance:** R3.3 — секции 1/3 зеркалят authority/denylist скилла verbatim; F3-S3 формат
  цитаты определён и обязателен.
- **Gates:** `./install.sh` + `diff -r` global — clean; манифест парсится как обычный MD.
