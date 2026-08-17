# PRD — Эволюция GoSleep: «оркестратор, при котором владелец спит»

> **Status:** Live — last delta 2026-08-17 (Wave-4b, systems-audit process tail, GSL-238).
> **Data valid as of:** 2026-08-17.
> **Updated by:** wave4b (GSL-238).
> **Владелец:** Roman L (rommxx@gmail.com) · **Проект:** GSL (GoSleep) · **Ветка исследования:** GSL-41
> **Источник фактов (primary):** `docs/research/2026-07-07-orchestration/{01..05}-*.md`
> **Контекст (сводные отчёты):** `docs/reports/{orchestrator-landscape,headless-and-supervision,autonomy-lab-ui,loop-engineering}/index.html`
> — Contextual reports above were valid as of 2026-07-08…07-10; drift since then
> is discussed in `docs/reviews/system-audit-2026-07-24/SYNTHESIS.md`.
> **Skills are a living artefact.** Authoritative copies live under
> `~/.claude/skills/` for all seven owned skills; the repo tree under `skill/`
> is a redundancy copy (GSL-334). Editing a skill is a shift-closing item per
> `skill/handoff/SKILL.md` Procedure step 7 (GSL-189).
>
> **PRD-maintenance rule (GSL-238, 2026-08-17).** A PRD delta is a mandatory
> part of every epic closure. See `docs/process/prd-maintenance.md` for the
> exact contract (what to update, in which commit, with what proof).

Это внутренний PRD владельца. Английские технические термины и названия оставлены в оригинале.
Документ — контракт «ЧТО должно работать и КАК мы поймём, что готово». Он **не создаёт** Jira/GitHub
задач: раздел «Задачи» в каждой фазе перечисляет commit-sized работы, которые процесс доставки
(`delivery-workflow`, конвенция Epic+Task) подхватит при старте фазы.

---

## Часть 1 — Простыми словами

**1. Что это.** GoSleep — это надстройка над уже работающим оркестратором доставки (skill
`orchestrating-delivery-agents`: lead-сессия в Claude Code + Agent Teams/tmux, воркеры в панелях,
handoff-файлы, ledger `ORCHESTRATION-STATE.md`). Сегодня всё это работает, **пока владелец держит
сессию оркестратора живой**. Цель эволюции — снять это условие: владелец уходит спать, флот
продолжает доставлять, сам себя чинит при сбоях, сам документирует ночь и к утру кладёт на стол один
экран с «что сделано / что решено за тебя / что ждёт твоего слова».

**2. Почему сейчас.** Исследование GSL-41 (5 findings + 4 отчёта) дало точный ответ на вопрос
владельца «можно ли это построить на подписке и не сжечь аккаунт». Ответ: да — на официальных
поверхностях (interactive Claude Code + Agent Teams; `claude -p` как ограниченный клей). Оно же нашло
единственную дыру, которую текущая система не умеет закрывать сама: **умер оркестратор в 3 ночи —
флот осиротел до утра** (finding 02, раздел 9; finding 04, раздел 5). Пока эта дыра открыта, «идти
спать» небезопасно. Всё остальное (пульс, буфер вопросов, лаборатория, UI, mobile) — это слои,
которые превращают «работает без человека» в «безопасно оставить на ночь».

**3. Как выглядит «готово».** Владелец пишет оркестратору «я спать», закрывает ноутбук/уходит с
телефоном. Ночью: воркеры доставляют задачи; оркестратор пульсирует и сам себя перезапускает из STATE
при падении (под бюджетом рестартов); вопросы не блокируют панели — они попадают в типизированный
буфер, на обратимые берётся дефолт по манифесту владельца, спорные ждут дедлайна и применяют дефолт,
опасные (denylist) — единственное, что будит владельца пушем. Утром один статический HTML-экран
(и/или дайджест в телефоне) показывает: что смёржено, что решено за него и по какому правилу, что ждёт
ответа с обратным отсчётом. Вопросов-за-ночь для повторяющихся ситуаций со временем становится ноль.

**4. Риски.** (a) Research-preview статус официальных поверхностей (Routines, Remote Control) — surface
может измениться → оборачиваем в тонкий скилл-слой. (b) `claude -p` billing status is UNRESOLVED and
remains an open question (updated 2026-08-17, GSL-238 delta). Anthropic's own source (`support.claude.com`, verified 2026-07-24)
reads: "Update June 15: We're pausing the changes… For now, nothing has changed: Claude Agent SDK,
`claude -p`, and third-party app usage still draw from your subscription's usage limits" — i.e. the
announced move to the programmatic credit pool was PAUSED, not rolled out, and the pause may be
lifted. Empirically confirmed on this machine: independent live runs (2026-07-24 and 2026-08-17)
returned `exit 0`, `provider: firstParty`, no API key, subscription usage. A single trivial call
was measured at ≈ $0.30 with `cache_read = 0` — cache reuse across separate `-p` invocations is
effectively zero. Therefore: budget the glue strictly (`--max-budget-usd`), keep the engine on
interactive quota, and **explicitly forbid polling via `-p`** (≈ $48 over an eight-hour night from
the same pool the fleet uses). (c) Watchdog, срабатывающий на ложных сигналах, может убить здоровый
флот → все уроки Gastown (debounce/cooldown/grace) вшиты в Фазу 1 как обязательные. (d) Лимит машины
~3 панели и правило `kill-pane` только по явному id — жёсткие инварианты (см. MEMORY).

