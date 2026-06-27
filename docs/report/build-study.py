#!/usr/bin/env python3
"""Generate study.html — beginner tutorial with CONTINUOUS sequential numbering (1..N)."""
import os
OUT = os.path.join(os.path.dirname(__file__), "study.html")

def T(slug, label): return f'<a class="term" href="glossary.html#term-{slug}">{label}</a>'

# (section heading, anchor, [point html, ...]) — numbering is continuous across ALL sections
SECTIONS = [
 ("Основы — что это вообще", "osnovy", [
  f'Представь, что у тебя есть умный помощник ({T("subagent","агент")}) — это языковая модель, которая может читать файлы, писать код, запускать команды. Один агент = один «работник».',
  f'У агента есть {T("compaction","окно контекста")} — это его «оперативная память». Она ограничена. Когда работа большая, память кончается, и агент «забывает» начало.',
  f'Если работы много (целый roadmap из 9 эпиков), один агент не вытянет — память кончится на середине, и его придётся перезапускать вручную.',
  f'Решение — {T("orchestrator","оркестратор")}: агент, который сам НЕ делает работу, а только раздаёт её другим свежим агентам и следит за ними. Как тимлид: не пишет код сам, а координирует.',
  f'Свежий агент на каждый кусок работы называется {T("cycle-worker","cycle-worker")} (рабочий цикл). Отработал кусок — передал эстафету следующему.',
  f'Эстафета передаётся через {T("handoff","handoff")} — это файл-«записка»: что сделано, где мы, что делать дальше. Новый агент читает её и продолжает с нуля памяти. Так цепочка живёт дольше любого одного агента.',
 ]),
 ("Живая доставка — как мы это делали по-настоящему", "delivery", [
  f'Мы реально прогнали так целый проект: оркестратор + цепочка cycle-worker-ов, соединённых handoff-ами. Подробная хронология — на странице <a href="dev-history.html">Dev-history</a>.',
  f'Каждый воркер работал в своей панели {T("tmux-pane","tmux")} — это видно вживую. Дерево «кто кого запускал» — на <a href="agents.html#cycles">Agents (циклы)</a>.',
  f'Воркеры общались с оркестратором через {T("sendmessage","SendMessage")} — обычный текст невидим оркестратору, нужно именно отправить сообщение.',
  f'Оркестратор НЕ читает тяжёлые файлы (чужой код, транскрипты) — иначе у НЕГО кончится память. Он держит только пути и короткие отчёты. Это правило — {T("leanness","leanness")}.',
  f'Когда у воркера контекст подходит к ~75–80%, он сам пишет handoff и отдаёт отчёт. Оркестратор поднимает следующего свежего воркера. Так мы закрыли 9 эпиков подряд.',
 ]),
 ("Ошибки-уроки — две реальные ошибки", "oshibki", [
  f'Урок №1 — «гонка дубликата». Воркер ушёл в {T("liveness","idle")} без отчёта; оркестратор решил «он закончил» и поднял второго на ту же задачу. Двое сделали один и тот же мерж — {T("double-merge","double-merge")}. Сценарий <a href="scenarios.html#SC-01">SC-01</a>, edge-case <a href="skill.html#E1">E1</a>.',
  f'Вывод: <strong>idle ≠ закончил</strong>. Нельзя поднимать замену, пока прошлый не ПОДТВЕРЖДЁН завершённым.',
  f'Урок №2 — «преждевременное убийство». Воркер молчал пару минут, оркестратор решил «завис» и убил его. А он работал — просто думал. Потеряли прогресс. Сценарий <a href="scenarios.html#SC-02">SC-02</a>, edge-case <a href="skill.html#E2">E2</a>.',
  f'Вывод: <strong>idle ≠ завис</strong>. Сначала терпение и проверка по git, только потом действия.',
  f'Эти две ошибки — фундамент всего дальнейшего: мы превратили их (и десяток других ловушек) в правила.',
 ]),
 ("Скилл — превращаем опыт в навык", "skill", [
  f'Все правила мы собрали в {T("skill","скилл")} <code>orchestrating-delivery-agents</code> — это инструкция, которую любой агент читает и начинает действовать как опытный оркестратор. Разбор — на странице <a href="skill.html">Skill</a>.',
  f'В скилле: модель ролей, схема решения «агент молчит — что делать», протокол жизненного цикла и каталог из 16 {T("edge-case","edge-кейсов")} (<a href="skill.html#E1">E1</a>…<a href="skill.html#E16">E16</a>).',
  f'Скилл мы «закалили»: запустили 8 свежих агентов-критиков, каждый бил по своей оси (гонки, восстановление, безопасность…). Они нашли даже фактические ошибки и логический тупик — мы внесли 22 правки. См. <a href="dev-history.html#dh-01">dh-01</a>.',
  f'Важная идея: скилл — это процесс, а не код. Значит и проверять его надо не обычными тестами, а поведенчески.',
 ]),
 ("Тесты — как проверять СКИЛЛ, а не код", "testy", [
  f'Тест скилла = {T("eval","eval")}: даём свежему агенту ситуацию и смотрим, принял ли он правильное решение. Это поведенческая проверка.',
  f'Каждый сценарий — два файла: prompt.md (ситуация, её видит агент) и rubric.md (критерии оценки, их видит только {T("judge","судья")}). Разделены, чтобы агент не подсмотрел ответ.',
  f'Гоним каждый сценарий двумя «руками»: {T("red-green","RED")} — агент БЕЗ скилла (базовая линия), и GREEN — агент СО скиллом. Разница = польза скилла.',
  f'Судья ставит pass/fail по рубрике. Считаем {T("pass-rate","pass-rate")} — долю верных решений из N прогонов (модель недетерминирована, поэтому несколько прогонов).',
  f'Вердикты: {T("verdict-pass","PASS")} (скилл помог), {T("verdict-guard","GUARD")} (база и так справляется), {T("verdict-fail","FAIL")} (GREEN&lt;0.8 — реальная дыра). Все прогоны — на <a href="runs.html">Runs</a>.',
 ]),
 ("Корпус сценариев — 20 ловушек", "korpus", [
  f'Мы написали 20 стресс-сценариев — по одному на каждый edge-кейс + безопасность, бюджет, перекладку оркестратора, дисциплину контекста. Все — на <a href="scenarios.html">Scenarios</a>.',
  f'Ключевой урок: сценарий полезен, только если он «роняет RED» — то есть базовая модель без скилла на нём реально ошибается. Если и без скилла всё ок, тест ничего не различает.',
  f'Поэтому в каждом сценарии неправильное действие сделано НАРОЧНО заманчивым (дедлайн, «не тормози», полная автономия) — чтобы проверить, удержит ли скилл от ошибки.',
 ]),
 ("Прогоны и стоимость — куда ушли лимиты", "progony", [
  f'Всего было 7 воркфлоу-прогонов, в сумме ~635 {T("subagent","субагентов")} и ~14.6M токенов. Полная телеметрия — на <a href="runs.html">Runs</a>, поимённый список всех 635 — на <a href="subagents.html">Subagents</a> (раскрывается по клику).',
  f'{T("workflow","Workflow")} — это способ запустить много агентов по чёткому сценарию ({T("fan-out","fan-out")}): например «20 сценариев × 6 прогонов × 2 руки + судьи».',
  f'На полном прогоне (480 агентов) мы упёрлись в недельный лимит — часть судей упала. Доделали через {T("orchestration-state","resume")}: кэш переиспользует готовых агентов, заново гоняются только упавшие.',
  f'Урок про стоимость: движок не отдаёт токены по каждому субагенту ({T("telemetry","telemetry")}-слепота) — поэтому каждый воркер должен сам сообщать свою стоимость.',
 ]),
 ("Что нашли и что дальше", "itog", [
  f'Итог по 20 сценариям: <span class="badge b-pass">6 PASS</span> · <span class="badge b-guard">6 GUARD</span> · <span class="badge b-fail">8 FAIL</span>. На самых злых ловушках скилл дал огромный лифт (например <a href="scenarios.html#SC-08">SC-08</a>: 0.00→1.00).',
  f'8 дыр (GREEN&lt;0.8) — это бэклог доработки. Самые большие: <a href="scenarios.html#SC-19">SC-19</a> перекладка оркестратора (0.20), <a href="scenarios.html#SC-09">SC-09</a> nudge-на-PR (0.33), <a href="scenarios.html#SC-12">SC-12</a> телеметрия (0.33).',
  f'Темы дыр: идемпотентность ({T("idempotent-create","find-or-create")}), запись состояния/телеметрия, конфликт «терпение vs активный nudge». Это следующий REFACTOR скилла.',
  f'Где мы сейчас: ядро скилла доказанно работает, корпус тестов на месте, дыры найдены и понятны. Дальше — починить дыры и (позже) построить web-{T("event-schema","observability")} harness. См. <a href="architecture.html">Architecture</a> и <a href="dev-history.html">Dev-history</a>.',
 ]),
]

