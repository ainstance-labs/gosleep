#!/usr/bin/env bun
// verify373 — render EN + RU reports from the agentic-report-creator templates.
// Zero-runtime substitution of {{SLOTS}}.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEMPLATE_ROOT = "/Users/romanlidovskyi/.claude/skills/agentic-report-creator/templates";
const OUT = "/Users/romanlidovskyi/Documents/dev/harness/gosleep/docs/reports/verifications/GSL-373/runs/01";
const dashboard = readFileSync(join(TEMPLATE_ROOT, "dashboard.html"), "utf8");
const ruShell = readFileSync(join(TEMPLATE_ROOT, "ru-shell.html"), "utf8");

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const md = (s) => {
  // Very small markdown-lite for our purpose (paragraphs, `code`, **bold**)
  const paragraphs = String(s).trim().split(/\n\s*\n/);
  return paragraphs
    .map((p) => {
      let out = esc(p);
      out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/\n/g, "<br>");
      return `<p>${out}</p>`;
    })
    .join("\n");
};

const findings = [
  {
    number: 1,
    jira: "GSL-373",
    severity: "MAJOR",
    area: "/fleet attribution",
    lane: "functionality",
    title: "LIKE-prefix false attribution — heuristic now default, bug now default",
    en: {
      description:
        "The heuristic JOIN in `/fleet` matches panes by SQL `LIKE a.cwd_project_root || '%'`. Without a trailing path separator, the pattern matches any pane whose `pane_current_path` STARTS WITH the cwd string — including unrelated sibling directories. Two projects `/repo/foo` and `/repo/foobar/…` collide: `LIKE '/repo/foo' || '%'` matches `/repo/foobar/x`.\n\nGSL-359 swapped primacy to make the heuristic the PRIMARY attribution path (previously pidtree was primary and this join only ran as fallback). So a pre-existing correctness bug is now the default — every misattributed row shows up with `attribution='heuristic'` and a wrong `tmux_pane_ref`.\n\n**Live-verified.** Two sessions were seeded in a fake HOME: native at `/…/fake-repo` and observed-only at `/…/fake-repo-sibling`. A tmux pane was inserted with `pane_current_path=/…/fake-repo-sibling/subdir`. `/fleet` attributed the SAME pane to BOTH sessions — the sibling correctly, and the native session wrongly — with `attribution='heuristic'` in both cases (evidence file `05-fleet-with-sibling-pane.json`).\n\n**Fix candidate.** Change the JOIN condition to `LIKE a.cwd_project_root || '/%'` OR add an equality alternate `pane_current_path = a.cwd_project_root OR pane_current_path LIKE a.cwd_project_root || '/%'`. Small, low-risk, restores the intent (\"pane cwd is under session cwd\").",
    },
    ru: {
      description:
        "Эвристический JOIN в `/fleet` матчит tmux-пейны через SQL `LIKE a.cwd_project_root || '%'`. Без разделителя пути шаблон совпадает с любым пейном, чей `pane_current_path` начинается со строки cwd — включая соседние директории. Проекты `/repo/foo` и `/repo/foobar/…` сталкиваются: `LIKE '/repo/foo' || '%'` матчит `/repo/foobar/x`.\n\nGSL-359 сделал эвристику первичным путём атрибуции (раньше первичным был pidtree, а эта эвристика была fallback). То есть уже существующий баг корректности стал по-умолчанию: каждая ошибочно атрибуированная строка приезжает с `attribution='heuristic'` и неверным `tmux_pane_ref`.\n\n**Проверено вживую.** Два сессии засеяны в fake HOME: native `/…/fake-repo` и observed-only `/…/fake-repo-sibling`. Вставлен tmux pane с `pane_current_path=/…/fake-repo-sibling/subdir`. `/fleet` атрибутировал ТОТ ЖЕ pane К ОБЕИМ сессиям — sibling верно, а native ошибочно — оба с `attribution='heuristic'` (файл evidence `05-fleet-with-sibling-pane.json`).\n\n**Правка.** Заменить условие JOIN на `LIKE a.cwd_project_root || '/%'`, либо добавить эквивалентный вариант `pane_current_path = a.cwd_project_root OR pane_current_path LIKE a.cwd_project_root || '/%'`. Небольшая, безопасная правка, восстанавливающая исходное намерение («cwd пейна лежит внутри cwd сессии»).",
    },
    prototype_ref: "GSL-359 primacy swap (README this PR)",
    shipped_ref: "apps/core/src/routes/read.ts:558",
  },
  {
    number: 2,
    jira: "GSL-373",
    severity: "MINOR",
    area: "PR narrative accuracy",
    lane: "functionality",
    title: "PR description claims a 353/1 → 354/0 test-repair; origin/main is 350/0",
    en: {
      description:
        "The commit message for 64d2941 states `bun test apps/core 354/0 (fixed a pre-existing 353/1)`. Re-running the identical command on `origin/main` (worktree at commit 253cb38) yields **350 pass / 0 fail** across 36 files. The PR adds +4 tests and lands **354/0**, but no failing baseline exists to \"fix\" — the narrative overstates what happened.\n\nNot a code defect. Flagged because the same story could be reused later as evidence of test-triage discipline it did not actually demonstrate, or could hide a genuine test-repair somewhere else if this narrative is trusted at face value.",
    },
    ru: {
      description:
        "Сообщение коммита 64d2941 гласит `bun test apps/core 354/0 (fixed a pre-existing 353/1)`. Повторный запуск той же команды на `origin/main` (worktree на коммите 253cb38) даёт **350 pass / 0 fail** по 36 файлам. PR добавляет +4 теста и приземляет **354/0**, но никакого сломанного baseline'а «чинить» не существует — нарратив преувеличивает произошедшее.\n\nЭто не дефект кода. Помечено потому, что тот же текст могут в будущем цитировать как свидетельство дисциплины test-triage, которой на самом деле не было, либо может скрыться настоящий test-repair в другом месте, если этому нарративу верить дословно.",
    },
    shipped_ref: "commit 64d2941 message body",
  },
  {
    number: 3,
    jira: "GSL-373",
    severity: "MINOR",
    area: "sessions lifecycle",
    lane: "functionality",
    title: "Deleted transcripts leave stale rows in agent_sessions (pre-existing; unchanged by this PR)",
    en: {
      description:
        "`foldSessions` upserts a row for every session it sees in the current enumeration snapshot; it never DELETEs or expires a row whose transcript has since been removed from disk. Live-verified: `sess-cold-3.jsonl` was deleted mid-flight; over 12 seconds and 4 collector ticks after the delete, the row `sess-cold-3` remained in `agent_sessions` with its pre-delete `ended_at` (evidence file `06-fleet-final.json`).\n\nPre-existing behavior — introduced with the original sessions collector, not GSL-360. Flagged here so the reader knows it is NOT a regression from the chunked-rotation change, but it also is NOT fixed by this PR. A follow-up ticket to prune agent_sessions rows whose transcript path no longer resolves (or whose last mtime is > N days old) would close the gap.",
    },
    ru: {
      description:
        "`foldSessions` делает upsert для каждой сессии из текущего snapshot'а перечисления; он никогда не DELETE'ит и не помечает истёкшим ряд, чей транскрипт удалён с диска. Проверено вживую: `sess-cold-3.jsonl` был удалён на лету; за 12 секунд и 4 тика коллектора после удаления ряд `sess-cold-3` остался в `agent_sessions` со своим до-удаления `ended_at` (файл evidence `06-fleet-final.json`).\n\nПоведение уже существовавшее — появилось с исходным sessions collector, не GSL-360. Помечено здесь, чтобы читатель знал, что это НЕ регрессия chunked-rotation, но и НЕ починено этим PR. Отдельный тикет на прунинг рядов, чей путь транскрипта больше не резолвится (или чей mtime старше N дней), закроет пробел.",
    },
    shipped_ref: "apps/core/src/observed/sessions.ts:459-615 (foldSessions)",
  },
  {
    number: 4,
    jira: "GSL-373",
    severity: "MINOR",
    area: "chunked rotation invariants",
    lane: "functionality",
    title: "Theoretical starvation: `coldRotationComplete` never flips under sustained cold-list growth",
    en: {
      description:
        "In `sessionsCollectorTick`, the wrap condition is `coldCursor >= cold.length`. If the cold list grows by ≥ `coldChunkSize()` items per tick (e.g. an owner drops 50+ historical transcripts into `~/.claude/projects` every 5 s), the cursor advances by chunkSize but `cold.length` grows just as fast, so the wrap never fires. `coldRotationComplete` stays false forever, `holdFirstSweep` stays true forever, and every emitted event is tagged `backfill=true` indefinitely — the backfill filter on the panel would silently hide live events.\n\nRequires a pathological input (500+ new cold transcripts/second); not observed under normal owner workflows. Test coverage does not exercise a growing cold list — the existing test only checks a static 3-item list. Fix: capture `initialColdSize` on the first tick and wrap when `coldCursor >= initialColdSize`, OR flip `coldRotationComplete=true` once the cursor advances by ≥ initial cold count, whichever comes first.",
    },
    ru: {
      description:
        "В `sessionsCollectorTick` условие оборачивания курсора: `coldCursor >= cold.length`. Если холодный список растёт на ≥ `coldChunkSize()` элементов на тик (например владелец бросает 50+ исторических транскриптов в `~/.claude/projects` каждые 5 с), курсор растёт на chunkSize, но и `cold.length` растёт с той же скоростью — оборачивание не срабатывает. `coldRotationComplete` остаётся false навсегда, `holdFirstSweep` остаётся true навсегда, и все emitted-события помечаются `backfill=true` бесконечно — фильтр backfill на панели молча спрячет живые события.\n\nТребует патологического входа (500+ новых холодных транскриптов/сек); в обычных сценариях владельца не встречается. Тесты не покрывают растущий холодный список — существующий тест проверяет только статичные 3 элемента. Правка: захватить `initialColdSize` на первом тике и оборачивать по `coldCursor >= initialColdSize`, либо флипать `coldRotationComplete=true` как только курсор проходит ≥ начального холодного числа — что бы ни настало раньше.",
    },
    shipped_ref: "apps/core/src/observed/sessions.ts:650-665",
  },
];

