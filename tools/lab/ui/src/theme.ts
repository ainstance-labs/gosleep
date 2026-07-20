// The whole stylesheet, inlined into every page. No CDN, no font fetch, no external stylesheet:
// the owner opens this from file://, on a plane, and from whatever put the file on his phone.
// Anything that needs the network is a page that is blank exactly when it matters.
//
// NOT "from GitHub's blob view" — that was measured on 2026-07-20 (GSL-100) and is false. GitHub
// serves these pages as application/vnd.github.raw or text/plain, both with X-Content-Type-Options:
// nosniff, which explicitly FORBIDS the browser from treating the file as HTML; Pages is unavailable
// for a private repo on a free plan. GitHub carries the bytes, it does not render them.
//
// ⚠️ NO BACKTICKS ANYWHERE BELOW, including inside comments — this whole file is ONE template
// literal, and a single backtick closes it. This warning already existed further down the file and
// was still walked into during GSL-100 (four tsc parse errors), so it now lives where nobody can
// edit this file without seeing it first.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// GSL-109 (F6): the design pass. The owner opened this dashboard and called it "AI slop". Phase 5
// built data honesty and spent no cycle on how any of it reads, and it showed: eighteen ad-hoc font
// sizes, twelve ad-hoc paddings, seven screens that looked identical at a glance, and a page whose
// LOUDEST element was the banner describing the page rather than anything the page had to say.
//
// What replaced it is a system, not a coat of paint. Everything below draws from four scales
// declared once at the top — type, space, radius, colour — and nothing may invent a value outside
// them. That constraint is the whole product: a number that has to come from a scale cannot drift.
//
// THE COLOUR RULE, which outranks every aesthetic preference in this file:
//
//   ok / warn / alarm / unknown are RESERVED and semantic. They are never decorative, never reused
//   for emphasis, and never carried by hue alone — every one of them ships beside a word (FRESH,
//   STALE, DEAD, unknown, BLOCKER, silent) or a shape (dashed border, filled background). Measured
//   2026-07-20 with the dataviz validator: a traffic-light palette CANNOT clear the categorical
//   colour-blindness gate — red vs green is deuteranopia ΔE 4.2, and the validator's own reference
//   status palette scores 4.1 on the same test. Hue is therefore a SECOND channel here, never the
//   only one. What the palette is held to instead is WCAG contrast, and every one of the five
//   clears 4.5:1 (AA body text) against its own surface in BOTH modes.
//
//   UNKNOWN HAS ITS OWN HUE. This is the change that mattered most. Before GSL-109 "unknown" was
//   painted in --dim — the exact ink used for footnotes and captions — so the single distinction
//   this laboratory exists to draw ("no stopping clock is counting" vs "I cannot read the clock")
//   was rendered as a footnote. It is now magenta: not green, not the grey of disabled text, and
//   deliberately NOT on the green-amber-red axis at all, because unknown is not a grade. Violet was
//   tried first and rejected on measurement, not taste — against the blue used for links it scored
//   ΔE 8.7 (normal vision), below the 15 floor, so the two would have been confusable.
//
//   Dark mode is SELECTED, not flipped. The old dark steps were stock framework defaults at 9.9:1
//   and 10.3:1 against the dark surface — neon on black, on a dashboard whose entire purpose is
//   being read from bed at 04:00. The new steps land at 5.2-5.7:1: still AA, no glare.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const CSS = `
:root{
  color-scheme:light;
  /* Surfaces: three planes, so a card reads as raised without a shadow. */
  --bg:#f7f7f5; --card:#ffffff; --sunken:#f1f1ed;
  --fg:#17171a; --dim:#5f5f5c; --line:#e3e3dd; --line-strong:#c8c8c0;
  /* Reserved status ink. Never decorative. Always paired with a word or a shape. */
  --ok:#0f7a45; --warn:#8f5700; --dead:#a4232b; --unk:#9c2f86; --accent:#2b52c4;
  --ok-soft:#e9f4ee; --warn-soft:#faf1e2; --dead-soft:#fbeaeb; --unk-soft:#f9ecf6;
  /* Type scale — seven steps. Nothing in this file may use a size outside it. */
  --t-xs:.6875rem; --t-sm:.8125rem; --t-md:.9375rem; --t-base:1rem;
  --t-lg:1.25rem; --t-xl:1.75rem; --t-hero:2.5rem;
  /* Space scale — 4px base. Same rule. */
  --s1:.25rem; --s2:.5rem; --s3:.75rem; --s4:1rem; --s5:1.5rem; --s6:2rem; --s7:3rem;
  --r1:.25rem; --r2:.5rem; --r3:.75rem;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --bg:#101012; --card:#1b1b1e; --sunken:#171719;
    --fg:#e8e8e6; --dim:#9a9a96; --line:#2b2b30; --line-strong:#3d3d44;
    --ok:#35a86c; --warn:#c28a24; --dead:#e2665f; --unk:#d075b8; --accent:#8aa8f7;
    --ok-soft:#12241b; --warn-soft:#241d10; --dead-soft:#2a1618; --unk-soft:#251524;
  }
}
*{box-sizing:border-box}
body{margin:0;padding:var(--s4) var(--s4) var(--s7);background:var(--bg);color:var(--fg);
     font:var(--t-base)/1.55 var(--sans);max-width:64rem;margin-inline:auto;
     -webkit-text-size-adjust:100%}

