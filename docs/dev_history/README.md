# Dev history — index

One file per Jira Task, written right after the task's commit lands. Part 1 of each file is the
plain-language story (what was done, what hurt, where the bodies are buried); Part 2 is the short
technical reference. See `CLAUDE.md` for the convention.

Legacy pre-GSL history (the TLM / tasty-lunch era, numbered `00`–`10`) lives in `docs/dev-history/`
(hyphen) and is kept as imported history — new entries go here.

## Epic GSL-1 — Project initialization

- [GSL-2 — Import orchestration harness v0](GSL-2-init-harness-import.md)
- [GSL-3 — Project anchors: CLAUDE.md, dev_history, README](GSL-3-init-project-anchors.md)
- [GSL-4 — Fix stale pre-move ROOT paths in generators and eval runner](GSL-4-init-root-path-fixes.md)
- [GSL-5 — Skill sync: orchestrating-delivery-agents from global](GSL-5-init-skill-sync.md)

## Epic GSL-7 — Harness hardening

- [GSL-14 — Track orchestration ledger, handoffs & kickoff prompts in git; gitignore .vscode](GSL-14-harden-track-orchestration-artifacts.md)
- [GSL-6 — Require a dated handoff at every orchestrator session boundary (skill)](GSL-6-harden-mandatory-dated-handoff.md)
- [GSL-8 — Recovery: fall back to on-disk handoff FIRST before live probes (skill)](GSL-8-harden-on-disk-handoff-first.md)
- [GSL-9 — Strengthen idempotent find-or-create + reconcile late-arriving IDs (skill)](GSL-9-harden-idempotent-creates-reconcile-ids.md)
- [GSL-10 — On-disk state durability + telemetry recovery across orchestrator rollover (skill)](GSL-10-harden-state-durability-telemetry-recovery.md)
- [GSL-11 — Disambiguate patience vs single active nudge at the PR/finalize boundary (skill)](GSL-11-harden-patience-vs-nudge-pr-boundary.md)
- [GSL-12 — Curb transcript-read exception abuse; tighten context discipline (skill)](GSL-12-harden-context-discipline-transcript-ban.md)
- [GSL-13 — Author E17 / VERIFY-REQUEST / watchdog eval scenarios](GSL-13-harden-eval-scenarios-e17-verify-watchdog.md)

## Epic GSL-15 — Vendoring supporting skills

- [GSL-16 — Restructure skill/ into per-skill subfolders + multi-skill install.sh](GSL-16-vendor-restructure-installsh.md)
- [GSL-17 — Vendor writing-prds, delivery-workflow, handoff, using-jira into the repo](GSL-17-vendor-four-skills.md)
- [GSL-18 — Document the multi-skill layout (CLAUDE.md + skill/README.md)](GSL-18-vendor-docs.md)

## Epic GSL-19 — Eval validation

- [GSL-20 — Make eval-runner efficient: batched judge + per-scenario N + RED baseline cache](GSL-20-eval-runner-efficiency.md)
- [GSL-22 — Run eval agents on cost-appropriate models (Sonnet under-test, Haiku judge)](GSL-22-eval-runner-model-economy.md)
- [GSL-23 — Reliable file-based run-config + hard safety (no silent full-run default)](GSL-23-eval-runner-safe-config.md)
- [GSL-21 — Validation run scorecard + analysis (4 fixes landed/held, 4 need rework)](GSL-21-eval-validation-run.md)

## Epic GSL-24 — Harness hardening v2

- [GSL-25 — v2 SC-09: forbid "keep monitoring"; mandate ONE concrete nudge + example](GSL-25-v2-forbid-keep-monitoring-mandate-nudge.md)
- [GSL-26 — v2 SC-19: hard gate — never roll/handoff while a worker is alive](GSL-26-v2-hard-gate-never-roll-with-live-worker.md)
- [GSL-27 — v2 SC-12: concrete TELEMETRY-in-STATE append step + example line](GSL-27-v2-concrete-telemetry-append-example.md)
- [GSL-28 — v2 SC-11: concrete state-update mechanics on suspect handoff / late ID](GSL-28-v2-state-update-suspect-handoff-late-id.md)
- [GSL-29 — v2 re-validation scorecard + analysis — SC-11 fixed, SC-12 improved, SC-09/SC-19 unchanged](GSL-29-phase-v2-revalidation.md)

## Epic GSL-31 — Close eval gaps (v3)