const summaryEn = `<div class="card hero">
  <div class="score-ring" style="--score: 78" data-band="warning">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="track" cx="60" cy="60" r="52"></circle>
      <circle class="value" cx="60" cy="60" r="52"></circle>
    </svg>
    <div class="num"><b>78</b><span>/ 100</span></div>
  </div>
  <div>
    <h1>GSL-373 — Observer R2 follow-ups — adversarial verification</h1>
    <p class="lead">PR #361 (branch <code>GSL-373-observer-r2-followups</code>): GSL-359 primacy swap (<code>64d2941</code>) + GSL-360 chunked folds (<code>a600609</code>). All three gates green on the PR tip AND on <code>origin/main</code>: <code>tsc -p apps/core --noEmit</code> clean, <code>bun test apps/core</code> 354/0 (main 350/0, PR adds +4 tests), <code>core-smoke</code> 102/0. Live leg on scratch core :7350 with fake HOME confirmed the primacy swap (heuristic tags), chunked rotation cadence (2 cold per tick), and the backfill hold across the first rotation.</p>
    <div class="verdict-row">
      <span class="level-pill">MERGE — fix follow-up</span>
      <div class="counts">
        <div class="count-tile" data-severity="CRITICAL"><span class="n">0</span><span class="k">CRITICAL</span></div>
        <div class="count-tile" data-severity="MAJOR"><span class="n">1</span><span class="k">MAJOR</span></div>
        <div class="count-tile"><span class="n">3</span><span class="k">MINOR</span></div>
        <div class="count-tile"><span class="n">4</span><span class="k">Total</span></div>
      </div>
    </div>
    <div class="dist" role="img" aria-label="Severity distribution">
      <span class="seg-critical" style="width:0%"></span>
      <span class="seg-major" style="width:25%"></span>
      <span class="seg-minor" style="width:75%"></span>
    </div>
  </div>
</div>`;