/* ── Masthead: the title and the nav are page CHROME and are drawn as chrome — one quiet band that
   ends in a rule, so the eye crosses it once and lands on the content. Before GSL-109 the nav was a
   bare row of default-blue links that read as a paragraph someone forgot to finish. */
.masthead{margin-bottom:var(--s4);border-bottom:1px solid var(--line);padding-bottom:var(--s2)}
h1{font-size:var(--t-xl);line-height:1.15;letter-spacing:-.015em;font-weight:650;margin:0 0 var(--s3)}
/* The nav MUST wrap. It is rendered as adjacent <a> elements with no whitespace between them
   (<a>Overview</a><a>Timeline</a>...), and inline boxes with no intervening white space have NO
   soft-wrap opportunity — so margin-right produced visible gaps but not a single break point, and
   at phone width the last two links (Cost, Library) sat off-screen, unreachable. Measured on
   2026-07-20 at 390px: nav content 469px inside a 358px column, all 7 links on one line (GSL-100).
   flex+wrap does not depend on the renderer emitting whitespace JSX would swallow anyway, and gap
   replaces the trailing margin — a break opportunity between every pair, by construction.
   GSL-109 keeps flex+wrap untouched and only dresses the items as tabs. */
nav{display:flex;flex-wrap:wrap;gap:var(--s1) var(--s1);margin:0}
nav a{color:var(--dim);text-decoration:none;font-size:var(--t-sm);font-weight:550;
      padding:var(--s1) var(--s2);border-radius:var(--r1);border:1px solid transparent;
      white-space:nowrap}
nav a:hover{color:var(--fg);background:var(--sunken)}
nav a[aria-current="page"]{color:var(--fg);font-weight:700;background:var(--card);
      border-color:var(--line-strong)}
a{color:var(--accent)}
main{display:block}

/* ── Section headings: the only ranking device between the hero and the data. */
h2{font-size:var(--t-xs);text-transform:uppercase;letter-spacing:.09em;color:var(--dim);
   margin:var(--s6) 0 var(--s2);font-weight:700}

/* ── The staleness strip. It is META — it describes the page, not the night — so when the news is
   good it must get out of the way, and Phase 5 had it shouting the same size on all seven screens
   whatever it said. It now scales with what it has to say: FRESH is a hairline whisper, STALE is
   amber, DEAD is filled and loud. That asymmetry is not decoration, it is the honesty rule pointed
   at itself — a page allowed to be quiet when fresh has spent its loudness where it counts.
   The class string stays exactly "stale <grade>": smoke.sh greps for class="stale dead" verbatim.

   ⚠️ THE GRADES ARE SELECTED ON data-grade, NOT ON THE SECOND CLASS, and that is a bug fix, not a
   style. The element carries class="stale <grade>", so the grade rule for "stale" had to be written
   .stale.stale — which is not "an element that is stale AND graded stale", it is .stale written
   twice. It therefore matched EVERY banner at equal specificity to .stale.fresh, and being later in
   source order it won. Measured on the live page 2026-07-20: a FRESH build rendered its banner in
   the WARNING colour, and had done on all seven screens for the whole of Phase 5. Nothing was
   mis-computed — the grade in the markup was right every time — the stylesheet simply could not
   express the distinction it was asked to. A dashboard permanently the colour of caution cannot
   raise caution, so this cost the amber channel its meaning. data-grade is already part of the
   contract asserted by smoke.sh, and matching on it makes the three rules mutually exclusive. */