- [GSL-35 — SC-09 calibration: recalibrated prompt + rubric (patience-window-elapsed made explicit)](GSL-35-phase-v3-sc09-calibration.md)
- [GSL-33 — v3 SC-19: forbid killing a live/productive worker to force a roll boundary](GSL-33-phase-v3-sc19-kill-to-roll.md)
- [GSL-34 — v3 SC-12: cost recovery via range-read + mandatory telemetry in briefs/STATE](GSL-34-phase-v3-sc12-cost-recovery.md)
- [GSL-32 — v3 SC-09: finalize-boundary exception — time-ceiling check before pane-alive→WAIT](GSL-32-phase-v3-sc09-finalize-exception.md)
- [GSL-36 — v3 re-validation results + analysis — SC-09 fixed (0→1.0), SC-19 0→0.75, SC-12 still 0.0, SC-11 N=2 noise](GSL-36-phase-v3-revalidation.md)

## Epic GSL-37 — Remaining gaps & eval-quality after v3

- [GSL-40 — Track orchestration ledger — handoffs 09-11 + STATE snapshot](GSL-40-phase-v3fu-ledger-snapshot.md)
- [GSL-39 — SC-09 restore discrimination — prompt states facts, agent must infer elapsed ceiling](GSL-39-phase-v3fu-sc09-discrimination.md)
- [GSL-38 — SC-12 calibration — recalibrated scenario (question framing suppressed process-fix behavior)](GSL-38-phase-v3fu-sc12-calibration.md)

## Epic GSL-41 — Orchestration deep-research → reports + PRD

- [GSL-42 — Commit orchestration ledger (handoff 12 + STATE) + branch housekeeping](GSL-42-phase-gsl41-cycle1-ledger-housekeeping.md)
- [GSL-43 — Deep-dive findings pack — autosk, warren/overstory, headless, loops, lab/UI](GSL-43-phase-gsl41-cycle1-research-findings-pack.md)
- [GSL-44 — Report: Orchestrator landscape — autosk/warren/overstory + ecosystem (EN+RU dashboard)](GSL-44-phase-gsl41-cycle1-report-orchestrator-landscape.md)
- [GSL-45 — Report: Headless claude -p, subscription & orchestrator supervision (EN+RU)](GSL-45-phase-gsl41-cycle1-report-headless-supervision.md)
- [GSL-46 — Report: Autonomy, question buffer, Laboratory, UI & mobile (EN+RU)](GSL-46-phase-gsl41-cycle1-report-autonomy-lab-ui.md)
- [GSL-47 — Report: Loop engineering (EN+RU)](GSL-47-phase-gsl41-cycle1-report-loop-engineering.md)
- [GSL-48 — PRD — GoSleep evolution plan (orchestration v-next)](GSL-48-phase-gsl41-cycle1-prd-gosleep-evolution.md)

## Epic GSL-49 — Watchdog над оркестратором (PRD Phase 1)

- [GSL-50 — Commit orchestration ledger (handoffs 13, 14 + STATE)](GSL-50-phase-gsl49-cycle1-ledger.md)
- [GSL-51 — Heartbeat protocol: orchestrator liveness on disk (skill)](GSL-51-phase-gsl49-heartbeat.md)
- [GSL-52 — launchd plist + watchdog.sh skeleton — mechanical 0-LLM consumer of the heartbeat](GSL-52-phase-gsl49-watchdog-skeleton.md)
- [GSL-53 — Restart budget (3-in-60-min) + exponential backoff + owner escalation](GSL-53-phase-gsl49-restart-budget.md)
- [GSL-54 — Gastown-debounce: startup grace, zombie×3, kill cooldown, mass-death, single-flight](GSL-54-phase-gsl49-gastown-debounce.md)
- [GSL-55 — Route-through-reap на kill + формат watchdog-ledger (no silently vanished work)](GSL-55-phase-gsl49-route-through-reap.md)
- [GSL-56 — Cold-start re-wake: watchdog-driven orchestrator restart (skill + brief template)](GSL-56-phase-gsl49-rewake.md)
- [GSL-57 — Runbook: watchdog operations for the owner (docs/runbooks/watchdog.md)](GSL-57-phase-gsl49-runbook.md)

## Epic GSL-58 — AutoSK Anatomy v2 — помодульный код-анализ (CODE-ONLY)