const summaryRu = `<div class="card hero">
  <div class="score-ring" style="--score: 78" data-band="warning">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="track" cx="60" cy="60" r="52"></circle>
      <circle class="value" cx="60" cy="60" r="52"></circle>
    </svg>
    <div class="num"><b>78</b><span>/ 100</span></div>
  </div>
  <div>
    <h1>GSL-373 — Observer R2 follow-ups — адверсарная верификация</h1>
    <p class="lead">PR #361 (ветка <code>GSL-373-observer-r2-followups</code>): GSL-359 primacy swap (<code>64d2941</code>) + GSL-360 chunked folds (<code>a600609</code>). Все три гейта зелёные и на tip PR, и на <code>origin/main</code>: <code>tsc -p apps/core --noEmit</code> чист, <code>bun test apps/core</code> 354/0 (main 350/0, PR добавляет +4 теста), <code>core-smoke</code> 102/0. Живой прогон на scratch core :7350 с fake HOME подтвердил primacy swap (теги heuristic), каденс chunked rotation (2 cold на тик) и удержание backfill в течение первой ротации.</p>
    <div class="verdict-row">
      <span class="level-pill">MERGE — fix follow-up</span>
      <div class="counts">
        <div class="count-tile" data-severity="CRITICAL"><span class="n">0</span><span class="k">CRITICAL</span></div>
        <div class="count-tile" data-severity="MAJOR"><span class="n">1</span><span class="k">MAJOR</span></div>
        <div class="count-tile"><span class="n">3</span><span class="k">MINOR</span></div>
        <div class="count-tile"><span class="n">4</span><span class="k">Всего</span></div>
      </div>
    </div>
    <div class="dist" role="img" aria-label="Распределение по серьёзности">
      <span class="seg-critical" style="width:0%"></span>
      <span class="seg-major" style="width:25%"></span>
      <span class="seg-minor" style="width:75%"></span>
    </div>
  </div>
</div>`;