.stale{border:1px solid var(--line);border-radius:var(--r2);padding:var(--s2) var(--s3);
       margin:0 0 var(--s4);font-size:var(--t-sm);background:var(--card)}
.stale #stale-head{font-weight:700;letter-spacing:.02em}
.stale small{display:block;font-weight:400;color:var(--dim);margin-top:var(--s1);
       font-size:var(--t-xs);line-height:1.5}
.stale::before{content:"";display:inline-block;width:.5rem;height:.5rem;border-radius:50%;
       background:currentColor;margin-right:var(--s2);vertical-align:.05em}
.stale[data-grade="fresh"]{color:var(--ok)}
.stale[data-grade="stale"]{color:var(--warn);border-color:currentColor;background:var(--warn-soft)}
.stale[data-grade="dead"]{color:var(--dead);border:2px solid currentColor;background:var(--dead-soft);
       font-size:var(--t-base)}

/* ── Cards, tiles, tables: one surface treatment, so seven screens read as one product. */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r2);
      padding:var(--s3);margin:var(--s2) 0;font-size:var(--t-md);line-height:1.55}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:var(--s2)}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r2);
     padding:var(--s3)}
/* tabular-nums, not a mono FACE: these are standalone figures, and columns are what needs aligning.
   The mono face is reserved for things that are literally strings — sha, branch, id, raw JSON. */