NAV = """<header class="topbar"><div class="inner">
  <a class="brand" href="index.html">Orchestration Harness<span class="dot">.</span></a>
  <nav>
    <a href="index.html">Dashboard</a>
    <a href="study.html" class="active">Study</a>
    <a href="skill.html">Skill</a>
    <a href="scenarios.html">Scenarios</a>
    <a href="runs.html">Runs</a>
    <a href="agents.html">Agents &amp; Profiling</a>
    <a href="subagents.html">Subagents</a>
    <a href="issues.html">Issues</a>
    <a href="architecture.html">Architecture</a>
    <a href="glossary.html">Glossary</a>
    <a href="dev-history.html">Dev-history</a>
  </nav>
</div></header>"""

# render with a single continuous counter
toc = []
body = []
n = 0
for heading, anchor, points in SECTIONS:
    toc.append(f'<li><a href="#{anchor}">{heading}</a></li>')
    body.append(f'<h2 id="{anchor}">{heading}</h2>')
    for p in points:
        n += 1
        body.append(f'<p class="step"><span class="n">{n}.</span> {p}</p>')
TOTAL = n

HTML = f"""<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Study — Orchestration Harness</title>
<link rel="stylesheet" href="assets/style.css">
<style>
 .step{{margin:8px 0;padding-left:38px;position:relative;max-width:82ch}}
 .step .n{{position:absolute;left:0;top:0;min-width:30px;text-align:right;color:var(--accent);font-weight:700;font-variant-numeric:tabular-nums}}
 .toc{{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;margin:16px 0}}
 .toc ol{{margin:6px 0 0;padding-left:22px}} .toc li{{padding:2px 0}}
</style>
</head><body>
{NAV}
<main class="container">
<h1>Study — обучение с нуля</h1>
<p class="lead">Пошаговый разбор для того, кто никогда не строил агентные системы. Идём по порядку: что это,
как мы это делали, какие были ошибки, что получилось. {TOTAL} пунктов, сквозная нумерация. Незнакомые
термины подчёркнуты — наведи/нажми, чтобы открыть объяснение в <a href="glossary.html">глоссарии</a>.</p>

<div class="toc"><strong>Содержание</strong>
<ol>
{chr(10).join(toc)}
</ol></div>

{chr(10).join(body)}

<hr>
<p class="muted">Дальше по теме: <a href="skill.html">Skill</a> · <a href="scenarios.html">Scenarios</a> ·
<a href="runs.html">Runs</a> · <a href="subagents.html">Subagents</a> · <a href="glossary.html">Glossary</a> ·
<a href="dev-history.html">Dev-history</a>.</p>
</main>
<footer>Orchestration Harness · Study ({TOTAL} пунктов, сквозная нумерация) · Jira TLM-58</footer>
</body></html>"""

open(OUT, "w").write(HTML)
print(f"wrote {OUT}: {TOTAL} sequentially-numbered points across {len(SECTIONS)} sections")