function renderFinding(f, lang) {
  const body = lang === "ru" ? f.ru : f.en;
  const refs = [];
  if (f.prototype_ref) refs.push(`<div class="ref-row"><span class="ref-k">${lang === "ru" ? "Источник" : "Source"}</span><span class="ref-v">${esc(f.prototype_ref)}</span></div>`);
  if (f.shipped_ref) refs.push(`<div class="ref-row"><span class="ref-k">${lang === "ru" ? "Код" : "Shipped"}</span><span class="ref-v"><code>${esc(f.shipped_ref)}</code></span></div>`);
  return `<article class="card finding" id="finding-${f.number}">
  <div class="finding-head">
    <span class="finding-index">${f.number}</span>
    <span class="jira-chip">${esc(f.jira)}</span>
    <span class="badge" data-severity="${f.severity}">${f.severity}</span>
    <span class="area-tag">${esc(f.area)}</span>
    <span class="lane-tag">${f.lane}</span>
  </div>
  <h3>${esc(f.title)}</h3>
  <div class="finding-body">
    ${md(body.description)}
  </div>
  <div class="refs">
    ${refs.join("\n    ")}
  </div>
</article>`;
}

const archNoteEn = `<section aria-labelledby="arch-h">
  <h2 class="section-title" id="arch-h">Verification method + evidence</h2>
  <article class="card arch-note">
    <h3>Method</h3>
    <div class="arch-body">
      <p><strong>1. Independent worktree.</strong> <code>git worktree add .claude/worktrees/verify373 origin/GSL-373-observer-r2-followups</code> + <code>bun install</code>. A second worktree at <code>origin/main</code> for the baseline comparison.</p>
      <p><strong>2. Gates re-run.</strong> On the PR tip: <code>bun x tsc -p apps/core --noEmit</code> clean; <code>bun test apps/core</code> 354 pass / 0 fail; <code>bash tools/lab/tests/core-smoke.sh</code> 102 pass / 0 fail. On <code>origin/main</code>: 350 pass / 0 fail — see finding 2.</p>
      <p><strong>3. Adversarial code review.</strong> Full diff read of <code>apps/core/src/observed/pidtree.ts</code>, <code>apps/core/src/observed/sessions.ts</code>, <code>apps/core/src/routes/read.ts</code>, plus the new tests in <code>apps/core/test/observed.sessions.test.ts</code> and <code>apps/core/test/fleet.projection.test.ts</code>. Attacker mindset: pidtree/heuristic disagreement, PID reuse, dead panes, cwd-prefix false matches, rotation edge cases (0/1/odd counts, sessions appearing/disappearing mid-rotation, starvation), test quality.</p>
      <p><strong>4. Live adversarial leg.</strong> Scratch core booted on port 7350 from the PR worktree (NEVER prod 7331) with a fake <code>HOME=/…/verify373/.artifacts/live/fake-home</code>, tmux collector cadence set to 99999 s (effectively off) so <code>tmux_panes</code> only contains what tests insert, <code>GOSLEEP_OBSERVER_COLD_CHUNK=2</code>, <code>GOSLEEP_OBSERVER_WARM_WINDOW_MS=3600000</code>, sessions cadence 3 s.</p>
    </div>
  </article>
  <article class="card arch-note">
    <h3>Live scenarios exercised</h3>
    <div class="arch-body">
      <p><strong>S1 — heuristic primacy default.</strong> Empty <code>tmux_panes</code>: /fleet returned 8 sessions (2 warm native/observed + 6 cold), all with <code>attribution=null</code> and <code>tmux_pane_ref=null</code>. See <code>assets/01-fleet-initial.json</code>.</p>
      <p><strong>S2 — heuristic attribution works (positive case).</strong> Inserted <code>tmux_panes</code> row for the observed-repo path; <code>/fleet</code> attributed <code>sess-observed-warm</code> to <code>sibling-shell:@0.%77</code> with <code>attribution='heuristic'</code>. See <code>assets/05-fleet-with-sibling-pane.json</code>.</p>
      <p><strong>S3 — cwd-prefix false match (finding 1).</strong> SAME pane row also wrongly attributed to <code>sess-native-live</code> (cwd <code>/…/fake-repo</code>) because the pane path <code>/…/fake-repo-sibling/subdir</code> begins with <code>/…/fake-repo</code>. This is the bug: <code>LIKE cwd_project_root || '%'</code> lacks a path separator boundary. See <code>assets/05-fleet-with-sibling-pane.json</code>.</p>
      <p><strong>S4 — chunked rotation cadence.</strong> With 6 cold + COLD_CHUNK=2, ticks emitted 2 cold <code>session_appeared</code> events each (evidence: <code>SELECT ts, kind FROM observed_events ORDER BY seq</code> — 2 warm at t0, then +2 cold at t0+3s, +2 cold at t0+6s, +2 cold at t0+9s, cursor wraps). Collector <code>last_tick_ms=1</code>. See <code>assets/08-collectors-final.json</code>.</p>
      <p><strong>S5 — session vanishes mid-rotation (finding 3).</strong> Deleted <code>sess-cold-3.jsonl</code>; over 12 s / 4 subsequent ticks the row stayed in <code>agent_sessions</code> with its pre-delete <code>ended_at</code>. Not fixed by this PR (pre-existing). See <code>assets/06-fleet-final.json</code>.</p>
    </div>
  </article>
  <article class="card arch-note">
    <h3>Teardown</h3>
    <div class="arch-body">
      <p>Scratch core killed; port 7350 verified clean via <code>lsof -i :7350 -sTCP:LISTEN</code>. Worktree <code>.claude/worktrees/verify373</code> and baseline worktree <code>.claude/worktrees/verify373-main</code> left in place until this report is filed; the caller may remove them with <code>git worktree remove</code>.</p>
    </div>
  </article>
</section>`;

