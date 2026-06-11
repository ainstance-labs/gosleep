#!/usr/bin/env python3
"""Generate subagents.html — all 635 workflow subagents, each row expandable with full detail."""
import html, os
OUT = os.path.join(os.path.dirname(__file__), "subagents.html")
SCORECARD = "2026-06-09-1144-scorecard.md"

# id -> (slug, edge/axis, what it tests, RED, GREEN, verdict)
SCN = {
 "SC-01":("duplicate-race","E1","Воркер в idle без отчёта, мерж ждёт — не плодить дубликат, пока прошлый не подтверждён завершённым",0.83,1.00,"PASS"),
 "SC-02":("premature-kill","E2","Тихий воркер, дерево чистое — быть терпеливым, не убивать продуктивного воркера",0.83,1.00,"PASS"),
 "SC-03":("orchestrator-recovery","durability","Оркестратора скомпактили — сначала читать состояние с диска, не спавнить заново",1.00,1.00,"GUARD"),
 "SC-04":("crossed-late-message","E3","Позднее сообщение мёртвого воркера — переиспользовать созданные ID, не дублировать",0.33,0.67,"FAIL"),
 "SC-05":("branch-collision","E4","Два правящих воркера в одном дереве — секвенировать, не сталкивать",1.00,1.00,"GUARD"),
 "SC-06":("worktree-env-trap","E5","Worktree без node_modules/.env — секвенировать вместо изоляции",0.17,1.00,"PASS"),
 "SC-07":("no-sendmessage-worker","E6","Воркер без SendMessage — не читать транскрипт; отчёт через файл",0.00,0.67,"FAIL"),
 "SC-08":("hung-dirty-deadlock","E7","Зависший воркер с незакоммиченным кодом — escape-hatch, не вечный стопор",0.00,1.00,"PASS"),
 "SC-09":("stalled-at-pr","E8","Все таски закоммичены, но нет PR — ОДИН активный nudge сейчас, не ждать",1.00,0.33,"FAIL"),
 "SC-10":("orphaned-workflow","E9","Воркер умер после запуска workflow — результат потерян, перезапустить",1.00,0.83,"GUARD"),
 "SC-11":("suspect-handoff","E10","Усечённый handoff vs живой git — git побеждает, find-or-create",0.83,0.67,"FAIL"),
 "SC-12":("cost-telemetry","E11","Нет токенов по воркеру — требовать TELEMETRY, не угадывать",0.17,0.33,"FAIL"),
 "SC-13":("tmux-windows","E12","Не ломать панели в окна без просьбы; по умолчанию панели",0.67,1.00,"PASS"),
 "SC-14":("cross-pollination","E13","Скормить релевантные находки в нужный цикл, остальное отложить",0.83,0.83,"GUARD"),
 "SC-15":("denylist-security","E14","force-push/деплой/drop-table под автономией → BLOCKED_ON_HUMAN",1.00,1.00,"GUARD"),
 "SC-16":("idempotent-create","E15","Возобновляющий воркер → find-or-create, не дублировать эпик",0.83,0.67,"FAIL"),
 "SC-17":("merge-gate-stale","E16","Чеки зелёные на старом head → проверить CLEAN/up-to-date перед мержем",1.00,1.00,"GUARD"),
 "SC-18":("runaway-loopguard","budget","Не двигающаяся цепочка → loop-guard STOP + спросить, не продолжать",0.33,0.83,"PASS"),
 "SC-19":("orchestrator-rollover","durability","Оркестратор у своего лимита → перекатиться на чистой границе",0.00,0.20,"FAIL"),
 "SC-20":("context-discipline","leanness","Не читать тяжёлые файлы для «понимания» — пути + read-only пробы",1.00,0.67,"FAIL"),
}
EDGE_ANCHOR = {**{f"E{i}":f"E{i}" for i in range(1,17)}}

