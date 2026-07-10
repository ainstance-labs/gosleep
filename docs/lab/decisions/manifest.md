# Decision manifest — Roman L — v1 (updated 2026-07-10)

> **Owner-sovereign.** Это ЕДИНСТВЕННЫЙ рукотворный файл в `docs/lab/`. Агенты его ЧИТАЮТ каждый
> цикл, ПРЕДЛАГАЮТ правки как diff-секцию в утреннем дайджесте («Manifest candidates») и НИКОГДА
> не правят молча. Правка = владелец редактирует этот файл (хоть с телефона через репо) или
> отвечает «да» на кандидата в канале — тогда оркестратор вносит правку и логирует это решением.
> Каждое автономное решение обязано цитировать пункт манифеста (provenance, F3-S3):
> формат ссылки — `manifest §N.<bullet>`, например `§2.merge-strategy`.
> Seed v1 = Standing rules из ORCHESTRATION-STATE.md + denylist скилла verbatim — манифест даёт
> существующей политике дом, он НЕ изобретает новую (05 §4.3). При расхождении со скиллом/STATE
> действует БОЛЕЕ СТРОГОЕ правило, расхождение эскалируется владельцу.

## 1. Always autonomous (never ask, always log)

- §1.reversible-delivery — обратимая in-repo доставка: код, docs, ветки эпиков, gates, dev_history.
- §1.merge-green — мержить зелёные PR на delivery-ветках и продвигать фазы (FULL AUTONOMY,
  owner 2026-06-29).
- §1.milestone-continue — на границе эпика/фазы НЕ останавливаться: автономно начинать следующую
  разблокированную фазу PRD (owner 2026-07-10).
- §1.transient-error-recover — транзиентная ошибка воркера (`API Error: Server error
  mid-response` и подобные) → один continue-nudge (validated 2026-07-07, 2×).
- §1.spawn-queue — 4-й одновременный воркер не спавнится: очередь + retry на пульсе (cap-3,
  MEMORY/C5).
- §1.quota-wait — session-limit → quiesce/hold/resume по скиллу, никого не будить.

## 2. Decide-by-default (queue a DECISION record, apply default at deadline)

- §2.deadlines — дефолтные `auto_apply_at`: вопрос ночью (00:00–08:30) → сегодня 10:00 local;
  днём → +2h. (`lab-emit.sh` подставляет их сам.)
- §2.merge-strategy — стратегия слияния при развилке → regular merge, НИКОГДА squash
  (конвенция 1-commit-per-task); конфликт после движения main → merge main in, не rebase
  опубликованного.
- §2.model-policy — модель при неоднозначности → Fable 5 для содержательного; СОВСЕМ
  механическое — Opus 4.8 допустим (owner 2026-07-10). `model:` всегда явно.
- §2.eval-n — прогоны evals при неоднозначности объёма → N=2 (owner 2026-06-27).
- §2.scope-ambiguity — неоднозначность объёма задачи с защитимым прочтением → минимальное
  прочтение в рамках PRD, остальное — в отчёт/дайджест как candidate work.

## 3. Always ask, never default (= the denylist, verbatim from the orchestrating skill)

- force-push / rewriting published history
- deleting branches/tags/releases
- prod deploys
- secret rotation
- destructive DB migrations on shared data
- external communications
- deleting cloud/infra resources
- §3.budget — spending beyond the agreed ceiling (`BUDGET_EXCEEDED` = BLOCKER, не breaker)

## 4. Escalation & channels

- §4.active-hours — activeHours: 09:00–24:00 local; night = 00:00–08:30. **Канонический дом
  ночного окна — этот пункт** (скилл Night mode ссылается сюда); «я спать» / «I'm back»
  переопределяют часы немедленно.
- §4.quiet-hours — в ночном окне пуш/будить ТОЛЬКО BLOCKER + critical-список скилла (denylist
  hit, mass-death, restart-budget exhaustion, breaker OPEN, BUDGET_EXCEEDED); всё остальное —
  батчем в утренний дайджест.
- §4.channel-order — порядок каналов: live-терминал (owner present) → [Ф6: Claude-app push →
  Telegram] → morning digest. До Ф6 «пуш» = запись + эскалация в STATE/digest.
- §4.blocker-repush — BLOCKER без ответа дольше 4h днём → повторная эскалация раз в 4h; ночью —
  один пуш, повтор в дайджесте.

## 5. Budget & runway

- §5.phase-ceiling — токен-потолок на фазу: по брифу эпика (если не задан — FYI при первом же
  превышении типового объёма прошлой фазы).
- §5.warn-80 — 80% потолка → FYI-запись в очередь; 100% → `BUDGET_EXCEEDED` = BLOCKER (§3).
- §5.restart-budget — рестарты оркестратора: 3 за 60 мин (ночное окно: 3/ночь) — тулинг GSL-53.
- §5.slots — слоты воркеров: max 3 (C5), очередь на пульсе.

## 6. Standing preferences (style, language, review strictness…)

- §6.language — владельцу (дайджест, отчёты, dev_history Part 1) — по-русски; skill/код/схемы —
  EN.
- §6.delivery — Epic+Task; 1 branch/Epic; 1 commit/Task; 1 PR/Epic; regular merge; dev_history на
  задачу + README-индекс; GH mirrors Jira.
- §6.reviews — boundary review на цикл (mid-tier reviewer, отчёт в файл, ≤12 строк оркестратору);
  вся верификация — cheap tier.
- §6.safety — kill-pane только по явному id после re-list; NO Workflow tool у воркеров; артефакты
  в дереве проекта (`.artifacts/`), не `/tmp`.
- §6.orchestrator — оркестратор не исполняет delivery; state on disk; dated handoff на каждой
  границе сессии.