.kpi b{display:block;font-size:var(--t-lg);line-height:1.15;font-weight:700;
       font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.kpi span{display:block;color:var(--dim);font-size:var(--t-xs);text-transform:uppercase;
       letter-spacing:.06em;font-weight:600;margin-top:var(--s1)}
table{width:100%;border-collapse:collapse;font-size:var(--t-sm)}
td,th{text-align:left;padding:var(--s2) var(--s2);border-bottom:1px solid var(--line);
      vertical-align:top}
th{color:var(--dim);font-weight:700;font-size:var(--t-xs);text-transform:uppercase;
   letter-spacing:.06em;border-bottom:1px solid var(--line-strong);white-space:nowrap}
tr:last-child td{border-bottom:0}
/* A table wider than the phone scrolls, and the scrollbar is left VISIBLE on purpose: an edge that
   silently hides a column is the same defect class as a card that silently clips a token. */
.wrap{overflow-x:auto;scrollbar-width:thin;border-radius:var(--r2)}
code,.mono{font-family:var(--mono);font-size:.9em}
/* Monospace carries the unbreakable strings: raw JSON notes, 40-char sha1s, branch names. With the
   default overflow-wrap they do not wrap — at 390px the orchestrator note was CLIPPED by the card
   edge mid-token ('"context_pct":26,"o'), losing the rest of the sentence with nothing to show a
   reader anything was missing. Silent truncation is the failure mode this laboratory exists to
   refuse, so long tokens break instead. Measured 2026-07-20: card content 833px in a 356px box
   (GSL-100). Tables are exempt — they scroll inside .wrap, where the swipe is discoverable. */
.mono:not(table):not(.wrap *){overflow-wrap:anywhere}
.dim{color:var(--dim)}

/* ── Tags: one shape, many meanings, each meaning also spelled out in the tag's own text. */
.tag{display:inline-block;padding:0 var(--s2);border-radius:var(--r1);border:1px solid var(--line);
     color:var(--dim);font-size:var(--t-xs);font-weight:600;line-height:1.6;white-space:nowrap}
.tag.hook{color:var(--ok);border-color:currentColor}
.tag.emit{color:var(--accent);border-color:currentColor}
.tag.poll{color:var(--warn);border-color:currentColor}
.tag.BLOCKER{color:var(--dead);border-color:currentColor;background:var(--dead-soft);font-weight:700}
.tag.DECISION{color:var(--accent);border-color:currentColor}
.tag.CLARIFY{color:var(--warn);border-color:currentColor}
.tag.FYI{color:var(--dim)}
.tag.pr-open{color:var(--ok);border-color:currentColor}
.tag.pr-merged{color:var(--accent);border-color:currentColor}
.tag.pr-closed{color:var(--dead);border-color:currentColor}

/* ── The autonomy runway (R5.1): the answer to the only question asked at midnight, and therefore
   the largest thing on the morning screen by a clear margin. GSL-109 widened that margin — the
   number now sits at the top of the type scale where nothing else on any screen goes, and the block
   carries the tint of its own grade so the verdict is legible before a word is read.
   The tint follows the grade and never flatters it: there is no state that renders green without
   evidence. */
.runway{border:2px solid currentColor;border-radius:var(--r3);padding:var(--s4);margin:0 0 var(--s4)}
.runway.ok{color:var(--ok);background:var(--ok-soft)}
.runway.warn{color:var(--warn);background:var(--warn-soft)}
.runway.dead{color:var(--dead);background:var(--dead-soft)}
/* "unknown" is NOT a grade and does not borrow one. Dashed, magenta, and unmistakably not amber:
   before GSL-109 an unreadable runway was painted the same colour as "under four hours left", which
   collapsed "I cannot see" into "it is getting late" — the exact conflation runway.tsx spends its
   whole docstring warning against. */
.runway.unk{color:var(--unk);background:var(--unk-soft);border-style:dashed}
.runway-top{display:flex;align-items:baseline;gap:var(--s2) var(--s3);flex-wrap:wrap}
.runway-label{font-size:var(--t-xs);letter-spacing:.16em;font-weight:700}
.runway-big{font-family:var(--mono);font-size:var(--t-hero);font-weight:700;line-height:1.05;
       letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.runway-bind{font-size:var(--t-xs);font-weight:600;border:1px solid currentColor;
       border-radius:var(--r1);padding:0 var(--s2);line-height:1.7}
.runway-say{color:var(--fg);font-size:var(--t-md);margin-top:var(--s3);line-height:1.55;
       max-width:52rem}
.runway-next{color:var(--fg);font-size:var(--t-sm);margin-top:var(--s2);opacity:.85}
.runway-trace{color:var(--dim);font-size:var(--t-sm);margin-top:var(--s3);
       border-top:1px solid currentColor;padding-top:var(--s2)}
.runway-trace summary{cursor:pointer;font-weight:600}
.runway-trace ul{margin:var(--s2) 0 0;padding-left:var(--s4)}
.runway-trace li{margin:var(--s2) 0;color:var(--fg)}
.clocks{display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:var(--s2);
       margin-top:var(--s3)}
.clock{background:var(--card);border:1px solid var(--line);border-radius:var(--r2);
       padding:var(--s2);color:var(--fg);display:flex;flex-direction:column;gap:.1rem}
.clock-axis{color:var(--dim);font-size:var(--t-xs);text-transform:uppercase;letter-spacing:.06em;
       font-weight:600}
.clock-val{font-family:var(--mono);font-size:var(--t-base);font-weight:700;
       font-variant-numeric:tabular-nums}
.clock-gauge{color:var(--dim);font-size:var(--t-xs)}
.clock-kind{font-size:var(--t-xs);text-transform:uppercase;letter-spacing:.05em;color:var(--dim);
       font-weight:600}
.clock-kind.stops{color:var(--dead)} .clock-kind.degrades{color:var(--warn)}
.clock-kind.completes{color:var(--ok)}
/* An unreadable clock must LOOK unreadable — never like a clock reading zero. */
.clock.unknown{border-style:dashed;border-color:var(--unk)}
.clock.unknown .clock-val{color:var(--unk);font-style:italic;font-size:var(--t-sm)}
.clock.exhausted .clock-val{color:var(--dead)}
.clock.clear .clock-val{color:var(--ok)}

/* "unknown" is a first-class value here, not a styling afterthought. It must never look like a
   number and must never look like zero: it is italic, dashed-underlined, and it carries its reason
   in a title. A dashboard that renders a missing source as 0 tells the owner to go to sleep on
   evidence it does not have.
   GSL-109 gave it its own ink. It used to be --dim, which is the colour of captions and footnotes,
   so the most consequential word on the page was drawn as the least consequential thing on it. */
.unknown{color:var(--unk);font-style:italic;font-weight:600;font-size:.9em;
       border-bottom:1px dashed currentColor;cursor:help}
.card.blind{border-style:dashed;border-color:var(--unk);color:var(--dim);font-size:var(--t-sm)}
.stale-note{color:var(--warn);font-weight:600}

/* GSL-95 (F5-S2): the deadline countdown. tabular-nums because it ticks once a second — with
   proportional digits the whole line twitches sideways on every tick, and a number that jitters is a
   number nobody trusts. PAST DUE gets a filled background, not just red text: an expired deadline
   still sitting in the OPEN list means the pulse that was supposed to apply the default never came,
   and that is not a detail to be whispered in a colour someone might be blind to. */
.countdown{font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.countdown.past-due{color:var(--dead);background:var(--dead-soft);
                    padding:0 var(--s1);border-radius:var(--r1)}

/* GSL-96 (F5-S3): the epic rollup and the ages on the board.

   <details> collapses the epic's tasks with no JavaScript at all, which matters twice: the page must
   open from file:// with nothing loaded, and a fold that depends on a script is a fold that is stuck
   shut for the reader whose JS is off. Merged epics ship closed (history); the live one ships open —
   the epic the owner is IN is not a thing he should have to click to see.

   .age is tabular-nums for the same reason .countdown is: it re-computes on open and then ticks. */
.epic{border:1px solid var(--line);border-radius:var(--r2);background:var(--card);
      padding:var(--s2) var(--s3);margin:var(--s2) 0}
.epic > summary{cursor:pointer;line-height:1.8;font-size:var(--t-md)}
.epic[open] > summary{border-bottom:1px solid var(--line);margin-bottom:var(--s2);
      padding-bottom:var(--s2)}
.epic-sum{font-weight:650}
.age{font-variant-numeric:tabular-nums;color:var(--dim);font-size:var(--t-sm)}

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
.filters{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s3);align-items:end;background:var(--sunken);
  border:1px solid var(--line);border-radius:var(--r2);padding:var(--s3);margin:var(--s3) 0}
.filters label{display:flex;flex-direction:column;gap:var(--s1)}
.filters label span{color:var(--dim);font-size:var(--t-xs);text-transform:uppercase;
  letter-spacing:.06em;font-weight:600}
.filters select,.filters input{background:var(--card);color:var(--fg);border:1px solid var(--line-strong);
  border-radius:var(--r1);padding:var(--s1) var(--s2);font:inherit;font-size:var(--t-sm);
  max-width:12rem}
.filters button{background:var(--card);color:var(--dim);border:1px solid var(--line-strong);
  border-radius:var(--r1);padding:var(--s1) var(--s3);font:inherit;font-size:var(--t-sm);
  font-weight:600;cursor:pointer}
.filters button:hover{color:var(--fg);border-color:var(--fg)}
.filter-count{color:var(--dim);font-size:var(--t-sm);margin:var(--s2) 0}
.filter-count.filtered{color:var(--warn);font-weight:700}
.filter-count.none{color:var(--dead);background:var(--dead-soft);border-radius:var(--r1);
  padding:var(--s2) var(--s3);font-weight:700}

/* An incident is marked in the MARKUP, not by a script: the owner reads this on a phone at 02:00,
   and the page must be right wherever the script did NOT run — JS off, a reader that only renders
   the document, any transport that merely hands over the file. (Measured GSL-100: GitHub is not
   even that place — it does not render these pages at all.) A grade this build could not make is
   "unknown" -- dashed, magenta, never green (see src/severity.ts for why that direction is the only
   safe one).
   NOTE: no backticks in here, ever. This file is a TS template literal, and one would close it. */
.tag.sev{text-transform:uppercase;letter-spacing:.05em;font-weight:700}
.tag.sev.incident{color:var(--dead);border-color:currentColor;background:var(--dead-soft)}
.tag.sev.warn{color:var(--warn);border-color:currentColor}
.tag.sev.info{color:var(--dim)}
.tag.sev.unknown{color:var(--unk);border-color:currentColor;border-style:dashed;font-style:italic}
tr.sev-incident td{background:var(--dead-soft)}
tr.sev-incident td:first-child{box-shadow:inset .18rem 0 0 var(--dead)}

/* The build-failed banner. Python writes this one — it is the only markup the view layer does not
   render, because the whole point is that it appears when the view layer could not run at all. It
   must therefore be styled by CSS that is ALREADY in the (stale) page on disk. Loud on purpose:
   a page that cannot say "I am stale" louder than it says its contents is the tasty-lunch wiki. */
.ui-degraded{background:var(--dead-soft);border:2px solid var(--dead);color:var(--dead);
  border-radius:var(--r2);padding:var(--s3) var(--s4);margin:0 0 var(--s4);font-weight:700;
  font-size:var(--t-base)}
.ui-degraded small{display:block;font-weight:400;color:var(--fg);margin-top:var(--s2);
  font-size:var(--t-sm);line-height:1.5}
.ui-degraded code{background:var(--card);border:1px solid var(--line);border-radius:var(--r1);
  padding:0 var(--s1)}

/* GSL-98 (R5.2): the worker card.

   THE AGE IS THE HEADLINE, and the CSS is where that stops being an opinion: .wk-age is set in the
   largest type on the card, above the name, because the PRD's instruction is literal — a worker
   nobody has heard from in an hour is not working, it is silent, and a card that prints the age in a
   footnote has quietly re-ranked the one number the reader is there for.

   Three states and three colours. SILENT is AMBER, never red: red would read as dead, and dead is
   precisely the claim this screen is not entitled to make — a worker thinking inside a long tool call
   and a worker whose process is gone are both silent from here. Amber says "look", which is the most
   the log can honestly ask for. ENDED is neutral grey, because a finished worker is not a problem. */
.wk{background:var(--card);border:1px solid var(--line);border-radius:var(--r2);
  padding:var(--s3);margin:var(--s2) 0}
.wk-top{display:flex;align-items:baseline;gap:var(--s2) var(--s3);flex-wrap:wrap}
.wk-age{font-size:var(--t-xl);font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1;
  letter-spacing:-.015em}
.wk-age small{font-size:var(--t-xs);font-weight:600;color:var(--dim);text-transform:uppercase;
  letter-spacing:.06em;display:block}
.wk-name{font-weight:650;font-family:var(--mono);font-size:var(--t-md)}
.wk.active .wk-age{color:var(--ok)}
.wk.silent .wk-age{color:var(--warn)}
.wk.ended  .wk-age{color:var(--dim)}
.wk.silent{border-color:var(--warn)}
.wk-why{color:var(--dim);font-size:var(--t-sm);margin:var(--s2) 0;line-height:1.5}
.wk-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:var(--s2) var(--s3);
  border-top:1px solid var(--line);padding-top:var(--s2);font-size:var(--t-sm)}
.wk-f span{color:var(--dim);font-size:var(--t-xs);text-transform:uppercase;letter-spacing:.06em;
  display:block;font-weight:600}
.wk-task{margin-top:var(--s2);font-size:var(--t-sm)}
.wk-models{color:var(--warn);font-weight:600}

/* GSL-99 (R5.3): the self-health meters — the page reporting its own rot.

   The colour rule is the point, and it is the same one the runway lives by: UNKNOWN IS NOT GREEN. An
   unreadable meter gets a DASHED border and its own magenta ink — visibly unlike the solid green of a
   meter that has evidence, and since GSL-109 visibly unlike the GREY of one that was never owed
   anything either. An EMPTY meter is grey for the same reason it always was: it has not earned green,
   and a reader scanning for colour must not collect it as one.

   The alarm (three cycles with no handoff) is the only thing here that goes red, and it takes the
   dead-soft background — because at that point it is not a warning, it is the debt the PRD named. */
.sh-m{border-left:.28rem solid var(--line)}
.sh-m.ok{border-left-color:var(--ok)}
.sh-m.warn{border-left-color:var(--warn)}
.sh-m.dead{border-left-color:var(--dead);background:var(--dead-soft)}
.sh-m.dim{border-left-color:var(--line)}
.sh-m.unknown{border-style:dashed;border-left-style:solid;border-left-color:var(--unk)}
.sh-h{font-weight:700;margin-bottom:var(--s2);font-size:var(--t-md)}
.sh-row{font-size:var(--t-sm);margin:var(--s1) 0}
.sh-k{color:var(--dim);font-size:var(--t-xs);text-transform:uppercase;letter-spacing:.06em;
  display:inline-block;min-width:11rem;font-weight:600}
.sh-why{color:var(--dim);font-size:var(--t-sm);line-height:1.5;margin-top:var(--s2)}
.sh-epic{font-size:var(--t-sm);margin:var(--s1) 0;padding-top:var(--s1);
  border-top:1px solid var(--line)}

footer{color:var(--dim);font-size:var(--t-xs);margin-top:var(--s7);border-top:1px solid var(--line);
       padding-top:var(--s3);line-height:1.6}

/* ── 390px. The nav fix of GSL-100 is load-bearing and is NOT touched here: it stays flex+wrap, and
   the only thing this block does is buy back horizontal room so the wrap has somewhere to go. */
@media (max-width:26rem){
  body{padding:var(--s3) var(--s3) var(--s6)}
  h1{font-size:var(--t-lg)}
  .runway{padding:var(--s3)}
  .runway-big{font-size:var(--t-xl)}
  .sh-k{min-width:auto;display:block}
  td,th{padding:var(--s1) var(--s2)}
}
`;