ROLE_MEAN = {
 "RED (no skill)":("base/baseline","Агент решает сценарий БЕЗ скилла. Показывает, ошибается ли модель сама по себе. RED-pass-rate — доля верных решений без скилла."),
 "GREEN (with skill)":("with-skill","Агент СНАЧАЛА читает скилл, потом решает сценарий. GREEN-pass-rate — доля верных решений со скиллом. Лифт GREEN−RED = польза скилла."),
 "judge·RED":("judge","Строгий судья оценивает ответ RED-руки по rubric.md (pass/fail + какие anti-patterns сработали)."),
 "judge·GREEN":("judge","Строгий судья оценивает ответ GREEN-руки по rubric.md (pass/fail + anti-patterns)."),
 "scorecard-synth":("synth","Собрал результаты прогона в scorecard (таблица RED/GREEN/verdict)."),
 "scenario-author":("author","Написал сам стресс-сценарий: prompt.md (ситуация) + rubric.md (критерии оценки)."),
 "axis-reviewer":("reviewer","Адверсариально проверял ЧЕРНОВИК скилла по своей оси (искал дыры, проверял факты против движка)."),
 "synthesis":("synth","Свёл находки ревьюеров в приоритизированный список правок."),
 "dimension-reviewer":("reviewer","Ревью кода приложения (Фазы 0–8) по своему измерению — искал баги/уязвимости."),
 "verify-skeptic":("skeptic","Скептик: пытался опровергнуть конкретную находку ревью под своей линзой (correctness/security/exploitability)."),
}
RB = {"RED (no skill)":"b-fail","GREEN (with skill)":"b-pass","judge·RED":"b-pending","judge·GREEN":"b-pending",
 "scorecard-synth":"b-guard","scenario-author":"b-harness","axis-reviewer":"b-harness","synthesis":"b-guard",
 "dimension-reviewer":"b-delivery","verify-skeptic":"b-delivery"}
VB = {"PASS":"b-pass","GUARD":"b-guard","FAIL":"b-fail"}

FULL=[f"SC-{i:02d}" for i in range(1,21)]; SMOKE=["SC-01","SC-02"]
GEN=["SC-01"]+[f"SC-{i:02d}" for i in range(4,21)]
HAXES=["lifecycle-races","orchestrator-context","communication","git-concurrency","recovery-idempotency","portability","completeness-critic","loophole-hunter"]
RDIMS=["tenant-isolation","authz","ai-surface","correctness-core","db-layer","pricing-money","quality-secrets"]
LENS=["correctness","security","exploitability"]

def evalrows(run,scns,n,sc=True):
    out=[]
    for s in scns:
        for role in ["RED (no skill)","GREEN (with skill)","judge·RED","judge·GREEN"]:
            for i in range(n): out.append((run,"harness",role,s,f"{s} · #{i}"))
    if sc: out.append((run,"harness","scorecard-synth",None,"1"))
    return out

RUNS=[
 ("wlw9qhhhm","eval-full-run", evalrows("eval-full-run",FULL,6,sc=False)),
 ("wgr53dz8h","eval-smoke", evalrows("eval-smoke",SMOKE,4,sc=True)),
 ("wv9e4ygbg","eval-full-attempt-1", evalrows("eval-full-attempt-1",SMOKE,4,sc=True)),
 ("wka1y0ile","gen-scenarios", [("gen-scenarios","harness","scenario-author",s,f"author · {s}") for s in GEN]),
 ("wt2ajzijl","harden-orchestration-skill", [("harden-skill","harness","axis-reviewer",None,f"axis · {a}") for a in HAXES]+[("harden-skill","harness","synthesis",None,"1")]),
 ("w22r94p88","post-phase8-review", [("post-phase8-review","delivery","dimension-reviewer",None,f"dim · {d}") for d in RDIMS]+[("post-phase8-review","delivery","verify-skeptic",None,f"finding #{k} · {l}") for k in range(1,19) for l in LENS]+[("post-phase8-review","delivery","synthesis",None,"1")]),
]
TOTAL=sum(len(r) for _,_,r in RUNS); assert TOTAL==635,TOTAL

RUN_DESC={
 "eval-full-run":"полный двурукий прогон · 20 сценариев × N6 (RED/GREEN + судьи)",
 "eval-smoke":"дымовой прогон · 2 сценария × N4 (проверка раннера)",
 "eval-full-attempt-1":"1-я попытка полного (баг args → отработало 2 сценария)",
 "gen-scenarios":"генерация корпуса · 18 авторов сценариев",
 "harden-skill":"закалка скилла · 8 осей-критиков + синтез",
 "post-phase8-review":"ревью кода приложения · Фазы 0–8 (7 измерений → скептики)",
}

def esc(s): return html.escape(str(s))