**5. Открытые решения.** Порог context% для эскалации ролла; точные `activeHours` ночного окна; выбор
push-канала первого приоритета (Claude-app push vs self-hosted ntfy); хостинг ntfy (self-host vs
ACL'd topic); момент включения learning-loop (после N записей `decisions/log.jsonl`). Дефолты
предложены в тексте фаз и в манифесте (Фаза 3); владелец правит манифест.

---

## Сквозные ограничения (constraints) — обязательны для ВСЕХ фаз

Эти инварианты — не пожелания, а границы решения. Любая задача любой фазы, нарушающая их, считается
дефектом PRD.

| # | Ограничение | Обоснование (источник) |
|---|---|---|
| C1 | **Только Claude-подписка. Никаких API-ключей.** `install.sh`/doctor должен sanity-проверять `unset ANTHROPIC_API_KEY` (стрей-ключ молча перехватывает подписку в non-interactive). | 03 раздел 2 (precedence: exported key hijacks subscription); 01 раздел 4 (subscription-native через уже-залогиненный `claude`) |
| C2 | **Движок = interactive Claude Code + Agent Teams/tmux.** Вердикт исследования: самая защищённая Anthropic'ом поверхность и самая щедрая по $/token (interactive quota, 5h/weekly). Не переносить bulk-работу на API/SDK. | 03 раздел 3 (approach matrix, рекомендация A); 02 раздел 8 (subscription-CLI auth) |
| C3 | **`claude -p` — bounded glue only, and only as a one-off judgement call** (updated 2026-08-17, GSL-238 delta). Strict `--allowedTools` + mandatory `--max-budget-usd`. Allowed: a single call when the mechanism has ALREADY detected an anomaly and needs to read the ledger and render a judgement. Forbidden: scheduled polling (measured 2026-07-24 — $0.30 per call with zero cache reuse, ≈ $48 for an eight-hour night). **Billing model is NOT established:** Anthropic's own source on 2026-07-24 says "pausing… nothing has changed" (subscription pool is still the source of truth) but the pause is reversible. Any decision that leans on billing requires a fresh live check (`/usage` in an interactive owner session). | 03 раздел 2; primary source support.claude.com (2026-07-24 + 2026-08-17); supervision measurement F10 + red-team |
| C4 | **NO Workflow tool** в воркерах и в этой надстройке. Mechanism-level cap, не prompt-level. | orchestrating skill «Workers get NO multi-agent Workflow tool»; 02 STEELMAN (coordination tax) |
| C5 | **Максимум 3 одновременных воркер-панели** (лимит машины: 4-я даёт `fork failed`). Очередь + retry на пульсе. | MEMORY «Teammate spawn cap ~3»; 05 раздел 5.1 (slots 2/3) |
| C6 | **Модели по политике владельца:** three-tier (orchestrator — premium/coordination-only; workers/reviewers — mid; вся verification — cheap). `model:` всегда явно при спавне. | orchestrating skill «Three model tiers»; 02 раздел 2 (model-tiers) |
| C7 | **Liveness — только из durable-артефактов** (mtime файла, git, event-row), НИКОГДА из self-report или pane-scraping. Единственный источник правды. | 02 раздел 5b (warren watchdog = newest event); 04 раздел 3.9 (a wedged agent can't report) |
| C8 | **STATE + handoff остаются авторитетом.** Всё новое (`docs/lab/`, `status.json`, дашборд) — производное; при конфликте побеждают STATE + live git (существующее правило suspect-handoff). Атомарная запись (temp+rename) для всего не-append. | orchestrating skill (STATE authority, atomic write); 05 раздел 3.3 |
| C9 | **A mechanism counts as delivered only when it is ARMED on this machine** (added 2026-08-17, GSL-236/GSL-238 delta). Code plus green tests is not acceptance. Every phase shipping a mechanism (supervisor, breaker, tick, server, hook) MUST close with an `ARMED-CHECK` block sourced from `tools/lab/armed-check.sh` — receipt at `.artifacts/lab/gates/armed-check.json`. Off-record mechanisms are named with an explicit reason; silence = defect. Full checklist: `docs/process/phase-acceptance-checklist.md`. | Shift-73 audit finding 89 (MAJOR): Phase 1 marked DONE while `launchctl list \| grep com.gosleep.watchdog` returned nothing for 104 cycles; smoke 75/75 green against fixtures that had never been reconciled with the live machine |

---

## Карта фаз и обоснование порядка

| Фаза | Название | Readiness (2026-08-17) | Что даёт владельцу | Зависит от | Усилие |
|---|---|---|---|---|---|
| 1 | Watchdog над оркестратором | **PARTIAL** — GSL-49 code DONE (PR #66) + shift-73 audit + follow-ups GSL-178/211 (armed-check receipt now the source of truth); live installation status: read from `.artifacts/lab/gates/armed-check.json` at closure. | Флот переживает смерть оркестратора ночью | существующий cold-start/STATE (+ минимальный heartbeat) | **M** |
| 2 | Self-pulse + night mode | **PARTIAL** — GSL-65 (PR #82); heartbeat + night mode present; measured cadence still drifts vs spec (2026-07-24 audit). | Оркестратор сам планирует пробуждения дёшево; ночной режим и авто-wait по квоте | Ф1 (heartbeat-файл) | **M** |
| 3 | Question buffer + decision manifest + morning digest | **DONE** — GSL-72 (PR #92); question buffer + manifest + digest live; learning-loop candidates flow (GSL-227/229) landed in Wave-4b sibling epic. | Вопросы не блокируют ночь; решения по манифесту; утренний дайджест | Ф2 (night mode как триггер буферизации) | **M** |
| 4 | Laboratory (auto-doc) | **PARTIAL** — GSL-81/90; T1 (events) autonomous; T3 debounced trigger present (GSL-364 PostToolUse). `telemetry.jsonl` was declared but never created; removed from layout in Wave-4b (see R4.3 note). | Ночь фиксируется сама: события → JSONL, дашборд/дайджест регенерируются | Ф3 (queue/manifest/digest как данные) | **L** |
| 5 | UI оркестрации | **SUPERSEDED (v1) → рабочий web control plane (Epic GSL-250)** — v1 static bundle preserved as rollback surface (`docs/lab/site/*.html`, `GOSLEEP_KEEP_STATIC_SITE=1`); live UI now served by `apps/core` + `apps/web` on `127.0.0.1:7331` (deprecation recorded in `docs/runbooks/gosleep-core.md`, PRD 01-phase7). | Один утренний экран: runway, вопросы, задачи, стоимость | Ф4 (данные `docs/lab/`) | **M** |
| 6 | Mobile | **FROZEN (owner 2026-07-24)** — GSL-104 (RC wrapper) + GSL-108 DONE; GSL-105/106/107 explicitly NOT owed as debt; unfreezes on owner call. | Пуш BLOCKER на телефон; ответ из кровати в буфер; break-glass | Ф3 (буфер как цель ответа) + Ф4 (hooks для ntfy) | **M** |
| 7 | Web control plane (interactive, all services) | **IN PROGRESS** — new phase since 2026-07-24 owner priority; delivered slices: `apps/core` Hono API on 127.0.0.1:7331 (GSL-260/280), `apps/web` Vite+React SPA (GSL-265), question loop (GSL-267/274/275), action endpoints (GSL-268/298), Fleet + observer + task submission (GSL-276/365/379-381). Full PRD: `docs/prd/01-phase7-interactive-control-plane.md`. | Web is the control panel, not the poster: live data + live actions | Ф4 + Ф5 (+ armed-check per C9) | **L** |
| 8 | Skills as a living product | **PARTIAL** — GSL-174 phased plan (`docs/prd/02-phase8-skills-management.md`); Phase 0 rescue + reverse-sync landed (GSL-251/334); active development pace throttled per owner (skills-publish deferred to phase 8 completion). | Editable skills with real ownership | — (+ owner decision on publish procedure) | **M** |

> **Readiness column contract** (added 2026-08-17, GSL-238 delta). Values:
> `DONE` / `ARMED` / `PARTIAL` / `NOT-ARMED` / `FROZEN` / `SUPERSEDED` /
> `IN PROGRESS` / `NOT-STARTED`. Every value carries a proof reference (Jira
> epic + PR, or an `armed-check` line). Updating this column is a mandatory
> part of every epic closure per `docs/process/prd-maintenance.md`. A `DONE`
> cell without proof is a PRD defect under constraint C9.

**Почему такой порядок (value + зависимости, а не шаблон).** Порядок — вертикальные, независимо
поставляемые срезы, отсортированные по «самой ранней ценности для владельца» и по зависимостям
данных.

1. **Ф1 первой — потому что это единственный сбой, который система не умеет чинить сама** и который
   прямо мешает «идти спать»: dead/compacted оркестратор осиротит живой флот (02 adoption item 1 —
   highest value; 04 gap-table «Auto-restart after orchestrator death»). Это тонкий сквозной срез:
   минимальный heartbeat-файл (producer) + внешний mechanical watchdog (consumer) → наблюдаемая
   ценность «флот пережил смерть оркестратора» end-to-end. Zero-token, вне LLM.
2. **Ф2 обогащает пульс, который Ф1 уже потребляет как heartbeat.** Self-pulse — это *генератор*
   heartbeat для watchdog'а (02 раздел 9-B: «necessary but not sufficient — it's the heartbeat
   generator for option A»). Пульс как правило уже существует (MEMORY: pulse rule); Ф2 формализует
   его экономику (cache-окна), ночной режим и авто-wait по квоте — то, без чего ночь либо дорога,
   либо тормозит.
3. **Ф3 — ядро автономии.** Даже с живым, пульсирующим оркестратором **вопрос ночью = стоп** (05
   раздел 2.3-4: «#1 autonomy gap: AskUserQuestion just blocks a pane»). Буфер + манифест + дайджест
   — это то, что реально даёт спать сквозь вопросы. Ставится после night mode, т.к. режим «ночь»
   переключает поведение буфера (что спросить vs забуферить).
4. **Ф4 механизирует фиксацию** того, что Ф3 уже производит как данные (`queue.jsonl`,
   `manifest.md`, дайджест). T1-hooks дают 0-token таймлайн; chronicler регенерирует дайджест/индексы.
   Урок tasty-lunch: рукотворный хаб гниёт → только скрипт-регенерация (05 раздел 1.4-1).
5. **Ф5 — чистый потребитель** данных `docs/lab/` из Ф4. Статический HTML, ничего не добавляет в
   данные, только показывает. Поэтому после Ф4.
6. **Ф6 — внешний слой досягаемости** поверх работающего ядра: пуш BLOCKER'ов (цель — буфер Ф3),
   ответ-в-буфер, break-glass. Последней — это удобство, когда цикл уже безопасен без неё.

Итог: safety (1) → self-scheduling (2) → autonomy/questions (3) → self-documentation (4) →
visibility (5) → remote reach (6). Ценность фронт-загружена: сеть безопасности первой.

---

## Общие Goals / Non-goals / Success criteria (для всей инициативы)

**Goals.**
- G1. Владелец может уснуть при живом флоте и с высокой уверенностью, что осиротевший флот
  восстановится сам под бюджетом рестартов, а неразрешимое — разбудит его пушем.
- G2. Ночь порождает **обозримый утренний артефакт** (дайджест + экран), а не 40 безымянных веток.
- G3. Вопросы-за-ночь для повторяющихся ситуаций трендуют к нулю (learning-loop → манифест).
- G4. Вся система работает на подписке, на официальных поверхностях, в пределах C1–C8.

**Non-goals (и почему исключены).**

| Не-цель | Почему исключено |
|---|---|
| Собственный mobile-client / daemon-transport (autosk-путь) | 01 раздел 6 показывает цену и дыры (TLS/push/relay); official Remote Control на подписке это закрывает — DIY неоправдан (05 раздел 7, «do NOT build») |
| Перевод движка на Agent SDK / API-ключ | C1/C2: subscription-only; SDK-путь запрещён ToS для подписки (03 раздел 2) |
| Live-chronicler-teammate, держащий слот панели | Съедает spawn-cap-3 и может застопорить доставку; chronicler — bounded `claude -p` job (05 раздел 3.5) |
| LLM-supervisor как непрерывный патруль над оркестратором | overstory строил AI-патруль (Tier 2) и warren его выкинул — не окупается (02 раздел 8-3); AI-триаж только on-anomaly, fail-safe (02 раздел 9-C) |
| Рукотворные status/wiki HTML-страницы | Гниют за месяц (tasty-lunch wiki, 05 раздел 1.4-1); только скрипт-регенерация |
| Parallel swarm + merge-queue (широкий fan-out) | STEELMAN economics: $60 vs $9 за то же (02 раздел 6); serial PR-gated + cap-3 |

**Success criteria (наблюдаемые, проверяются на реальной системе).**
- SC-A. При убийстве панели оркестратора ночью в течение ≤ ~10 минут (2 тика launchd при 5-мин
  интервале) запущен свежий оркестратор, **переприсоединённый к живым воркерам** (не пере-спавнивший
  их), и в лог/таймлайн добавлена запись рестарта. (Ф1)
- SC-B. При исчерпании бюджета рестартов (дефолт 3 за 60 мин, конфигурируемо) следующего рестарта НЕ происходит — владелец
  получает эскалацию (пуш/запись), флот не трэшится. (Ф1)
- SC-C. Оркестратор ни разу не завершает ход при живом флоте без вооружённого wake-up; интервалы
  соответствуют cache-окнам (не 300s). (Ф2)
- SC-D. Ночью вопрос типа ≤ DECISION не блокирует ни одной панели: он попадает в `queue.jsonl`,
  берётся дефолт/ставится дедлайн, воркер переназначается на разблокированную работу. (Ф3)
- SC-E. Утром существует `digest/YYYY-MM-DD-morning.md` с секциями «Waiting/Decided/Shipped/
  Incidents/Cost/Next», каждое авто-решение цитирует правило манифеста. (Ф3/Ф4)
- SC-F. Открыв один HTML-файл (или репо с телефона), владелец видит autonomy runway = min() по
  часам-исчерпания, окно вопросов с обратным отсчётом, статусы задач Jira/GH. (Ф5)
- SC-G. BLOCKER, поднятый в 01:00, доставлен пушем на телефон; ответ из Telegram/Remote Control
  попадает в буфер как `answered_by=owner`. (Ф6)

---

## Фаза 1 — Watchdog над оркестратором

**Цель.** Убрать единственный самонепоправимый сбой: механический (не-LLM) надзор, который замечает
смерть/зависание/исчерпание-контекста оркестратора и перезапускает его из durable-состояния под
бюджетом рестартов, эскалируя к владельцу при исчерпании бюджета.

**Scope.**

| In | Out (и почему) |
|---|---|
| Минимальный **heartbeat-файл** оркестратора (producer): первый акт каждого пульса — атомарно записать `{ts, context%, fleet summary}` в фиксированный путь | Полная политика пульса/каденции — это Ф2 (здесь только «пиши heartbeat первым делом») |
| **launchd LaunchAgent** (2–5 мин), dumb bash/bun скрипт: tmux-сессия жива? heartbeat свежий? context% < потолка? | Cron как основной механизм — launchd переживает reboot/wake-from-sleep на macOS (02 раздел 9-A) |
| **Re-wake из STATE+handoff** как точка рестарта (существующий cold-start протокол — переиспользуется, не переписывается) | Изменение cold-start логики скилла — она уже есть и корректна |
| **Restart budget** (напр. 3-in-60-min, exponential backoff) + эскалация к владельцу при исчерпании | Push-инфраструктура телефона — это Ф6; здесь эскалация = запись + локальный notify, интерфейс к пушу оставлен точкой расширения |
| Уроки Gastown/warren: startup grace, zombie debounce (3 цикла), kill cooldown, backoff, mass-death detection, single-flight | AI-триаж (Tier-1 `claude -p`) — опциональное расширение, добавляется on-anomaly позже (02 раздел 9-C) |
| **Route-through-reap на kill**: при убийстве зависшего воркера/оркестратора собрать закоммиченную работу (ветка, запись в ledger) | — |

**Success criteria фазы (наблюдаемые).**
- F1-S1. `kill-pane` панели оркестратора → ≤ ~10 мин (2 тика при 5-мин launchd) появляется свежая
  панель оркестратора, переприсоединённая к живым воркерам; в STATE/таймлайн — запись рестарта. (= SC-A)
- F1-S2. Свежезапущенный оркестратор, ещё не написавший heartbeat, **не убивается** watchdog'ом
  (startup grace работает; дефолт warm-up ~90–120 с до первого heartbeat). (урок Gastown #567)
- F1-S3. «tmux-сессия есть, процесс агента мёртв» распознаётся как zombie только после **3
  последовательных** циклов, не с первого (debounce). (Gastown `mayorZombieCount >= 3`)
- F1-S4. После исчерпания бюджета рестартов (дефолт 3 за 60 мин) следующего рестарта нет — владелец
  эскалирован. (= SC-B)

**Требования.**

- **R1.1 — Heartbeat protocol (producer).** *Current:* пульс существует как правило (MEMORY), но
  пишет в контекст/чат, не в фиксированный machine-файл. *Target:* каждый пульс оркестратора
  ПЕРВЫМ действием атомарно (temp+rename) дописывает строку heartbeat в
  `docs/handoff/.orchestrator-heartbeat` (или в `docs/lab/` при наличии Ф4): `{ts, context_pct,
  open_workers, cycle}`. *Acceptance:* `stat` mtime файла обновляется каждый пульс; `tail -1`
  парсится watchdog-скриптом; при падении оркестратора mtime перестаёт расти — наблюдаемо. (C7, C8)
- **R1.2 — Mechanical watchdog (consumer).** *Current:* ничего не сидит над оркестратором; dead
  оркестратор = осиротевший флот до утра. *Target:* launchd LaunchAgent запускает не-LLM скрипт
  каждые 2–5 мин: проверяет (1) tmux-сессия оркестратора существует; (2) возраст heartbeat < порога;
  (3) context% из heartbeat < потолка. Dead → re-wake через cold-start (re-attach к воркерам, не
  respawn). Stale → один `send-keys` nudge; всё ещё stale → kill (по явному id) + re-wake. Context ≥
  потолка → `send-keys` «write handoff now» → свежий оркестратор из handoff. *Acceptance:* F1-S1;
  скрипт содержит 0 обращений к LLM (grep); работает при выключенном интернете кроме re-wake. (C1,
  C7)
- **R1.3 — Restart budget + эскалация.** *Current:* нет. *Target:* watchdog ведёт счётчик рестартов
  в окне (дефолт 3 за 60 мин, конфигурируемо; для ночного окна владелец может задать 3/ночь) с
  exponential backoff (base 1s, cap 16s — warren `RestartBudget`);
  исчерпан → прекратить рестарты, эскалировать (локальный notify + запись; интерфейс к Ф6-пушу).
  «Never mask an orchestrator bug with a restart loop» (warren `supervisor/main.ts:12-14`).
  *Acceptance:* F1-S4; счётчик персистентен (переживает рестарт watchdog'а).
- **R1.4 — Debounce/cooldown/grace (Gastown-уроки, ОБЯЗАТЕЛЬНЫ).** *Current:* n/a. *Target:* вшить
  в watchdog: (a) **startup grace** — свежая сессия освобождена от heartbeat-проверки на warm-up
  окно (дефолт ~90–120 с; Gastown #567); (b) **zombie debounce** — «pane-alive ≠ process-alive» помечается zombie
  только после 3 последовательных циклов; (c) **kill cooldown** — ≥ 5 мин между force-kill; (d)
  **mass-death detection** — много смертей разом = системный сбой ≠ одиночная смерть → не рестартить
  вслепую, эскалировать; (e) watchdog **single-flight** (flock/marker) + rate-limited. *Acceptance:*
  F1-S2, F1-S3; каждый порог конфиг-оверрайдабелен; невалидный конфиг падает **громко на старте**, не
  мис-арминг тихо (warren watchdog invariant).
- **R1.5 — Route-through-reap.** *Current:* kill теряет незакоммиченную работу. *Target:* при
  убийстве зависшего компонента сначала собрать закоммиченное (ветка), записать `worker_died`/
  `orchestrator_restarted` в ledger — «нет молча пропавшей работы» (warren reap; overstory
  `worker_died` mail). *Acceptance:* после kill+reap запись о смерти присутствует в
  STATE/таймлайне; закоммиченная ветка не потеряна.

**Задачи (commit-sized; Epic: `[Repo][Skill] Фаза 1 — Watchdog над оркестратором`).**
1. `[Skill] Heartbeat protocol в orchestrating-delivery-agents` — добавить в SKILL.md шаг «первый акт
   пульса = атомарная запись heartbeat» + формат строки.
2. `[Tooling] launchd LaunchAgent plist + watchdog.sh (скелет)` — tmux-проверка, heartbeat-age,
   context-потолок; 0 LLM; логирование в `docs/lab/` (или handoff).
3. `[Tooling] Restart budget + exponential backoff` — персистентный счётчик, окно, эскалация-хук.
4. `[Tooling] Gastown-debounce: startup grace + zombie(3) + kill cooldown + mass-death + single-flight`.
5. `[Tooling] Route-through-reap на kill` + запись `orchestrator_restarted`/`worker_died` в ledger.
6. `[Skill] Cold-start как точка re-wake` — уточнить в SKILL.md, что watchdog вызывает существующий
   cold-start (re-attach, не respawn); идемпотентность re-wake (никакого double-dispatch).
7. `[Docs] Runbook установки watchdog` (`launchctl load`, проверка, деинсталляция) + dev_history.

**Оценка усилия:** **M** (bash/launchd + правки скилла; логика проста, но уроки-debounce делают её
не-тривиальной — «one-shot STATE-stale→restart сработает на ложняке в первую же ночь», 04 раздел 7.1).

**Зависимости:** существующий cold-start/STATE (есть). Даёт heartbeat-файл, который потребляет Ф2/Ф4.

**Риски.** (R) Ложное срабатывание убьёт здоровый флот → mitigated R1.4 (все debounce/cooldown/grace).
(R) macOS sleep ставит на паузу и watchdog, и флот → задокументировать (держать машину awake или
принять, что sleep = пауза всего; 02 раздел 9-A). (R) Re-wake не идемпотентен → double-dispatch →
mitigated R1.6 (cold-start reconcile-then-dispatch, никогда «spawn fresh to be safe»).

**Критерии приёмки фазы + end-check.**
- Gates: `./install.sh` проходит после правок `skill/`; `bash -n watchdog.sh`; skill-текст непротиворечив.
- **End-check (user-visible):** владелец ночью выполняет `tmux kill-pane` панели оркестратора при 2
  живых воркерах; в течение окна watchdog поднимается свежий оркестратор, `ORCHESTRATION-STATE.md`
  получает `CORRECTION`/restart-запись, оба воркера продолжают (не пере-спавнены, не задублированы),
  а после 3-го форсированного рестарта появляется эскалация вместо 4-го рестарта.

---

## Фаза 2 — Self-pulse + night mode оркестратора

**Цель.** Формализовать пульс как дешёвый triage-tick с каденцией по cache-окнам, ввести явный ночной
режим (activeHours, поведение при лимитах/резетах квоты) и расширить анти-runaway существующий
loop-guard до circuit-breaker.

**Scope.**

| In | Out (и почему) |
|---|---|
| Политика каденции: ScheduleWakeup ~270s (cache-warm) при активном разбирательстве столла; 20–30 мин при «воркеры молотят»; **никогда 300s** | Собственный cron-демон Claude Code (feature request #28229) — не наш к постройке |
| Night mode: `activeHours`, тихие часы, поведение буфера-вопросов в режиме «ночь» (флаг для Ф3) | Полный question-buffer — это Ф3 (здесь только флаг режима) |
| Quota-window auto-wait: `StopFailure(rate_limit/overloaded)` → quiesce флота, авто-resume при резете окна, показать ETA резета | Billing-логика по $ programmatic pool — телеметрия, не enforcement (Ф4/Ф5 показывают) |
| Анти-runaway: расширить loop-guard сигналами ralph (same-error×N, output-decline) + cooldown/HALF_OPEN probe; счётчики в STATE, human-resettable | Замена всего loop-guard — существующий сохраняется, дополняется |

**Success criteria фазы.**
- F2-S1. Оркестратор ни разу не завершает ход при `open_workers>0` без вооружённого wake-up (= SC-C).
- F2-S2. Интервалы соответствуют cache-окнам: активный стол → < 5 мин; ожидание → ≥ 20 мин; нет 300s.
- F2-S3. При исчерпании квоты флот тихо ждёт и авто-возобновляется при резете окна (ralph auto-wait),
  а не умирает и не паркуется молча.
- F2-S4. Circuit-breaker: 2 цикла без прогресса ИЛИ N с той же ошибкой → STOP+ask (не бесконечный
  спин); после cooldown — один HALF_OPEN probe, не хард-стоп навсегда.

**Требования.**

- **R2.1 — Cache-aware pulse cadence.** *Current:* правило «пульс каждые 5–10 мин» без механизма и
  без экономики cache-TTL. *Target:* оркестратор всегда завершает ход с `ScheduleWakeup`; delay
  выбирается по правилу cache-окна (04 раздел 3.5): < 5 мин когда активно разбирает стол (cache
  тёплый), 20–30 мин когда воркеры молотят (одна cache-miss, амортизирована), никогда ~300s
  («worst-of-both»). Пульс = дешёвый triage: прочесть STATE+heartbeat, действовать только на дельты
  (OpenClaw-heartbeat: крошечный стабильный чеклист, «HEARTBEAT_OK → ничего»). *Acceptance:* F2-S1,
  F2-S2; в SKILL.md — таблица каденции; каждый ход при живом флоте оставляет armed wake-up
  (наблюдаемо в логе).
- **R2.2 — Night mode / activeHours.** *Current:* нет режима «ночь». *Target:* объявленное
  unattended-окно (напр. 00:00–08:30 из манифеста Ф3): в нём AskUserQuestion запрещён кроме denylist;
  всякий не-denylist вопрос уходит в буфер (Ф3); ослабление интерактивности, но ужесточение рельсов.
  Флаг режима читается буфером Ф3. *Acceptance:* при `mode=night` попытка не-denylist AskUserQuestion
  заменяется записью в буфер; denylist по-прежнему будит (Ф6). (05 раздел 4.1 инверсия)
- **R2.3 — Quota-window auto-wait.** *Current:* при исчерпании лимитов run умирает/паркуется, ничего
  не возобновляется (01 раздел 8-2 — «5-hour window parks the whole fleet»). *Target:* детекция
  `StopFailure(rate_limit|overloaded|server_error)` → quiesce флота, запись ETA резета, авто-resume
  при открытии окна (ralph unattended auto-wait, 4-layer detection). *Acceptance:* F2-S3;
  smoke-тест — искусственный rate_limit-сигнал ставит статус `quota-wait` с ETA, при снятии —
  resume. (C2 interactive quota — основной; C3 не для bulk)
- **R2.4 — Circuit-breaker поверх loop-guard.** *Current:* loop-guard = 2 сигнала (non-advancing
  NEXT, no-new-PR), хард-STOP без probe. *Target:* добавить ralph-сигналы: same-error×N по циклам,
  output/progress decline; cooldown + один HALF_OPEN probe вместо вечного стопа; счётчики
  персистентны в STATE и human-resettable (autosk phone-editable). *Acceptance:* F2-S4; счётчики
  видимы и сбрасываемы правкой STATE; транзиентный флейк не запирает цепь навсегда.

**Задачи (Epic: `[Skill] Фаза 2 — Self-pulse + night mode`).**
1. `[Skill] Таблица каденции пульса (cache-окна) + правило armed-wake-up` в SKILL.md.
2. `[Skill] Night mode / activeHours — определение режима и переключение поведения вопросов`.
3. `[Skill][Tooling] Quota auto-wait: детекция StopFailure + quiesce/resume + ETA`.
4. `[Skill] Circuit-breaker: same-error/output-decline + cooldown/HALF_OPEN + human-resettable счётчики`.
5. `[Docs] dev_history + пример пульс-тика (HEARTBEAT_OK fast-path)`.

**Оценка усилия:** **M** (в основном скилл-текст + тонкий tooling для quota-детекции; инструменты
ScheduleWakeup/Monitor уже существуют — 04 раздел 6 item 1: «LOW effort»).

**Зависимости:** Ф1 (heartbeat-файл, который пульс пишет и watchdog читает). Является генератором
heartbeat для Ф1 — поэтому минимальный heartbeat вынесен в Ф1, а богатая каденция сюда.

**Риски.** (R) Пуллинг «на всякий случай» каждые N мин жжёт токены (OpenClaw burnout) → правило
cache-окна + «nothing-to-do → cheap exit». (R) Wake-up перезапускает дорогую работу (#54086) → пульс
= дешёвый triage, не тяжёлый ход. (R) macOS sleep рвёт ScheduleWakeup → Ф1 watchdog ловит staleness.

**Критерии приёмки фазы + end-check.**
- Gates: `./install.sh`; skill непротиворечив; smoke quota-сигнал.
- **End-check:** прогон «ночь»: оркестратор входит в `mode=night`, за час делает ≥ 1 дешёвый
  HEARTBEAT_OK-тик без спавна, при инъекции rate_limit переходит в `quota-wait` c ETA и
  авто-resume'ится; ни один ход не завершается без armed wake-up (проверяемо по логу пульсов).

---

## Фаза 3 — Question buffer + decision manifest + morning digest

**Цель.** Закрыть #1 дыру автономии: вопрос ночью больше не блокирует панель. Типизированный буфер +
owner-sovereign манифест решений + learning-loop + утренний дайджест.

**Scope.**

| In | Out (и почему) |
|---|---|
| Типология из 4 типов (BLOCKER / DECISION / CLARIFY / FYI) и 4 поведения | Синхронный AskUserQuestion как первичный интерфейс — инвертируется в один из каналов |
| `docs/lab/questions/queue.jsonl` (append-only, patch-записи, dedup по task+question-hash) | Полный event-stream — это Ф4 (буфер — частный случай, но файл живёт уже здесь) |
| `docs/lab/decisions/manifest.md` — единственный рукотворный файл; ярусы автономии, зеркалящие denylist | Изменение самой denylist-политики — манифест даёт ей дом, не новую политику |
| Learning loop: `decisions/log.jsonl` → manifest candidates в дайджесте | Авто-правка манифеста агентом — запрещена (только owner) |
| Morning digest `digest/YYYY-MM-DD-morning.md` (Waiting/Decided/Shipped/Incidents/Cost/Candidates/Next) | Авто-генерация дайджеста chronicler'ом — механизируется в Ф4; здесь дайджест пишет оркестратор |

**Success criteria фазы.**
- F3-S1. Ночью вопрос ≤ DECISION не блокирует ни одной панели: запись в `queue.jsonl`, дефолт/дедлайн,
  воркер переназначен на разблокированное (= SC-D). Park-per-task, не park-the-fleet.
- F3-S2. DECISION с `auto_apply_at`: при недостижении дедлайна применяется дефолт, пишется
  `decision.made`, дайджест это отражает.
- F3-S3. Каждое авто-решение цитирует правило манифеста (provenance). (= часть SC-E)
- F3-S4. Дубликат вопроса от 5 воркеров = ОДИН пункт в дайджесте (dedup, `seen_by`).

**Требования.**

- **R3.1 — Типология и поведения.** *Current:* всё — синхронный AskUserQuestion / `BLOCKED_ON_HUMAN`,
  умирает с сессией. *Target:* 4 типа (05 раздел 4.1): **BLOCKER** (нет безопасного дефолта:
  креды, denylist, необратимое) → park только затронутый item, reroute воркеров, пуш сразу (Ф6);
  **DECISION** (реальная развилка с защитимым дефолтом) → запись + `auto_apply_at` дедлайн, работать
  дальше, по дедлайну применить дефолт; **CLARIFY** (очевидное прочтение) → взять дефолт сразу,
  записать answered-by-default; **FYI** → только запись. *Acceptance:* F3-S1; запись типа корректно
  меняет поведение панели.
- **R3.2 — Queue-файл.** *Current:* нет дома у вопросов. *Target:* `queue.jsonl` append-only, поля из
  05 раздел 4.2 (`id, ts, type, from, task, links, question, options[pros/cons], default,
  default_rationale, reversibility, impact_if_wrong, auto_apply_at, status`); статус-смена = patch
  `{re:<id>}`; dedup перед постановкой: grep open-записей по `(task, question-hash)`. *Acceptance:*
  F3-S4; append-only (никогда не переписывается; коррекция = новая запись `supersedes`). (C8)
- **R3.3 — Decision manifest.** *Current:* политика разбросана по «Standing rules» STATE, MEMORY,
  чат-директивам. *Target:* `manifest.md` — **owner-sovereign** (единственный рукотворный файл в
  `docs/lab/`); агенты его ЧИТАЮТ каждый цикл, ПРЕДЛАГАЮТ правки как diff в дайджесте, НИКОГДА не
  правят молча. Секции (05 раздел 4.3): (1) always-autonomous; (2) decide-by-default + дефолтные
  дедлайны (ночь → 10:00, день → +2h); (3) always-ask = denylist verbatim из orchestrating skill;
  (4) escalation & channels + тихие часы; (5) budget & runway; (6) standing prefs. *Acceptance:*
  F3-S3; секции 1/3 зеркалят существующую authority/denylist скилла (не изобретают политику). (C8)
- **R3.4 — Learning loop.** *Current:* нет. *Target:* каждый ответ (live или queued) → запись в
  `decisions/log.jsonl` с полным контекстом; периодически chronicler майнит: одинаковая форма-вопрос
  отвечена одинаково ≥ 2–3 раза → **manifest candidate** в дайджесте («выбрал X 3 раза — повысить в
  раздел 2?»); owner подтверждает правкой манифеста. KPI = questions-per-night → 0 для повторяющихся форм.
  *Acceptance:* при 3 одинаковых ответах в логе — кандидат появляется в следующем дайджесте.
- **R3.5 — Morning digest.** *Current:* At-a-glance в STATE перезаписывается, без истории и ссылок.
  *Target:* `digest/YYYY-MM-DD-morning.md`, секции в порядке приоритета владельца (05 раздел 4.5):
  (1) Waiting for you (BLOCKER'ы, потом DECISION'ы с дедлайнами); (2) Decided for you (каждое
  авто-решение + цитата правила); (3) What shipped (задачи/PR/коммиты со ссылками); (4) Incidents
  (что сломалось/восстановилось, RCA-ссылки); (5) Cost & runway; (6) Manifest candidates; (7) Next.
  *Acceptance:* F3-S2, SC-E; дайджест существует после ночи с активностью, каждая ссылка ведёт в
  артефакт.
- **R3.6 — Интеграция с PULSE/STATE (минимальные дельты).** *Target* (05 раздел 4.6): пульс на каждом
  тике сканирует `queue.jsonl` — (a) новоотвеченные → действовать; (b) DECISION за `auto_apply_at` →
  применить дефолт + `decision.made`; (c) BLOCKER, простоявший слишком долго → re-push по манифесту.
  `BLOCKED_ON_HUMAN` становится «queue + reroute», не «stop». LIVE-STATUS получает поле `questions:
  open=N (B/D/C/F)`. Брифы воркеров получают строку: «ownable-вопрос → `lab-emit question` с типом +
  дефолтом + reversibility и ПРОДОЛЖАЙ на дефолте если тип ≤ DECISION; не блокируй панель на человеке».
  *Acceptance:* F3-S1; handoff'ы ссылаются на open-question ids (замещающий оркестратор наследует
  очередь с диска).

**Задачи (Epic: `[Skill][Repo] Фаза 3 — Question buffer + manifest + digest`).**
1. `[Skill] Типология 4 типов + поведения (park-per-task, defaults, deadlines)` в SKILL.md +
   worker-template.
2. `[Tooling] lab-emit / queue.jsonl схема + dedup helper` (append-only, patch-записи).
3. `[Docs][Repo] decisions/manifest.md — шаблон owner-sovereign с 6 секциями` (seed из существующих
   Standing rules + denylist).
4. `[Tooling] decisions/log.jsonl + learning-loop scan (manifest candidates)`.
5. `[Skill] Morning digest — шаблон + секции + provenance-цитаты`.
6. `[Skill] PULSE-дельты: scan queue, apply-at-deadline, reroute; LIVE-STATUS questions-поле;
   BLOCKED_ON_HUMAN → queue+reroute`.
7. `[Docs] dev_history`.

**Оценка усилия:** **M** (протокол + helper-скрипты + правки скилла/шаблонов; 05 раздел 7 items 2–3:
HIGH/LOW/LOW — но пять под-частей суммируются в M).

**Зависимости:** Ф2 (night mode как триггер: что буферить vs спросить). Даёт данные (`queue.jsonl`,
`manifest.md`, `decisions/log.jsonl`, дайджест), которые Ф4 механизирует и Ф5 показывает, Ф6 пушит.

**Риски.** (R) Park слишком рьяно (одно неоднозначное правило стопит фичу) → вариант buffer-and-default
для low-stakes (CLARIFY). (R) Дефолт необратим → буферизация только при reversible; необратимое =
BLOCKER. (R) Question spam → dedup по `(task, question-hash)`, `seen_by`-список.

**Критерии приёмки фазы + end-check.**
- Gates: `./install.sh`; JSONL-схема валидна; манифест парсится.
- **End-check:** прогон «ночь с развилкой»: воркер натыкается на DECISION (стратегия merge при
  конфликте) → в `queue.jsonl` появляется запись с `default` и `auto_apply_at`, панель НЕ
  блокируется, воркер переназначен; по дедлайну дефолт применён и залогирован; утром
  `digest-...-morning.md` показывает это в «Decided for you» с цитатой правила манифеста; тот же
  вопрос от второго воркера дедуплицирован.

---

## Фаза 4 — Laboratory (авто-документация)

**Цель.** Ночь фиксируется сама. Три яруса убывающего детерминизма: T1 события (hooks, 0 токенов) →
T2 нарратив (существующие конвенции, без изменений) → T3 синтез (chronicler регенерирует дашборд/
дайджест/индексы). Правило: **только скрипт-регенерация** — рукотворный хаб гниёт.

**Scope.**

| In | Out (и почему) |
|---|---|
| **T1:** Claude Code hooks → `docs/lab/events/YYYY-MM-DD.jsonl`, envelope `{ts,run_id,seq,actor,type,data}`; async command handlers, 0 токенов | Изменение T2-конвенций (handoff/dev_history/reviews) — они уже работают, не трогаем |
| **T2:** существующие конвенции без изменений (+ одна строка `lab-emit handoff.written`) | — |
| **T3:** chronicler = bounded `claude -p` регенератор static-HTML + дайджеста + индексов; НЕ pane-teammate | Live-chronicler-teammate — запрещён (съест slot, застопорит доставку) |
| `docs/lab/` layout; atomic writes; append-only jsonl; poll-fill (reconcile gh/jira/git) | Server/SSE-дашборд (Next.js) — это v2, вне этой фазы |
| Chronicler показывает СВОЮ несвежесть (generated-at + max event age) | — |

**Success criteria фазы.**
- F4-S1. Спавн/терминация воркера, коммит, Jira-переход, компакция появляются в `events/*.jsonl`
  **без кооперации модели** (hooks). (C7)
- F4-S2. Chronicler регенерирует `status.json` + `site/` + Library-индекс + дайджест по триггеру
  (граница цикла / debounced hook / on-demand) под `--max-budget-usd`; НЕ держит панель.
- F4-S3. Если chronicler упал/устарел — данные просто устаревают, доставка не стопорится, а страница
  показывает свою несвежесть.
- F4-S4. `--allowedTools` chronicler'а строгий; grep подтверждает отсутствие API-ключей (C1).

**Требования.**

- **R4.1 — T1 event layer (hooks → JSONL).** *Current:* всё — Markdown-проза + один `runs.json`; нет
  `events.jsonl`, нет schema (05 раздел 2.3-1). *Target:* набор Claude Code hooks (`.claude/
  settings.json`, committable, `async:true`) → `lab-log.sh` нормализует stdin-JSON в envelope и
  дописывает одну строку в дневной jsonl. Карта (05 раздел 3.2): `SubagentStart/Stop`→agent.*;
  `TeammateIdle`→agent.idle; `SessionStart/End`→pane; `PostToolUse` matcher `Bash(git commit *)`→
  vcs.commit, `mcp__atlassian__.*`→tracker.*; `StopFailure(rate_limit|overloaded|server_error)`→
  quota (питает Ф2!); `TaskCreated/Completed`→task.*; `PreCompact/PostCompact`→context health;
  `Notification/PermissionRequest`→questions/permissions. *Acceptance:* F4-S1; каждый hook несёт
  `session_id/agent_id/agent_type/cwd` → атрибуция по воркеру без модели.
- **R4.2 — Explicit emits + poll-fill.** *Current:* n/a. *Target:* оркестратор/воркеры дописывают
  семантические события, что hooks не выводят (`cycle.started`, `question.posed`, `decision.made`,
  `verify.verdict`) через `lab-emit`; chronicler (T3) сверяет `gh pr list`/Jira JQL/`git log` и
  дописывает пропущенные локально события (PR смёржен из web) — reconcile-don't-trust (autosk
  watcher). *Acceptance:* PR, смёрженный вне CLI, появляется в таймлайне после chronicler-прохода.
- **R4.3 — On-disk layout + дисциплина.** *Target:* layout из 05 раздел 3.3 (`events/`, `status.json`,
  `questions/`, `decisions/`, `digest/`, `site/`, `scratch/` gitignored). Правила:
  > **Removed 2026-08-17 (GSL-238 delta):** `telemetry.jsonl` used to appear in
  > this layout line, but never existed on disk and no writer was ever wired
  > (finding independently confirmed by GSL-164 audit run). The Cost view builds
  > telemetry from `ORCHESTRATION-STATE.md`; if a dedicated `telemetry.jsonl`
  > becomes needed, file a task that ships the writer alongside the layout
  > entry (constraint C9). 
  atomic temp+rename для не-append; append-only jsonl (коррекция = `supersedes:<seq>`); STATE остаётся
  авторитетом, `status.json` производный, при конфликте STATE+git побеждают (C8). *Acceptance:*
  `scratch/` в .gitignore; не-append файлы пишутся атомарно (проверка: нет torn-write при kill
  посередине).
- **R4.4 — T3 chronicler (bounded `claude -p`).** *Current:* `docs/report/` имеет generators без
  триггеров и без T1-данных (05 раздел 3.1). *Target:* chronicler — **НЕ четвёртый live-агент**, а
  bounded schedulable job: build-скрипты + `claude -p --max-budget-usd --allowedTools ...` регенерируют
  `status.json`, `site/`, Library-индекс, дайджест. Триггеры: граница цикла / debounced `PostToolUse`
  на записи в `docs/lab/` / on-demand. Крах chronicler'а НЕ стопорит доставку — данные устаревают,
  страница это показывает. *Acceptance:* F4-S2, F4-S3, F4-S4; chronicler не занимает панель (grep — не
  teammate); каждая страница несёт generated-at + max-event-age. (C3, C6-cheap)

**Задачи (Epic: `[Repo][Tooling] Фаза 4 — Laboratory (auto-doc)`).**
1. `[Tooling] .claude/settings.json hooks + lab-log.sh (envelope нормализация, дневной jsonl)`.
2. `[Tooling] lab-emit helper (explicit semantic events)`.
3. `[Repo] docs/lab/ layout + .gitignore scratch + atomic-write/append-only дисциплина`.
4. `[Tooling] chronicler: build-скрипты (status.json, Library index) + claude -p glue (budget,
   allowedTools)`.
5. `[Tooling] poll-fill reconcile (gh/jira/git → пропущенные события)`.
6. `[Skill] один `lab-emit handoff.written` в handoff-конвенцию (T2 без прочих изменений)`.
7. `[Docs] dev_history + generated-at/staleness контракт`.

**Оценка усилия:** **L** (три яруса, hooks-матрица, chronicler-glue, poll-fill, layout — самый большой
объём; 05 раздел 7 item 1 HIGH/LOW/LOW для T1, но полный ярус T3+poll-fill поднимает до L).

**Зависимости:** Ф3 (queue/manifest/decisions/digest — данные, которые chronicler индексирует и
дайджест-генерит). `StopFailure`-hook питает Ф2 quota-детекцию. Даёт данные Ф5 (дашборд) и Ф6 (ntfy).

**Риски.** (R) Hooks не срабатывают как задокументировано на ЭТОЙ машине (TeammateIdle не тестирован —
05 COVERAGE) → верифицировать на build-time; деградировать с логом, не молча. (R) Chronicler жжёт
programmatic credit → строгий `--max-budget-usd`, телеметрия бёрна. (R) Дашборд-регенерация гниёт как
tasty-lunch wiki → инвариант «никто не правит руками» + staleness-метка.

**Критерии приёмки фазы + end-check.**
- Gates: `./install.sh`; hooks валидны (`settings.json` парсится); jsonl валиден.
- **End-check:** прогон цикла доставки: спавн воркера, коммит, Jira-переход и (если случится)
  компакция появляются строками в `events/YYYY-MM-DD.jsonl` без правок модели; chronicler по границе
  цикла регенерирует `status.json` + `site/index.html` + дайджест под бюджетом; убийство chronicler'а
  посередине не роняет доставку, а следующая страница показывает увеличенный max-event-age.

---

## Phase 5 — UI orchestration (static HTML v1) — SUPERSEDED

> **Superseded on 2026-08-03 by owner decision `d-2026-08-03-004` (Warren-model,
> SQLite = source of truth) and formally replaced by Phase 7 "Interactive control
> plane".** The static HTML dashboard delivered by Phase 5 (chronicler-generated
> `docs/lab/site/*.html` + 7 screens) is kept as historical context and remains
> in git as an archive. All new UI work belongs to Phase 7 and epic
> [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250). The interactive
> requirements (runway with a binding constraint, live question window with
> countdowns, per-agent fleet, real-time updates, manifest-rule provenance, first
> working "Publish skill" button) migrate into Phase 7 R7.\*. Do NOT plan new work
> against the Phase 5 tasks below.
>
> **Phase 7 is maintained as a separate per-phase PRD file (owner language rule,
> 2026-08-07):** [`docs/prd/01-phase7-interactive-control-plane.md`](./01-phase7-interactive-control-plane.md).
> The Russian Phase 7 section previously appended to this monolith (commit `4197157`,
> GSL-273) has been extracted to that file and rewritten in English on 2026-08-07.

**Цель.** Один утренний экран: статический HTML, регенерируемый из `docs/lab/`, никогда не правится
руками. Autonomy runway, окно вопросов, статусы Jira/GH — «можно ли идти спать» с доказательствами.

**Scope.**

| In | Out (и почему) |
|---|---|
| Static HTML v1, регенерируется chronicler'ом (Ф4), работает из `file://` и с GitHub (телефон) | Server/SSE (Next.js), replay-then-tail live-streaming, state-aware composer — это v2 (05 раздел 7 item 12) |
| 7 экранов: Overview(morning) / Timeline / Tasks / Questions / Fleet / Cost / Library | Live-steering — не задача дашборда (это Remote Control/терминал, Ф6) |
| **Autonomy runway = min()** по часам-исчерпания (ctx, budget, quota-window, slots, blockers, work-remaining) | — |
| Окно вопросов с обратным отсчётом дедлайнов; статусы Jira/GH; incident-маркеры | Full-text по телам артефактов — v2 |
| Laboratory self-health (freshness-метры: generated-at, dev_history coverage, handoff age) | — |

**Success criteria фазы.**
- F5-S1. Открыв один HTML-файл, владелец видит runway = min() с подсвеченным связывающим ограничением
  и ETA (= SC-F).
- F5-S2. Экран Questions показывает open-записи по типам с обратным отсчётом `auto-applies in Xh Ym`.
- F5-S3. Экран Tasks — строки, keyed по Jira, со ссылками Jira/GH/commit/dev_history.
- F5-S4. Дашборд читается с телефона через приватный GitHub-репо без доп. инфраструктуры.

**Требования.**

- **R5.1 — Autonomy runway indicator.** *Current:* нет единого «сколько ещё протянет без меня». *Target:*
  композитный заголовок = **min()** по независимым часам-исчерпания (05 раздел 5.1), каждый со своим
  gauge+ETA, связывающее ограничение подсвечено: orchestrator context% (cross-check против
  8–15-cycle roll — «не верь числу в одиночку»), token/cost ceiling vs манифест, quota-window (из
  `StopFailure`-событий + ETA резета), fleet slots (2/3), open BLOCKER'ы, work-remaining (To Do).
  Рендер: `RUNWAY ≈ 4h (binding: quota resets 03:00) | ctx 42% | budget 45% | slots 2/3 | blockers 0`.
  *Acceptance:* F5-S1; отвечает на «можно ли спать» доказательствами, не вайбами.
- **R5.2 — 7 экранов / одна навигация.** *Target:* Overview (дайджест + runway-strip + сводка
  вопросов, landing); Timeline (feed newest-first, фильтры actor/type/severity, incident-маркеры);
  Tasks (доска keyed по Jira + epic→PR rollup, все id — ссылки); Questions (open по типам + обратный
  отсчёт DECISION'ов + answered-tonight); Fleet (карточки: state/model/pane/spawned/last-event-age/
  tokens/task); Cost (телеметрия: per-cycle, cumulative vs ceiling, per-model, quota-события);
  Library (кросс-индекс handoffs/dev_history/reviews/reports/research/RCA со ссылками). *Acceptance:*
  F5-S2, F5-S3; каждый экран регенерируется из `docs/lab/`, никогда не правится руками (C8).
- **R5.3 — Committable / phone-readable / self-graded.** *Target:* HTML committable → читается с
  телефона через приватный (уже аутентифицированный) GitHub-репо, ноль доп. инфры; клиентский JS-фильтр
  по встроенному JSON (датасет крошечный); **Laboratory self-health** метры (generated-at, dev_history
  coverage, handoff age vs последняя граница) — анти-wiki-rot алярм. *Acceptance:* F5-S4; страница
  показывает свою свежесть; открытие из `file://` и из GitHub даёт идентичный вид.

**Задачи (Epic: `[Repo][Tooling] Фаза 5 — UI оркестрации (static v1)`).**
1. `[Tooling] build-site.* : рендер 7 экранов из docs/lab/ (переиспользовать docs/report/build-*
   паттерн)`.
2. `[Tooling] Autonomy runway = min() виджет (6 часов-исчерпания + binding highlight + ETA)`.
3. `[Tooling] Questions-экран с обратным отсчётом дедлайнов`.
4. `[Tooling] Tasks/Fleet/Cost/Timeline/Library экраны + клиентский JS-фильтр`.
5. `[Tooling] Laboratory self-health метры (freshness/coverage)`.
6. `[Docs] dev_history + скриншот-проверка light/dark, реалистичная ширина`.

**Оценка усилия:** **M** (чистый рендер из готовых данных Ф4; 05 раздел 7 item 6 MED-HIGH/MED/LOW;
можно отложить Fleet/Cost если поджимает).

**Зависимости:** Ф4 (данные `docs/lab/`: events, status.json, queue, telemetry). Чистый потребитель.

**Риски.** (R) Рукотворная правка → rot → инвариант «регенерируется, не редактируется» + self-health
алярм. (R) Runway-число врёт (fabricated 80% vs real 63% — tasty-lunch урок) → cross-check context%
против roll-эвристики, показывать доказательства не только число.

**Критерии приёмки фазы + end-check.**
- Gates: `./install.sh`; сайт билдится; HTML валиден; вид в light/dark на реалистичной ширине.
- **End-check:** после ночи chronicler регенерирует `site/`; владелец открывает `site/index.html`
  локально И тот же файл через GitHub с телефона — видит идентичный Overview с runway = min()
  (связывающее ограничение подсвечено, ETA), Questions с живым обратным отсчётом дедлайна, Tasks со
  ссылками, ведущими в Jira/GH/commit; ни одна страница не редактировалась руками (git blame →
  только build-скрипт).

---

## Фаза 6 — Mobile

**Цель.** Досягаемость с телефона на официальных поверхностях: пуш BLOCKER'ов, ответ-в-буфер,
break-glass. **Не строить DIY-transport** — official Remote Control на подписке это закрывает.

**Scope.**

| In | Out (и почему) |
|---|---|
| **Official Remote Control** на сессии оркестратора (subscription-only, push, TLS, presence-file); research-preview → тонкий скилл-обёртка | Собственный Tauri/native client + daemon-transport (autosk-путь) — 01 раздел 6: цена+дыры, неоправдан |
| **hook→ntfy** пуши флот/lab-событий (self-hosted или ACL'd topic) | Публичный ntfy-топик без ACL (public-by-obscurity) |
| **Channels/Telegram** как answer-path в буфер (Ф3) | Third-party subscription-auth мосты — категория, попавшая под запреты 2026 (03 раздел 2) |
| **Tailscale + Blink/mosh** как break-glass (полный tmux-attach) | Web-tmux обёртки (VibeTunnel/ttyd) — DIY auth/TLS burden, вытеснены 1+5 |

**Success criteria фазы.**
- F6-S1. BLOCKER в 01:00 доставлен пушем на телефон (= SC-G).
- F6-S2. Ответ из Telegram/Remote Control попадает в `queue.jsonl` как `answered_by=owner,
  channel=telegram`.
- F6-S3. Fleet-уровневые события (digest-ready, quota-parked, incident), которые per-session Remote
  Control не видит, доставляются через hook→ntfy.
- F6-S4. При отказе «красивых» путей владелец делает `tmux attach` через Tailscale+mosh с телефона.

**Требования.**

- **R6.1 — Official Remote Control на сессии оркестратора.** *Current:* нет mobile-доступа. *Target:*
  `claude remote-control`/`--rc`/`/rc` пэйрит ЛОКАЛЬНУЮ сессию оркестратора к claude.ai/code + iOS/
  Android app (QR-pairing); оба push-тоггла ON («when Claude decides» + «actions required»);
  subscription-only by design (совпадает с C1), outbound-HTTPS-only, TLS, presence-file suppression.
  Оркестратор — правильная единственная сессия для экспонирования (владелец с ней и так говорит).
  Research-preview → обернуть тонким скиллом (swappable). *Acceptance:* F6-S1; пуш приходит на
  реальный телефон; approve permission с телефона работает. (C1)
- **R6.2 — hook→ntfy для fleet/lab-событий.** *Current:* нет push-пути (05 раздел 2.3-8; 01 раздел 8-3
  «parks are silent»). *Target:* `Notification`/`StopFailure`/`SubagentStop`-hooks → curl в ntfy
  (self-hosted или ACL'd topic): BLOCKER-вопросы, digest-ready, quota-window parked, incident. Это
  push-путь, работающий даже когда Remote-Control сессии нет (покрывает fleet-level, что per-session
  RC не видит). *Acceptance:* F6-S3; топик ACL'd/self-hosted (не public-by-obscurity). (C1)
- **R6.3 — Channels/Telegram answer-path.** *Current:* ответить на вопрос можно только в терминале.
  *Target:* Telegram (или своя) forward INTO локальной сессии: владелец из кровати отвечает «1» →
  оркестратор применяет опцию 1, логирует `answered_by=owner channel=telegram` в буфер (Ф3). Оценить
  после 1+2 (plugin-maintenance cost). *Acceptance:* F6-S2; ответ материализуется как patch-запись в
  `queue.jsonl`.
- **R6.4 — Tailscale break-glass.** *Current:* нет удалённого доступа к панелям. *Target:* Tailscale
  (E2E WireGuard, без открытых портов) + Blink/mosh → полный `tmux attach` к реальному флоту, когда
  всё остальное сломано; attach/kill/restart любой панели. *Acceptance:* F6-S4; с телефона возможен
  attach к живой панели без открытия входящих портов.

**Задачи (Epic: `[Tooling][Docs] Фаза 6 — Mobile`).**
1. `[Skill][Docs] Remote Control обёртка + runbook пэйринга оркестратора + push-тоггглы`.
2. `[Tooling] hook→ntfy (Notification/StopFailure/SubagentStop → curl); ACL/self-host топика`.
3. `[Tooling] Telegram answer-path → patch-запись в queue.jsonl (answered_by/channel)`.
4. `[Docs] Tailscale + Blink/mosh break-glass runbook`.
5. `[Docs] dev_history`.

**Оценка усилия:** **M** (в основном конфигурация официальных поверхностей + ~10-строчный ntfy-hook;
05 раздел 7 items 4/7 HIGH-MED/LOW; Telegram — MED/MED/MED, ставится после 1+2).

**Зависимости:** Ф3 (буфер как цель ответа), Ф4 (hooks для ntfy). Remote Control сам по себе
независим (конфиг), но ценностная цепочка (пуш BLOCKER → ответ → буфер) требует Ф3.

**Риски.** (R) Research-preview Remote Control — surface может измениться → тонкая скилл-обёртка. (R)
~10 мин offline убивает RC-сессию → ntfy-путь не зависит от живой RC-сессии. (R) ntfy public-topic
утечка → ACL/self-host. (R) Third-party мост в auth-пути → запрещено (C1; 03 раздел 2).

**Критерии приёмки фазы + end-check.**
- Gates: `./install.sh`; ntfy-hook — валидный async command; RC-обёртка задокументирована.
- **End-check:** прогон «BLOCKER ночью»: воркер поднимает BLOCKER (истёкший креденшл) → в течение
  минут пуш приходит на реальный телефон (RC push И/ИЛИ ntfy); владелец отвечает из Telegram/RC →
  ответ появляется в `queue.jsonl` как `answered_by=owner`; при заглушенных «красивых» путях владелец
  делает `tmux attach` через Tailscale+mosh и видит живые панели.

---

## Phase 7 — Interactive control plane (moved to a per-phase file)

Phase 7 is maintained as a separate per-phase PRD file per the owner language rule
(2026-08-07): [`docs/prd/01-phase7-interactive-control-plane.md`](./01-phase7-interactive-control-plane.md).
The Russian Phase 7 section previously appended here (commit `4197157`, GSL-273) has
been extracted to that file and rewritten in English on 2026-08-07 (GSL-273 follow-up).

---

## Phases 8-16 — per-phase PRD files (index only)

Every phase from 8 onward is authored as a standalone per-phase file in English under
`docs/prd/`, per the owner language rule (2026-08-07). This monolith is kept as the
historical archive for Phases 1-6 (Russian) and the pointer surface for Phase 7. Later
phases are listed here so a reader who lands in the monolith still discovers them; the
full traceability lives in [`docs/prd/README.md`](./README.md).

- **Phase 8 — skills management system:** [`02-phase8-skills-management.md`](./02-phase8-skills-management.md) — epic [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174).
- **Phase 9 — plugin orphan rescue:** [`03-phase9-plugin-orphan-rescue.md`](./03-phase9-plugin-orphan-rescue.md) — epic [GSL-334](https://ainstance-labs.atlassian.net/browse/GSL-334) inside the plugin-migration program [GSL-337](https://ainstance-labs.atlassian.net/browse/GSL-337).
- **Phase 10 — plugin bundles v0.1:** [`04-phase10-plugin-bundles-v01.md`](./04-phase10-plugin-bundles-v01.md).
- **Phase 11 — snapshot-release pipeline:** [`05-phase11-snapshot-release-pipeline.md`](./05-phase11-snapshot-release-pipeline.md).
- **Phase 12 — plugin global-scope transition:** [`06-phase12-plugin-global-scope-transition.md`](./06-phase12-plugin-global-scope-transition.md).
- **Phase 13 — plugin E2E shakedown:** [`07-phase13-plugin-e2e-shakedown.md`](./07-phase13-plugin-e2e-shakedown.md).
- **Phase 14 — observer mode, passive observation:** [`08-phase14-observer-mode-observation.md`](./08-phase14-observer-mode-observation.md) — program epic [GSL-347](https://ainstance-labs.atlassian.net/browse/GSL-347).
- **Phase 15 — observer mode, runtime control activation:** [`09-phase15-observer-mode-runtime-control.md`](./09-phase15-observer-mode-runtime-control.md).
- **Phase 16 — observer mode, task submission from the web:** [`10-phase16-observer-mode-task-submission.md`](./10-phase16-observer-mode-task-submission.md) — requirements-level only in v1.

---

## Сквозная матрица трассируемости (seam-guard)

Каждое требование источника (findings + бриф владельца) → фаза → req-ID → критерий приёмки. Ни одного
скрытого сироты.

| Источник (finding · раздел) | Требование источника | Фаза · Req | Критерий приёмки |
|---|---|---|---|
| 02 раздел 9-A; 04 раздел 7.1 | External mechanical watchdog + restart budget + human escalation | Ф1 · R1.2, R1.3 | F1-S1, F1-S4, SC-A, SC-B |
| 02 раздел 9 prereq; 04 раздел 3.9 | Written heartbeat protocol из durable-артефактов, не self-report | Ф1 · R1.1 (C7) | R1.1 acceptance (mtime растёт/стопорится) |
| 04 раздел 7.1 (Gastown) | startup grace, zombie debounce(3), kill cooldown, backoff, mass-death, single-flight | Ф1 · R1.4 | F1-S2, F1-S3 |
| 02 раздел 3, раздел 5b | Re-wake из durable ledger (re-attach, не respawn); route-through-reap | Ф1 · R1.2, R1.5 | F1-S1 (re-attach), R1.5 acceptance |
| 04 раздел 3.5; 04 раздел 6 item1 | Armed self-pulse с cache-aware pacing (не 300s) | Ф2 · R2.1 | F2-S1, F2-S2, SC-C |
| 04 раздел 3.6; 05 раздел 4.1 | Night mode / activeHours; buffer вместо ask ночью | Ф2 · R2.2 | F2-S2 |
| 01 раздел 8-2; 04 раздел 3.6 | Quota-window auto-wait (quiesce + auto-resume) | Ф2 · R2.3 | F2-S3 |
| 04 раздел 3.9; 04 раздел 6 item6 | Circuit-breaker (same-error/output-decline + cooldown/HALF_OPEN), human-resettable | Ф2 · R2.4 | F2-S4 |
| 05 раздел 4.1; 01 раздел 7; 02 раздел 4 | 4 типа вопросов, park-per-task, pause-budget defaults | Ф3 · R3.1 | F3-S1, SC-D |
| 05 раздел 4.2; 04 раздел 3.7 | queue.jsonl append-only + dedup (question spam) | Ф3 · R3.2 | F3-S4 |
| 05 раздел 4.3 | Decision manifest owner-sovereign, зеркалит denylist | Ф3 · R3.3 | F3-S3 |
| 05 раздел 4.4 | Learning loop → manifest candidates; questions/night→0 | Ф3 · R3.4 | R3.4 acceptance |
| 05 раздел 4.5; 04 раздел 3.6 | Morning digest (Waiting/Decided/Shipped/Incidents/Cost/Next) | Ф3 · R3.5 | F3-S2, SC-E |
| 05 раздел 4.6 | PULSE-дельты; BLOCKED_ON_HUMAN → queue+reroute | Ф3 · R3.6 | F3-S1 |
| 05 раздел 3.2 | T1 hooks → events.jsonl (0 токенов, model-independent) | Ф4 · R4.1 | F4-S1 |
| 05 раздел 3.2; 01 раздел 3 | Explicit emits + poll-fill (reconcile gh/jira/git) | Ф4 · R4.2 | R4.2 acceptance |
| 05 раздел 3.3; 01 раздел 3 | docs/lab layout, atomic/append-only, STATE авторитет | Ф4 · R4.3 (C8) | R4.3 acceptance |
| 05 раздел 3.1, раздел 3.5; 03 раздел 3-B | T3 chronicler = bounded claude -p, НЕ pane-teammate, показывает несвежесть | Ф4 · R4.4 (C3) | F4-S2, F4-S3, F4-S4 |
| 05 раздел 1.4-1 | Только скрипт-регенерация (анти-wiki-rot) | Ф4 · R4.4; Ф5 · R5.3 | F4-S3, F5-S4 (self-health) |
| 05 раздел 5.1 | Autonomy runway = min() по часам-исчерпания | Ф5 · R5.1 | F5-S1, SC-F |
| 05 раздел 3.4, раздел 5.2 | 7 экранов static HTML; окно вопросов; статусы Jira/GH | Ф5 · R5.2 | F5-S2, F5-S3 |
| 05 раздел 3.4; 01 раздел 5 | Committable/phone-readable; v2 (SSE/composer) — out | Ф5 · R5.3; Non-goals | F5-S4 |
| 05 раздел 6-1; 01 раздел 6 | Official Remote Control (subscription, push, TLS), НЕ DIY-transport | Ф6 · R6.1; Non-goals | F6-S1, SC-G |
| 05 раздел 6-2; 01 раздел 8-3 | hook→ntfy fleet/lab push (self-host/ACL) | Ф6 · R6.2 | F6-S3 |
| 05 раздел 6-3 | Channels/Telegram answer-path в буфер | Ф6 · R6.3 | F6-S2 |
| 05 раздел 6-5 | Tailscale + mosh break-glass | Ф6 · R6.4 | F6-S4 |
| 03 раздел 2; 01 раздел 4 | Subscription-only; no API keys; unset ANTHROPIC_API_KEY | Все · C1 | C1 (doctor-проверка) |
| 03 раздел 3 (matrix A); 02 раздел 8 | Engine = interactive Claude Code + Agent Teams/tmux | Все · C2 | C2 |
| 03 раздел 2; 05 раздел 3.5 | claude -p только bounded glue (budget) | Ф4 · C3, R4.4 | F4-S4 |
| skill; 02 STEELMAN | NO Workflow tool | Все · C4 | C4 |
| MEMORY | Max 3 panes; kill только по явному id | Все · C5 | C5 |
| skill; 02 раздел 2 | Модели three-tier по политике владельца | Все · C6 | C6 |

**Явные отложенности (deferred, с причиной):**
- v2 interactive dashboard (SSE/Next.js, autosk state-aware composer, replay-then-tail) — **отложено**
  до проверки JSONL-слоя; контракт данных Ф4 спроектирован так, что v2 — чистая замена потребителя
  (05 раздел 7 item 12). Не сирота — сознательный defer.
- AI-триаж-tier (`claude -p` on-anomaly над watchdog'ом) — **отложено**: warren выкинул AI из
  supervision-петли; добавляем только on-anomaly позже, не как непрерывный патруль (02 раздел 9-C).
- Docs integrity gate (порт `check-docs-anchors.mjs` + dev_history-coverage) — **отложено**: у GSL нет
  CI; начать как локальный `./install.sh`-adjacent gate позже (05 раздел 7 item 9).
- Sleep-time consolidation (idle-gap compute) — **отложено**: nice-to-have, не sleep-blocking
  (04 раздел 6 item 8).

---

## Реестр рисков (сводно)

| Риск | Severity | Фаза | Обработка |
|---|---|---|---|
| Watchdog бьёт по ложняку → убивает здоровый флот | High | Ф1 | R1.4 (grace/debounce/cooldown/mass-death/single-flight); конфиг падает громко на старте |
| macOS sleep ставит на паузу watchdog И флот | Med | Ф1/Ф2 | Задокументировать; держать машину awake или принять паузу; staleness ловит при wake |
| Re-wake не идемпотентен → double-dispatch | High | Ф1 | Cold-start reconcile-then-dispatch; «никогда spawn fresh to be safe» |
| Пуллинг «на всякий» жжёт токены | Med | Ф2 | Cache-окно + HEARTBEAT_OK cheap-exit |
| Дефолт по буферу необратим | High | Ф3 | Буферизация только reversible; необратимое = BLOCKER (denylist) |
| Question spam от N воркеров | Med | Ф3 | Dedup `(task, question-hash)` + seen_by |
| Hooks не срабатывают как в доках на этой машине | Med | Ф4 | Build-time верификация; деградировать с логом, не молча |
| Chronicler жжёт programmatic credit | Med | Ф4 | `--max-budget-usd` + телеметрия бёрна |
| Дашборд/хаб гниёт (tasty-lunch wiki) | High | Ф4/Ф5 | Инвариант «только регенерация»; self-health staleness-алярм |
| Runway-число врёт (fabricated context%) | Med | Ф5 | Cross-check против roll-эвристики; показывать доказательства |
| Research-preview RC/Routines меняет surface | Med | Ф6 | Тонкая скилл-обёртка (swappable) |
| Programmatic credit-pool re-tuning Anthropic | Med | Все | Движок на interactive quota (C2); glue под бюджетом (C3); ANTHROPIC_API_KEY escape-hatch OFF by default |
| ntfy public-topic утечка | Low | Ф6 | ACL / self-host |

---

## Журнал решений (Decision log)

| Дата | Источник | Решение | Что заместило |
|---|---|---|---|
| 2026-07-08 | Бриф владельца (team-lead) + findings 01–05 | Единый фазовый PRD из 6 фаз в порядке safety→scheduling→autonomy→doc→UI→mobile | — (новый документ) |
| 2026-07-08 | 02 раздел 9; 04 раздел 5 | Ф1 (Watchdog) первой: единственный самонепоправимый сбой блокирует «идти спать» | Порядок «по ценности», а не по алфавиту/шаблону |
| 2026-07-08 | 02 раздел 9-B | Минимальный heartbeat вынесен в Ф1 (producer для watchdog); богатая каденция — в Ф2 | Иначе Ф1 не имеет что читать |
| 2026-07-08 | 03 раздел 2; 01 раздел 4 | Subscription-only как сквозной инвариант C1 с doctor-проверкой; движок на interactive quota C2 | — |
| 2026-07-08 | 05 раздел 3.5; 03 раздел 3-B | Chronicler = bounded `claude -p` job, НЕ live-teammate (спавн-cap-3, не стопорит доставку) | Отвергнут live-chronicler-teammate |
| 2026-07-08 | 05 раздел 6-8; 01 раздел 6 | Mobile на официальных поверхностях (RC+ntfy+Telegram+Tailscale); DIY-transport в Non-goals | Отвергнут autosk-путь собственного клиента |
| 2026-07-08 | Ограничение брифа (субагентов не спавнить) | Adversarial skeptic pass выполнен САМИМ writer'ом (Agent-tool доступен, но запрещён брифом), а не sonnet-субагентом — раскрыто в отчёте | Отклонение от writing-prds раздел 6 (спавн запрещён брифом team-lead) |

---

## Приложение — Источники (verbatim pointers)

Источник фактов (первоисточник, читан полностью): `docs/research/2026-07-07-orchestration/`
- `01-autosk.md` — headless `claude -p` harness, park-to-human, три-ярусные loop-budgets, subscription-native auth, mobile (raw TCP, no push).
- `02-warren-overstory.md` — 4-слойная supervision-стека (supervisor/watchdog/healer/detectors), restart budget, re-wake из transcript, «LLM coordinator → deterministic control loops», overstory tiered watchdog + ZFC + coordinator-gap.
- `03-headless-subscription-landscape.md` — что такое `claude -p`, subscription-policy timeline 2025–2026, approach matrix (A+D+B), orchestrator landscape (Gastown/Ralph/Claude Squad).
- `04-loop-engineering.md` — канон loop-engineering, pattern-catalog (10 паттернов), gap-table против нашего скилла, Gastown watchdog implementation (раздел 7.1), ranked adoption.
- `05-lab-ui-mobile-autonomy.md` — tasty-lunch docs-система, Laboratory 3-tier дизайн, question-buffer типология + queue + manifest + digest, orchestration UI (runway=min()), mobile survey.

Контекст (сводные отчёты, по диагонали): `docs/reports/{orchestrator-landscape, headless-and-supervision, autonomy-lab-ui, loop-engineering}/index.html`.

Текущая система (что есть, НЕ меняется): `skill/orchestrating-delivery-agents/SKILL.md` (+
`skill/handoff/`, `skill/delivery-workflow/`, `skill/using-jira/`).
