// The whole stylesheet, inlined into every page. No CDN, no font fetch, no external stylesheet:
// the owner opens this from file://, on a plane, and from GitHub's blob view on a phone. Anything
// that needs the network is a page that is blank exactly when it matters.
export const CSS = `
:root{--bg:#fbfbfa;--fg:#1a1a19;--dim:#6b6b68;--line:#e3e3e0;--card:#fff;
      --ok:#1a7f4b;--warn:#a4600a;--dead:#a51d24;--accent:#3b5bdb;--dead-soft:#fdeaea}
@media (prefers-color-scheme:dark){
  :root{--bg:#131315;--fg:#e8e8e6;--dim:#8f8f8b;--line:#2a2a2e;--card:#1b1b1e;
        --ok:#4ade80;--warn:#fbbf24;--dead:#f87171;--accent:#8ba4ff;--dead-soft:#2a1618}}
*{box-sizing:border-box}
body{margin:0;padding:1rem;background:var(--bg);color:var(--fg);
     font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
     max-width:60rem;margin-inline:auto}
h1{font-size:1.35rem;margin:.2rem 0}
h2{font-size:1rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);
   margin:1.8rem 0 .6rem;font-weight:600}
a{color:var(--accent)}
.stale{border-radius:.5rem;padding:.7rem .9rem;margin:.8rem 0;font-weight:600;
       border:1px solid currentColor}
.stale.fresh{color:var(--ok)} .stale.stale{color:var(--warn)} .stale.dead{color:var(--dead)}
.stale small{display:block;font-weight:400;color:var(--dim);margin-top:.2rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:.6rem;
      padding:.8rem .9rem;margin:.5rem 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.5rem}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:.7rem .8rem}
.kpi b{display:block;font-size:1.5rem;line-height:1.2}
.kpi span{color:var(--dim);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}
table{width:100%;border-collapse:collapse;font-size:.86rem}
td,th{text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em}
.wrap{overflow-x:auto}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em}
.tag{display:inline-block;padding:.05rem .4rem;border-radius:.3rem;border:1px solid var(--line);
     color:var(--dim);font-size:.72rem}
.tag.hook{color:var(--ok);border-color:currentColor}
.tag.emit{color:var(--accent);border-color:currentColor}
.tag.poll{color:var(--warn);border-color:currentColor}
footer{color:var(--dim);font-size:.78rem;margin-top:2.5rem;border-top:1px solid var(--line);
       padding-top:.8rem}

/* The autonomy runway (R5.1). It is the first thing on the morning screen and the largest thing on
   it, because it is the only question the owner actually has at midnight. */
.runway{border:2px solid currentColor;border-radius:.7rem;padding:.9rem 1rem;margin:.9rem 0}
.runway.ok{color:var(--ok)} .runway.warn{color:var(--warn)} .runway.dead{color:var(--dead)}
.runway-top{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap}
.runway-label{font-size:.75rem;letter-spacing:.12em;font-weight:700}
.runway-big{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.7rem;font-weight:800}
.runway-bind{font-size:.8rem;font-weight:600;border:1px solid currentColor;border-radius:.4rem;
  padding:.1rem .45rem}
.runway-say{color:var(--fg);font-size:.86rem;margin-top:.5rem;line-height:1.5}
.runway-next{color:var(--dim);font-size:.82rem;margin-top:.4rem}
.runway-trace{color:var(--dim);font-size:.8rem;margin-top:.6rem}
.runway-trace summary{cursor:pointer;font-weight:600}
.runway-trace li{margin:.45rem 0;color:var(--fg)}
.clocks{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:.4rem;
  margin-top:.7rem}
.clock{background:var(--card);border:1px solid var(--line);border-radius:.45rem;padding:.4rem .5rem;
  color:var(--fg);display:flex;flex-direction:column;gap:.1rem}
.clock-axis{color:var(--dim);font-size:.68rem;text-transform:uppercase;letter-spacing:.05em}
.clock-val{font-family:ui-monospace,Menlo,monospace;font-size:1rem}
.clock-gauge{color:var(--dim);font-size:.72rem}
.clock-kind{font-size:.62rem;text-transform:uppercase;letter-spacing:.04em;color:var(--dim)}
.clock-kind.stops{color:var(--dead)} .clock-kind.degrades{color:var(--warn)}
.clock-kind.completes{color:var(--ok)}
/* An unreadable clock must LOOK unreadable — never like a clock reading zero. */
.clock.unknown{border-style:dashed}
.clock.unknown .clock-val{color:var(--dim);font-style:italic;font-size:.85rem}
.clock.exhausted .clock-val{color:var(--dead);font-weight:700}
.clock.clear .clock-val{color:var(--ok)}

/* "unknown" is a first-class value here, not a styling afterthought. It must never look like a
   number and must never look like zero: it is muted, italic, and it carries its reason in a title.
   A dashboard that renders a missing source as 0 tells the owner to go to sleep on evidence it does
   not have. */
.unknown{color:var(--dim);font-style:italic;font-weight:400;font-size:.82em;
  border-bottom:1px dotted var(--dim);cursor:help}
.card.blind{border-style:dashed;color:var(--dim);font-size:.85rem}
.tag.BLOCKER{color:var(--dead);border-color:currentColor;font-weight:700}
.tag.DECISION{color:var(--accent);border-color:currentColor}
.tag.CLARIFY{color:var(--warn);border-color:currentColor}
.tag.FYI{color:var(--dim)}
.stale-note{color:var(--warn);font-weight:600}
/* GSL-95 (F5-S2): the deadline countdown. tabular-nums because it ticks once a second — with
   proportional digits the whole line twitches sideways on every tick, and a number that jitters is a
   number nobody trusts. PAST DUE gets a filled background, not just red text: an expired deadline
   still sitting in the OPEN list means the pulse that was supposed to apply the default never came,
   and that is not a detail to be whispered in a colour someone might be blind to. */
.countdown{font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.countdown.past-due{color:var(--dead);background:var(--dead-soft);
                    padding:.05rem .35rem;border-radius:.3rem}
.dim{color:var(--dim)}

/* GSL-96 (F5-S3): the epic rollup and the ages on the board.

   <details> collapses the epic's tasks with no JavaScript at all, which matters twice: the page must
   open from file:// with nothing loaded, and a fold that depends on a script is a fold that is stuck
   shut for the reader whose JS is off. Merged epics ship closed (history); the live one ships open —
   the epic the owner is IN is not a thing he should have to click to see.

   .age is tabular-nums for the same reason .countdown is: it re-computes on open and then ticks. */
.epic{border:1px solid var(--line);border-radius:.6rem;background:var(--card);
      padding:.5rem .7rem;margin:.4rem 0}
.epic > summary{cursor:pointer;line-height:1.9}
.epic[open] > summary{border-bottom:1px solid var(--line);margin-bottom:.4rem;padding-bottom:.3rem}
.epic-sum{font-weight:600}
.age{font-variant-numeric:tabular-nums;color:var(--dim);font-size:.85rem}
.tag.pr-open{color:var(--ok);border-color:currentColor}
.tag.pr-merged{color:var(--accent);border-color:currentColor}
.tag.pr-closed{color:var(--dead);border-color:currentColor}

/* GSL-97 (R5.3): the client-side filter, and the severity of a timeline row.

   [hidden] is declared LOUDLY because the filter hides table rows, and a UA stylesheet's
   [hidden]{display:none} loses to any rule that sets display on a tr. A filter whose hidden rows stay
   visible is merely broken; the rule below is what keeps it from being that.

   .filter-count is the sentence that says what is NOT on screen, and it is styled to be seen, not to
   be tasteful. When rows are hidden it turns amber; when the filter hides EVERY row it goes red and
   filled — because an empty table under a forgotten filter is the exact silhouette of a quiet night,
   and that mistaken read is the one this whole feature exists to prevent.

   .filters ships hidden and the client reveals it (client.ts): no dead controls for a reader with JS
   off, and none either for a reader whose island failed to parse. */
[hidden]{display:none!important}
.filters{display:flex;flex-wrap:wrap;gap:.5rem .8rem;align-items:end;background:var(--card);
  border:1px solid var(--line);border-radius:.6rem;padding:.6rem .8rem;margin:.6rem 0}
.filters label{display:flex;flex-direction:column;gap:.15rem}
.filters label span{color:var(--dim);font-size:.68rem;text-transform:uppercase;letter-spacing:.05em}
.filters select,.filters input{background:var(--bg);color:var(--fg);border:1px solid var(--line);
  border-radius:.35rem;padding:.25rem .4rem;font:inherit;font-size:.82rem;max-width:12rem}
.filters button{background:var(--bg);color:var(--dim);border:1px solid var(--line);
  border-radius:.35rem;padding:.3rem .7rem;font:inherit;font-size:.8rem;cursor:pointer}
.filters button:hover{color:var(--fg);border-color:var(--fg)}
.filter-count{color:var(--dim);font-size:.82rem;margin:.3rem 0 .6rem}
.filter-count.filtered{color:var(--warn);font-weight:600}
.filter-count.none{color:var(--dead);background:var(--dead-soft);border-radius:.35rem;
  padding:.35rem .6rem;font-weight:700}

/* An incident is marked in the MARKUP, not by a script: the owner reads this page from GitHub's blob
   view on a phone at 02:00, where nothing runs. A grade this build could not make is "unknown" --
   dashed, muted, never green (see src/severity.ts for why that direction is the only safe one).
   NOTE: no backticks in here, ever. This file is a TS template literal, and one would close it. */
.tag.sev{text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.tag.sev.incident{color:var(--dead);border-color:currentColor;background:var(--dead-soft)}
.tag.sev.warn{color:var(--warn);border-color:currentColor}
.tag.sev.info{color:var(--dim)}
.tag.sev.unknown{color:var(--dim);border-style:dashed;font-style:italic}
tr.sev-incident td{background:var(--dead-soft)}
tr.sev-incident td:first-child{box-shadow:inset .18rem 0 0 var(--dead)}

nav{margin:.4rem 0 .2rem;line-height:2}
nav a{margin-right:.9rem}
nav a[aria-current="page"]{font-weight:700;text-decoration:none;border-bottom:2px solid currentColor}

/* The build-failed banner. Python writes this one — it is the only markup the view layer does not
   render, because the whole point is that it appears when the view layer could not run at all. It
   must therefore be styled by CSS that is ALREADY in the (stale) page on disk. Loud on purpose:
   a page that cannot say "I am stale" louder than it says its contents is the tasty-lunch wiki. */
.ui-degraded{background:var(--dead-soft);border:2px solid var(--dead);color:var(--dead);
  border-radius:.5rem;padding:.9rem 1rem;margin:0 0 1rem;font-weight:700;font-size:1.02rem}
.ui-degraded small{display:block;font-weight:400;color:var(--fg);margin-top:.35rem;font-size:.82rem;
  line-height:1.5}
.ui-degraded code{background:var(--card);border:1px solid var(--line);border-radius:.25rem;
  padding:.05rem .3rem}

/* GSL-98 (R5.2): the worker card.

   THE AGE IS THE HEADLINE, and the CSS is where that stops being an opinion: .wk-age is set in the
   largest type on the card, above the name, because the PRD's instruction is literal — a worker
   nobody has heard from in an hour is not working, it is silent, and a card that prints the age in a
   footnote has quietly re-ranked the one number the reader is there for.

   Three states and three colours. SILENT is AMBER, never red: red would read as dead, and dead is
   precisely the claim this screen is not entitled to make — a worker thinking inside a long tool call
   and a worker whose process is gone are both silent from here. Amber says "look", which is the most
   the log can honestly ask for. ENDED is neutral grey, because a finished worker is not a problem. */
.wk{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:.7rem .85rem;
  margin:.5rem 0}
.wk-top{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap}
.wk-age{font-size:1.45rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
.wk-age small{font-size:.62rem;font-weight:600;color:var(--dim);text-transform:uppercase;
  letter-spacing:.05em;display:block}
.wk-name{font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.wk.active .wk-age{color:var(--ok)}
.wk.silent .wk-age{color:var(--warn)}
.wk.ended  .wk-age{color:var(--dim)}
.wk.silent{border-color:var(--warn)}
.wk-why{color:var(--dim);font-size:.8rem;margin:.45rem 0 .55rem;line-height:1.5}
.wk-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:.35rem .9rem;
  border-top:1px solid var(--line);padding-top:.5rem;font-size:.84rem}
.wk-f span{color:var(--dim);font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;
  display:block}
.wk-task{margin-top:.5rem;font-size:.85rem}
.wk-models{color:var(--warn);font-weight:600}

/* GSL-99 (R5.3): the self-health meters — the page reporting its own rot.

   The colour rule is the point, and it is the same one the runway lives by: UNKNOWN IS NOT GREEN. An
   unreadable meter gets a DASHED border and muted italic type — visibly unlike the solid green of a
   meter that has evidence. An EMPTY meter (nothing was ever owed) is grey for the same reason: it has
   not earned green either, and a reader scanning for colour must not collect it as one.

   The alarm (three cycles with no handoff) is the only thing here that goes red, and it takes the
   dead-soft background — because at that point it is not a warning, it is the debt the PRD named. */
.sh-m{border-left:.28rem solid var(--line)}
.sh-m.ok{border-left-color:var(--ok)}
.sh-m.warn{border-left-color:var(--warn)}
.sh-m.dead{border-left-color:var(--dead);background:var(--dead-soft)}
.sh-m.dim{border-left-color:var(--line)}
.sh-m.unknown{border-style:dashed;border-left-style:solid;border-left-color:var(--dim)}
.sh-h{font-weight:600;margin-bottom:.45rem}
.sh-row{font-size:.9rem;margin:.2rem 0}
.sh-k{color:var(--dim);font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;
  display:inline-block;min-width:11rem}
.sh-why{color:var(--dim);font-size:.79rem;line-height:1.5;margin-top:.5rem}
.sh-epic{font-size:.88rem;margin:.25rem 0;padding-top:.25rem;border-top:1px solid var(--line)}
`;