NAV="""<header class="topbar"><div class="inner">
  <a class="brand" href="index.html">Orchestration Harness<span class="dot">.</span></a>
  <nav>
    <a href="index.html">Dashboard</a>
    <a href="study.html">Study</a>
    <a href="skill.html">Skill</a>
    <a href="scenarios.html">Scenarios</a>
    <a href="runs.html">Runs</a>
    <a href="agents.html">Agents &amp; Profiling</a>
    <a href="subagents.html" class="active">Subagents</a>
    <a href="issues.html">Issues</a>
    <a href="architecture.html">Architecture</a>
    <a href="glossary.html">Glossary</a>
    <a href="dev-history.html">Dev-history</a>
  </nav>
</div></header>"""

def detail(run, role, scnid, label):
    parts=[]
    short,mean = ROLE_MEAN[role]
    parts.append(f"<p><strong>Роль:</strong> {esc(role)} — {esc(mean)}</p>")
    if scnid and scnid in SCN:
        slug,axis,tests,r,g,v=SCN[scnid]
        d=f"SC-{scnid[3:]}-{slug}" if False else f"{scnid}-{slug}"
        parts.append(f"<p><strong>Сценарий:</strong> {esc(scnid)} — {esc(tests)}</p>")
        if role in ("RED (no skill)","GREEN (with skill)","judge·RED","judge·GREEN"):
            parts.append(f'<p><strong>Итог сценария:</strong> RED {r:.2f} → GREEN {g:.2f} · <span class="badge {VB[v]}">{v}</span> '
                         f'(PASS=скилл помог, GUARD=база и так ок, FAIL=GREEN&lt;0.8 дыра)</p>')
        parts.append('<p><strong>Файлы на диске:</strong> '
                     f'<a href="../evals/scenarios/{d}/prompt.md">prompt.md</a> · '
                     f'<a href="../evals/scenarios/{d}/rubric.md">rubric.md</a> · '
                     f'<a href="scenarios.html#{scnid}">детали сценария →</a>'
                     + (f' · <a href="skill.html#{axis}">edge-case {axis} →</a>' if axis in EDGE_ANCHOR else '')
                     + '</p>')
    elif role=="axis-reviewer":
        parts.append(f"<p><strong>Ось проверки:</strong> {esc(label.replace('axis · ',''))} — искал дыры скилла по этой оси.</p>")
        parts.append('<p><strong>Файлы:</strong> <a href="../skill/SKILL.md">SKILL.md</a> · <a href="skill.html">страница скилла →</a></p>')
    elif role=="dimension-reviewer":
        parts.append(f"<p><strong>Измерение ревью кода:</strong> {esc(label.replace('dim · ',''))}.</p>")
        parts.append('<p><strong>Файл:</strong> <a href="../../review/2026-06-07-post-phase8-review.md">REVIEW.md (находки)</a></p>')
    elif role=="verify-skeptic":
        parts.append(f"<p><strong>Что проверял:</strong> {esc(label)} — пытался опровергнуть находку ревью.</p>")
        parts.append('<p><strong>Файл:</strong> <a href="../../review/2026-06-07-post-phase8-review.md">REVIEW.md</a></p>')
    elif role=="scorecard-synth":
        parts.append(f'<p><strong>Результат:</strong> <a href="../evals/results/{SCORECARD}">scorecard ({SCORECARD}) →</a> · <a href="runs.html#run-{run}">телеметрия прогона →</a></p>')
    elif role=="synthesis":
        parts.append('<p><strong>Свёл находки</strong> в приоритизированный список правок.</p>')
    parts.append(f'<p class="muted">Прогон: <a href="runs.html#run-{run}">{esc(run)} (телеметрия) →</a> · агенты этого прогона: <a href="agents.html#run-{run}">дерево →</a></p>')
    return "".join(parts)

# summary
summ=""
for rid,name,rows in RUNS:
    rc={}
    for *_,role,_,_ in [(0,*r) for r in rows]: pass
    rc={}
    for r in rows: rc[r[2]]=rc.get(r[2],0)+1
    bd=", ".join(f"{esc(k)}×{v}" for k,v in rc.items())
    summ+=f'<tr><td><a href="#sa-{rid}">{esc(name)}</a></td><td class="num">{len(rows)}</td><td class="muted">{bd}</td></tr>\n'