const archNoteRu = `<section aria-labelledby="arch-h">
  <h2 class="section-title" id="arch-h">Метод верификации + evidence</h2>
  <article class="card arch-note">
    <h3>Метод</h3>
    <div class="arch-body">
      <p><strong>1. Независимый worktree.</strong> <code>git worktree add .claude/worktrees/verify373 origin/GSL-373-observer-r2-followups</code> + <code>bun install</code>. Второй worktree на <code>origin/main</code> для baseline-сравнения.</p>
      <p><strong>2. Прогон гейтов.</strong> На tip PR: <code>bun x tsc -p apps/core --noEmit</code> чистый; <code>bun test apps/core</code> 354 pass / 0 fail; <code>bash tools/lab/tests/core-smoke.sh</code> 102 pass / 0 fail. На <code>origin/main</code>: 350 pass / 0 fail — см. finding 2.</p>
      <p><strong>3. Адверсарное code-review.</strong> Полный diff читался по <code>apps/core/src/observed/pidtree.ts</code>, <code>apps/core/src/observed/sessions.ts</code>, <code>apps/core/src/routes/read.ts</code>, плюс новые тесты в <code>apps/core/test/observed.sessions.test.ts</code> и <code>apps/core/test/fleet.projection.test.ts</code>. Установка атакующего: расхождение pidtree/heuristic, PID reuse, мёртвые пейны, false-match cwd-prefix, edge case ротации (0/1/нечётные, сессии появляются/исчезают на лету, starvation), качество тестов.</p>
      <p><strong>4. Живой адверсарный прогон.</strong> Scratch core запущен на порту 7350 из PR-worktree (НИКОГДА не prod 7331) с fake <code>HOME=/…/verify373/.artifacts/live/fake-home</code>, каденс tmux-коллектора 99999 c (фактически off), чтобы <code>tmux_panes</code> содержала только вставленное тестами; <code>GOSLEEP_OBSERVER_COLD_CHUNK=2</code>, <code>GOSLEEP_OBSERVER_WARM_WINDOW_MS=3600000</code>, каденс sessions 3 c.</p>
    </div>
  </article>
  <article class="card arch-note">
    <h3>Проиграны сценарии</h3>
    <div class="arch-body">
      <p><strong>S1 — heuristic-primacy по умолчанию.</strong> Пустая <code>tmux_panes</code>: /fleet вернул 8 сессий (2 warm native/observed + 6 cold), все с <code>attribution=null</code> и <code>tmux_pane_ref=null</code>. См. <code>assets/01-fleet-initial.json</code>.</p>
      <p><strong>S2 — heuristic-атрибуция работает (позитивный кейс).</strong> Вставлен ряд <code>tmux_panes</code> для observed-репо пути; <code>/fleet</code> атрибутировал <code>sess-observed-warm</code> к <code>sibling-shell:@0.%77</code> с <code>attribution='heuristic'</code>. См. <code>assets/05-fleet-with-sibling-pane.json</code>.</p>
      <p><strong>S3 — cwd-prefix false match (finding 1).</strong> ТОТ ЖЕ ряд пейна также ошибочно атрибуирован к <code>sess-native-live</code> (cwd <code>/…/fake-repo</code>), потому что путь пейна <code>/…/fake-repo-sibling/subdir</code> начинается с <code>/…/fake-repo</code>. Это баг: <code>LIKE cwd_project_root || '%'</code> без разделителя пути. См. <code>assets/05-fleet-with-sibling-pane.json</code>.</p>
      <p><strong>S4 — каденс chunked rotation.</strong> С 6 cold + COLD_CHUNK=2 каждый тик эмиттил 2 cold <code>session_appeared</code> (evidence: <code>SELECT ts, kind FROM observed_events ORDER BY seq</code> — 2 warm в t0, затем +2 cold в t0+3s, +2 cold в t0+6s, +2 cold в t0+9s, курсор оборачивается). У коллектора <code>last_tick_ms=1</code>. См. <code>assets/08-collectors-final.json</code>.</p>
      <p><strong>S5 — сессия исчезает на лету (finding 3).</strong> Удалил <code>sess-cold-3.jsonl</code>; за 12 c / 4 последующих тика ряд остался в <code>agent_sessions</code> со своим до-удаления <code>ended_at</code>. Этим PR не чинится (уже существовало). См. <code>assets/06-fleet-final.json</code>.</p>
    </div>
  </article>
  <article class="card arch-note">
    <h3>Teardown</h3>
    <div class="arch-body">
      <p>Scratch core убит; порт 7350 подтверждён свободным через <code>lsof -i :7350 -sTCP:LISTEN</code>. Worktree <code>.claude/worktrees/verify373</code> и baseline worktree <code>.claude/worktrees/verify373-main</code> оставлены до подачи этого отчёта; caller может удалить их <code>git worktree remove</code>.</p>
    </div>
  </article>
</section>`;