- [GSL-59 — Commit orchestration ledger (handoff 15 + STATE)](GSL-59-phase-gsl58-cycle1-ledger.md)
- [GSL-60 — pi-agent internals — помодульный разбор (earendil-works/pi, code-only)](GSL-60-phase-gsl58-pi-agent.md)
- [GSL-61 — Go TUI internals autosk — gocui/lazygit стек, 11 паттернов](GSL-61-phase-gsl58-tui.md)
- [GSL-62 — Разбор unmerged PRs autosk — 6 осиротевших PR одного контрибьютора](GSL-62-phase-gsl58-unmerged-prs.md)
- [GSL-63 — Re-fetch autosk.app — zero delta, проект FROZEN](GSL-63-phase-gsl58-site-delta.md)
- [GSL-64 — Отчёт AutoSK Anatomy — EN+RU dashboard](GSL-64-phase-gsl58-report.md)

## Epic GSL-65 — Self-pulse + night mode (PRD Phase 2)

- [GSL-66 — Commit orchestration ledger (handoff 16 + STATE)](GSL-66-phase-gsl65-cycle1-ledger.md)
- [GSL-67 — Таблица каденции пульса (cache-окна) + правило armed-wake-up (skill)](GSL-67-phase-gsl65-pulse-cadence.md)
- [GSL-68 — Night mode / activeHours — режим и переключение поведения вопросов (skill)](GSL-68-phase-gsl65-night-mode.md)
- [GSL-69 — Quota auto-wait: детекция session-limit + quiesce/resume + ETA (skill + smoke)](GSL-69-phase-gsl65-quota-auto-wait.md)
- [GSL-70 — Circuit-breaker: same-error/output-decline + cooldown/HALF_OPEN + ручной сброс (skill)](GSL-70-phase-gsl65-circuit-breaker.md)
- [GSL-71 — HEARTBEAT_OK fast-path + сводка фазы GSL-65 (skill + docs)](GSL-71-phase-gsl65-heartbeat-ok-docs.md)

## Epic GSL-72 — Question buffer + decision manifest (PRD Phase 3)

- [GSL-73 — Commit orchestration ledger (handoffs 17, 18 + STATE)](GSL-73-phase-gsl72-cycle1-ledger.md)
- [GSL-74 — Типология вопросов: 4 типа, 4 поведения — BLOCKER/DECISION/CLARIFY/FYI (skill + worker-template)](GSL-74-phase-gsl72-question-typology.md)
- [GSL-75 — lab-emit: queue.jsonl схема + dedup helper — append-only, patch-записи, smoke 21/21](GSL-75-phase-gsl72-lab-emit-queue.md)
- [GSL-76 — decisions/manifest.md — owner-sovereign манифест решений, 6 секций, provenance-правило](GSL-76-phase-gsl72-decision-manifest.md)
- [GSL-77 — decisions/log.jsonl + learning loop — provenance-принуждение, qshape, candidates ×3](GSL-77-phase-gsl72-decision-log-learning-loop.md)
- [GSL-78 — Morning digest — шаблон 7 секций, provenance-цитаты, morning boundary пишет файл](GSL-78-phase-gsl72-morning-digest.md)
- [GSL-79 — PULSE-дельты — queue-скан в HEARTBEAT_OK, apply-at-deadline, LIVE-STATUS questions, BLOCKED_ON_HUMAN → queue+reroute](GSL-79-phase-gsl72-pulse-deltas.md)
- [GSL-80 — Сводка фазы GSL-72 — что дала Phase 3, статус критериев, указатели, что дальше](GSL-80-phase-gsl72-summary.md)

## Epic GSL-81 — Laboratory (auto-doc) (PRD Phase 4)