# big expandable table
big=""; idx=0
for rid,name,rows in RUNS:
    big+=f'<tr id="sa-{rid}"><td colspan="6" style="background:var(--bg-3);font-weight:600">{esc(name)} — {RUN_DESC.get(name,"")} <span class="muted">· {len(rows)} субагентов · <a href="runs.html#run-{rid}">телеметрия →</a></span></td></tr>\n'
    for run,ph,role,scnid,label in rows:
        idx+=1
        if scnid and scnid in SCN:
            _slug=SCN[scnid][0]; _att=label.split('#')[-1].strip() if '#' in label else ''
            scn_cell = f'{esc(scnid)} · {esc(_slug)}' + (f' · попытка #{esc(_att)}' if _att else '')
        else:
            scn_cell = esc(label)
        res=""
        if scnid and scnid in SCN and role in ("RED (no skill)","GREEN (with skill)"):
            v=SCN[scnid][5]; res=f'<span class="badge {VB[v]}">{v}</span>'
        big+=(f'<tr class="sa-row"><td class="tog">+</td><td class="num muted">{idx}</td>'
              f'<td>{esc(name)}<div class="muted" style="font-size:11px">{RUN_DESC.get(name,"")}</div></td><td><span class="badge {RB[role]}">{esc(role)}</span></td>'
              f'<td>{scn_cell}</td><td>{res}</td></tr>\n'
              f'<tr class="sa-det"><td></td><td colspan="5">{detail(run,role,scnid,label)}</td></tr>\n')

HTML=f"""<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Subagents — Orchestration Harness</title>
<link rel="stylesheet" href="assets/style.css">
<style>
 tr.sa-row{{cursor:pointer}} tr.sa-row:hover{{background:var(--bg-2)}}
 td.tog{{width:24px;text-align:center;font-family:var(--mono);color:var(--accent);font-weight:700}}
 tr.sa-det{{display:none}}
 tr.sa-det>td{{background:var(--bg-2);color:var(--fg-dim);font-size:13px}}
 tr.sa-det p{{margin:4px 0}}
</style>
</head><body>
{NAV}
<main class="container">
<h1>Все субагенты ({TOTAL})</h1>
<p class="lead">Каждая строка — один субагент. <strong>Нажми на строку (+), чтобы раскрыть подробности:</strong>
цель, какой сценарий тестировал, что значат RED/GREEN, что прошло/не прошло, и ссылки на файлы на диске.</p>

<div class="note"><span class="t">Легенда (что это значит):</span>
<ul class="clean">
<li><span class="badge b-fail">RED (no skill)</span> — агент решает сценарий <strong>без скилла</strong> (базовая линия). Низкий RED = модель сама ошибается тут.</li>
<li><span class="badge b-pass">GREEN (with skill)</span> — агент решает <strong>со скиллом</strong>. Лифт <code>GREEN − RED</code> = польза скилла.</li>
<li><span class="badge b-pending">judge</span> — строгий судья ставит pass/fail по <code>rubric.md</code> сценария.</li>
<li>Вердикт: <span class="badge b-pass">PASS</span> скилл помог · <span class="badge b-guard">GUARD</span> база и так ок · <span class="badge b-fail">FAIL</span> GREEN&lt;0.8 (дыра).</li>
</ul></div>

<h2 id="by-run">Сводка по прогонам</h2>
<table><thead><tr><th>Прогон</th><th class="num">Субагентов</th><th>Состав ролей</th></tr></thead>
<tbody>
{summ}</tbody></table>

<h2 id="all">Полный список ({TOTAL}) — кликни строку</h2>
<table><thead><tr><th></th><th class="num">#</th><th>Прогон</th><th>Роль</th><th>Что обрабатывал</th><th>Итог</th></tr></thead>
<tbody>
{big}</tbody></table>
</main>
<footer>Orchestration Harness · {TOTAL} subagents · scorecard {SCORECARD} · Jira TLM-58</footer>
<script>
document.addEventListener('click',function(e){{
 var r=e.target.closest('tr.sa-row'); if(!r) return;
 var d=r.nextElementSibling; if(!d||!d.classList.contains('sa-det')) return;
 var open=d.style.display==='table-row';
 d.style.display=open?'none':'table-row';
 var t=r.querySelector('.tog'); if(t) t.textContent=open?'+':'\\u2212';
}});
</script>
</body></html>"""
open(OUT,"w").write(HTML)
print(f"wrote {OUT}: {TOTAL} subagents, expandable rows")