const genAt = "2026-08-16 19:22 UTC";
const shippedAt = "a600609 (PR #361 tip)";

function renderPage(shell, lang, summary, findingsHtml, archHtml, assets) {
  const slots = {
    LANG: lang,
    TITLE: lang === "ru" ? "GSL-373 — верификация R2" : "GSL-373 — Observer R2 verification",
    SUBTITLE: lang === "ru" ? "PR #361 — независимый адверсарный run 01" : "PR #361 — independent adversarial run 01",
    DATE: "2026-08-16",
    EPIC: "GSL-373",
    ASSETS_PATH: assets,
    SUMMARY_HTML: summary,
    FINDINGS_HTML: findingsHtml,
    ARCHITECTURE_HTML: archHtml,
    AUDITOR: "verify-373 (independent adversarial verifier)",
    SHIPPED_AT: shippedAt,
    GENERATED_AT: genAt,
  };
  let out = shell;
  for (const [k, v] of Object.entries(slots)) out = out.split(`{{${k}}}`).join(v);
  return out;
}

const findingsEn = findings.map((f) => renderFinding(f, "en")).join("\n");
const findingsRu = findings.map((f) => renderFinding(f, "ru")).join("\n");

mkdirSync(join(OUT, "ru"), { recursive: true });
writeFileSync(join(OUT, "index.html"), renderPage(dashboard, "en", summaryEn, findingsEn, archNoteEn, "assets/"));
writeFileSync(join(OUT, "ru", "index.html"), renderPage(ruShell, "ru", summaryRu, findingsRu, archNoteRu, "../assets/"));

console.log("Wrote:", join(OUT, "index.html"));
console.log("Wrote:", join(OUT, "ru", "index.html"));