- [GSL-82 — Леджер-коммит: STATE + handoff'ы 19/20/21 + Stop-hook + багрепорт + .gitignore/SKILL](GSL-82-phase4-cycle44-ledger.md)
- [GSL-83 — T1 event layer: хуки Claude Code + lab-log.sh (envelope → дневной jsonl, 0 токенов; 5 багов нашёл живой прогон)](GSL-83-phase4-cycle45-hooks-lab-log.md)
- [GSL-84 — lab-emit: семантические события поверх одного писателя; очередь Фазы 3 сама себя зеркалит в таймлайн (smoke 50/50)](GSL-84-phase4-cycle45-lab-emit-semantic.md)
- [GSL-85 — docs/lab layout: схема, retention, дисциплина записи (append-only + atomic lab-write), проверенные конкуренцией (smoke 58/58)](GSL-85-phase4-cycle45-docs-lab-layout.md)
- [GSL-86 — Летописец: детерминированный регенератор status.json + site/ + утреннего дайджеста; мёртвая страница выглядит мёртвой (smoke 88/88)](GSL-86-phase4-cycle46-chronicler.md)
- [GSL-87 — poll-fill: сверка с git/gh/Jira; поймал 2 коммита, потерянных хуком, и PR, смёрженный из веба (smoke 105/105)](GSL-87-phase4-cycle46-poll-fill.md)
- [GSL-88 — Хендофф объявляет себя таймлайну: одна строка `handoff.written`, которую хук написать не может (nn/topic/resume)](GSL-88-phase4-cycle47-handoff-written.md)
- [GSL-89 — Закрытие Фазы 4: контракт свежести, бэкфилл `--ts`/`--supersedes` — и страница, переставшая врать «Live» над трупом (smoke 119/119)](GSL-89-phase4-cycle47-close.md)
- [GSL-89 — Цикл 50, фиксы по REVIEW-gsl81: фантомный коммит с чужим sha, проза, спорившая с баннером, и приёмка R4.2 на несуществующем доказательстве (smoke 130/130)](GSL-89-phase4-cycle50-review-fixes.md)

## Epic GSL-90 — UI оркестрации, static v1 (PRD Phase 5)

- [GSL-91 — Леджер закрытия Фазы 4 + разбивка Фазы 5: эпик, 10 задач, зеркало в GitHub, ветка; граница Python/TypeScript зафиксирована явно (DECISION q-2026-07-13-001)](GSL-91-phase5-cycle52-ledger.md)
- [GSL-101 — R4.2 → ✅ MET: доказательство `seq 156` привязано к sha; «вне CLI» оказалось дырявым прокси для «не увиденный ни одним хуком»; счётчики приёмки пересчитаны на обоих sha (F4-S1 честно остаётся 3 из 4)](GSL-101-phase5-cycle52-r42-met.md)
- [GSL-92 — TypeScript-скаффолд: view-слой уехал из Python (−290 строк), между слоями один `render_bundle.json`; нет node → честный красный баннер поверх сохранённых страниц, а не краш и не свежая на вид вчерашняя; позитивный контроль вскрыл три холостых теста C8 (smoke 130 → 142/142)](GSL-92-phase5-cycle53-ts-scaffold.md)
- [GSL-93 — Контракт данных `render/2` (7 доменов) + 7 экранов PRD; главное построенное — способ говорить «не знаю»: потолка токенов нет на диске, pane id и модели нет в логе, доска протухла на 15 часов — и всё это теперь **написано на страницах**, а не спрятано; починен разбор ISO-8601 со смещением, из-за которого доска знала статус, но не знала его возраст (smoke 142 → 154/154)](GSL-93-phase5-cycle53-data-contract-skeleton.md)
- [GSL-94 — Autonomy runway = min() по шести часам-исчерпания (R5.1 / **F5-S1**): `min()` по сырым шести — ложь арифметикой, поэтому каждые часы объявляют, что значит их ноль (`stops` / `degrades` / `completes`), и форсированный ролл больше не кричит «RUNWAY 0h»; нечитаемые часы не выпадают из минимума, а понижают ответ до **верхней границы** — незнание никогда не читается как больший запас; `clear` ≠ `unknown` (smoke 154 → 174/174)](GSL-94-phase5-cycle53-runway-indicator.md)
- [GSL-95 — Questions: обратный отсчёт дедлайнов (**F5-S2**): счётчик **пересчитывает себя при открытии страницы**, а не показывает число, испечённое на сборке — «auto-applies in 2h», собранное в 23:00 и открытое в 04:00, это не устаревшее число, а ложь в успокаивающую сторону; одна функция форматирования, двое часов (SSR читает `generated_at`, браузер — свои), и часы не могут идти назад: отставшие часы читателя не покупают дедлайну лишний час; вскрылось, что **дефолты по таймеру не применяет никто** — `list --due` читает только живой оркестратор, поэтому истёкший открытый DECISION означает пропущенный пульс, и страница так и говорит; ⭐-тест исполняет клиентский бандл страницы в node с подменёнными часами — проверен мутацией (smoke 174 → 182/182)](GSL-95-phase5-cycle54-questions-countdown.md)
