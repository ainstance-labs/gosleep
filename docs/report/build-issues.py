#!/usr/bin/env python3
"""Generate issues.html — the 8 eval FAIL gaps + their Jira fix-tasks."""
import os
OUT = os.path.join(os.path.dirname(__file__), "issues.html")
JB = "https://ainstance-labs.atlassian.net/browse/"

# (jira, title, [(scn_id, slug, green), ...], problem, fix)
ISSUES = [
 ("TLM-71","Идемпотентность: find-or-create + переиспользование поздних ID",
  [("SC-04","crossed-late-message",0.67),("SC-11","suspect-handoff",0.67),("SC-16","idempotent-create",0.67)],
  "Агенты пересоздают эпик/таски/issues заново вместо «найти-и-переиспользовать», и не передают восстановленные ID следующему циклу.",
  "Сделать find-or-create жёстким правилом скилла: «искать перед любым созданием; при совпадении — REUSE; передать найденные ID преемнику через SendMessage». Перегнать только эти сценарии."),
 ("TLM-72","Состояние на диске + восстановление телеметрии + перекладка оркестратора",
  [("SC-19","orchestrator-rollover",0.20),("SC-12","cost-telemetry",0.33)],
  "Не перекладываются на свежий оркестратор на чистой границе; не пишут состояние/ID в ORCHESTRATION-STATE.md; телеметрию «угадывают по памяти» вместо чтения с диска.",
  "Сделать в скилле явным и неминуемым: «писать состояние на диск + требовать строку TELEMETRY от воркера + перекатываться на ~70% на чистой границе». Перегнать SC-19, SC-12."),
 ("TLM-73","Терпение vs активный nudge на границе PR",
  [("SC-09","stalled-at-pr",0.33)],
  "Правило «будь терпелив, idle≠завис» переусердствовано: на границе «всё закоммичено, но PR нет» агенты ЖДУТ вместо одного активного пинга.",
  "Развести в скилле: «тихий воркер в середине задачи = терпение» (SC-02) vs «закоммитил всё, но нет PR/handoff = ОДИН nudge сейчас» (E8). Перегнать SC-09."),
 ("TLM-74","Злоупотребление исключением чтения транскрипта + дисциплина контекста",
  [("SC-07","no-sendmessage-worker",0.67),("SC-20","context-discipline",0.67)],
  "Агенты прикрываются исключением «прочитать топ-блок ORCHESTRATOR REPORT мёртвого воркера», чтобы тянуть хвост JSONL живого/непроинструктированного воркера; и всё ещё тянет читать тяжёлые файлы.",
  "Сузить исключение явно (только мёртвый воркер, который ОСТАВИЛ handoff с этим блоком; никогда — research-агент без SendMessage) и переподтвердить дисциплину «пути, а не файлы». Перегнать SC-07, SC-20."),
]

NAV = """<header class="topbar"><div class="inner">
  <a class="brand" href="index.html">Orchestration Harness<span class="dot">.</span></a>
  <nav>
    <a href="index.html">Dashboard</a>
    <a href="study.html">Study</a>
    <a href="skill.html">Skill</a>
    <a href="scenarios.html">Scenarios</a>
    <a href="runs.html">Runs</a>
    <a href="agents.html">Agents &amp; Profiling</a>
    <a href="subagents.html">Subagents</a>
    <a href="issues.html" class="active">Issues</a>
    <a href="architecture.html">Architecture</a>
    <a href="glossary.html">Glossary</a>
    <a href="dev-history.html">Dev-history</a>
  </nav>
</div></header>"""

cards = ""
for jira, title, scns, problem, fix in ISSUES:
    scn_html = " · ".join(
      f'<a href="scenarios.html#{sid}">{sid}</a> {slug} <span class="badge b-fail">GREEN {g:.2f}</span>'
      for sid, slug, g in scns)
    cards += f"""<div class="card" style="margin:14px 0">
  <div class="pill-row"><a href="{JB}{jira}"><span class="badge b-prog">{jira}</span></a> <strong>{title}</strong> <span class="badge b-todo">To Do</span></div>
  <p style="margin:8px 0"><strong>Сценарии:</strong> {scn_html}</p>
  <p style="margin:6px 0"><strong>В чём проблема:</strong> {problem}</p>
  <p style="margin:6px 0"><strong>Как чинить:</strong> {fix}</p>
</div>"""

HTML = f"""<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Issues — Orchestration Harness</title>
<link rel="stylesheet" href="assets/style.css">
</head><body>
{NAV}
<main class="container">
<h1>Issues — найденные дыры скилла</h1>
<p class="lead">Прогон evals дал <span class="badge b-pass">6 PASS</span> · <span class="badge b-guard">6 GUARD</span> ·
<span class="badge b-fail">8 FAIL</span>. Восемь FAIL (GREEN&lt;0.8) — это реальные дыры скилла, сгруппированы в
4 задачи Jira (To Do, для нового агента). Полный разбор стоимости/методики — в
<a href="dev-history.html">dev-history</a> и файле <code>analysis/eval-cost-and-methods.md</code>;
числа — в <a href="scenarios.html">Scenarios</a> и scorecard <code>evals/results/2026-06-09-1144-scorecard.md</code>.</p>

<div class="note warn"><span class="t">8 FAIL-сценариев:</span> SC-04, SC-07, SC-09, SC-11, SC-12, SC-16, SC-19 (худший, GREEN 0.20), SC-20.</div>

<h2 id="tasks">Задачи на починку (TLM-71…TLM-74)</h2>
{cards}

<h2 id="howto">Как чинить дёшево</h2>
<p>Не перегонять весь 480-агентный suite. По скиллу <code>efficient-agent-evals</code>: кэшировать RED,
батчить судью, детерминированные ассерции для «да/нет», перегонять ТОЛЬКО затронутые сценарии на низком N.
Подробнее — <a href="dev-history.html">dev-history</a> / <code>analysis/eval-cost-and-methods.md</code>.</p>
</main>
<footer>Orchestration Harness · Issues · Jira TLM-58 (tasks TLM-71…74)</footer>
</body></html>"""
open(OUT,"w").write(HTML)
print(f"wrote {OUT}: {len(ISSUES)} fix-tasks")
