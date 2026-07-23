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
// GSL-133 (T1 of epic GSL-111): tokens and frame. The owner called this dashboard "AI slop" TWICE
// — the second time ninety minutes after the GSL-109 design pass closed. GSL-109 was a sanitation
// job and it succeeded as one (eighteen font sizes down to seven, twelve ad-hoc paddings onto a
// 4px grid, two real defects found). But the complaint was never about tidiness, it was about the
// visual LANGUAGE, and GSL-109 kept the language and tidied inside it.
//
// So this pass does not come from taste. Every number below is copied from docs/design/
// ui-redesign-spec.md, which derives them from two reference products read at source — Mastra
// Studio and Supabase — and validates the palette with the dataviz contrast validator rather than
// by eye. Where the spec states a value, this file states the same value. Where a question of
// size, colour, spacing or alignment arises, the answer is in the spec, not in this file's author.
//
// THREE RULES OUTRANK EVERY OTHER PREFERENCE HERE (spec section 1):
//
//   1. INSTRUMENT, NOT PRESENTATION. Meaning is carried by a dense table and a number. Chrome —
//      masthead, nav, banners, footer — is quieter than data, always, with no exceptions.
//
//   2. COLOUR IS EARNED BY JUDGEMENT ONLY. A value that grades something gets status ink; metadata
//      (provenance, artefact kind, model name, PR state, question type) is neutral. Before this
//      pass twelve provenance badges were coloured and repeated down all 200 timeline rows — a
//      status colour worn by a non-status, which is the dataviz anti-pattern that empties the
//      channel of meaning for the values that do grade something.
//
//   3. LOUDNESS IS PROPORTIONAL TO ALARM. A screen with nothing to report is silent. A saturated
//      fill and a thickened edge are earned by "dead" and "incident" and by nothing else.
//
// WHAT THE PALETTE IS HELD TO. Status hue CANNOT clear a categorical colour-blindness gate — red
// and green converge under deuteranopia by physics, and the validator's own reference status
// palette scores no better (CVD 4.1 against ours at 2.9) while FAILING contrast where ours passes
// with margin. So hue is a SECOND channel here, never the only one: every status ships beside a
// word out of the data (FRESH, STALE, DEAD, unknown, BLOCKER, silent). What the palette IS held to
// is WCAG contrast, and every role clears 4.5:1 against every surface it can land on, in BOTH
// themes, with the lightness of the five statuses deliberately spread (light .44 to .545, dark .72
// to .86) so that where hue is lost, brightness still separates them.
//
// UNKNOWN IS NOT A GRADE and keeps its own hue off the green-amber-red axis. "Nothing is counting
// down" and "I cannot read the clock" are different sentences; painting them alike was the defect
// GSL-109 found, and it is not being reintroduced.
//
// MAXIMUM FONT WEIGHT IN THIS FILE IS 500. There is no 600 and no 700 anywhere below. Both
// reference products are measurably built this way (Supabase has no bold class at all: strong is
// font-medium). Hierarchy is built from size and colour, which is why it survives at 390px where
// weight alone would not.
//
// DARK IS DECLARED TWICE, on purpose (spec section 4.6): once under prefers-color-scheme and once
// under :root[data-theme="dark"]. Without the attribute the dark theme cannot be photographed
// without changing an OS setting, and that is not a hypothetical — one of the four GSL-109
// acceptance screenshots is named "desktop-dark" and came out LIGHT, so nobody ever saw the dark
// desktop at all. No theme switch appears in the interface: the attribute is set from outside by
// whatever takes the screenshot, and no new visible text is added anywhere.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const CSS = `
/* ── Tokens. Four scales and a palette, declared once. Nothing below may invent a value outside
   them — that constraint is the product: a number that has to come from a scale cannot drift.
   Surface INDEX MEANS ROLE, NOT LIGHTNESS: in a light theme "higher" cannot be brighter than
   white, so the raised levels there are darker. Mastra's light ramp is non-monotonic for the
   same reason. */
:root{
  color-scheme:light;
  --bg:#f5f7f9; --card:#ffffff; --sunken:#f2f3f6; --raised:#eaebee;
  --fg:#1a1b1c; --dim:#5a5b5d; --muted:#68696b;
  --line:#d6d7da; --line-subtle:#e3e4e7; --line-strong:#7f8083;
  --accent:#0068a5; --accent-solid:#0077bc;
  --ok:#007835;      --ok-soft:#e6fae9;      --ok-border:#b1dfb9;
  --warn:#976500;    --warn-soft:#fff1df;    --warn-border:#eccb9e;
  --dead:#902828;    --dead-soft:#ffefee;    --dead-border:#fcc0ba;
  --info:#0068a5;    --info-soft:#eaf5ff;    --info-border:#abd7fd;
  --unk:#8e4d9d;     --unk-soft:#fceeff;     --unk-border:#e6c3ee;
  --neutral:#68696b; --neutral-soft:#f2f3f6; --neutral-border:#cfd1d4;
  --t-xs:.6875rem; --t-sm:.75rem; --t-md:.8125rem; --t-base:.875rem;
  --t-lg:1rem; --t-xl:1.25rem; --t-hero:1.75rem;
  --s1:.25rem; --s2:.5rem; --s3:.75rem; --s4:1rem; --s5:1.5rem; --s6:2rem; --s7:3rem;
  --r1:.25rem; --r2:.375rem; --r3:.5rem; --r-pill:999px;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
}
/* The dark set appears twice below and the two copies MUST stay identical. The media query carries
   the system preference; the attribute exists so the theme can be forced when a screenshot is
   taken. :not([data-theme="light"]) lets an explicit light override win over the system. */
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  color-scheme:dark;
  --bg:#0d0e10; --card:#151618; --sunken:#1d1e20; --raised:#28292b;
  --fg:#f0f2f4; --dim:#b6b7ba; --muted:#97989b;
  --line:#343537; --line-subtle:#28292b; --line-strong:#737477;
  --accent:#71bfff; --accent-solid:#006eae;
  --ok:#7cdd93;      --ok-soft:#1e2d21;      --ok-border:#295233;
  --warn:#ffc673;    --warn-soft:#322717;    --warn-border:#5e4216;
  --dead:#f07f77;    --dead-soft:#372321;    --dead-border:#683834;
  --info:#71bfff;    --info-soft:#1c2b37;    --info-border:#244b6b;
  --unk:#d58fe5;     --unk-soft:#302432;     --unk-border:#583b5f;
  --neutral:#97989b; --neutral-soft:#28292b; --neutral-border:#46484a;
}}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0d0e10; --card:#151618; --sunken:#1d1e20; --raised:#28292b;
  --fg:#f0f2f4; --dim:#b6b7ba; --muted:#97989b;
  --line:#343537; --line-subtle:#28292b; --line-strong:#737477;
  --accent:#71bfff; --accent-solid:#006eae;
  --ok:#7cdd93;      --ok-soft:#1e2d21;      --ok-border:#295233;
  --warn:#ffc673;    --warn-soft:#322717;    --warn-border:#5e4216;
  --dead:#f07f77;    --dead-soft:#372321;    --dead-border:#683834;
  --info:#71bfff;    --info-soft:#1c2b37;    --info-border:#244b6b;
  --unk:#d58fe5;     --unk-soft:#302432;     --unk-border:#583b5f;
  --neutral:#97989b; --neutral-soft:#28292b; --neutral-border:#46484a;
}

*{box-sizing:border-box}
/* Interface base is 13px (--t-md), which is Mastra's text-ui-smd — a step they introduced
   specifically for dense tooling. Prose steps UP to 14px; it is the only thing that does. */
body{margin:0;padding:var(--s5) var(--s5) var(--s7);background:var(--bg);color:var(--fg);
     font:400 var(--t-md)/1.5 var(--sans);max-width:64rem;margin-inline:auto;
     -webkit-text-size-adjust:100%}
main{display:block}
a{color:var(--accent)}
/* MAXIMUM WEIGHT IN THE SYSTEM IS 500 (spec section 3.3). A bare <b> defaults to the UA's bold,
   which is 700 — louder than anything this language allows, and it sits in the runway prose, the
   self-health meters and every worker field. The element STAYS a <b> (smoke.sh:2058 requires
   #sh-data-age to be one); only its weight is capped. Hierarchy is carried by size and colour, so
   500 is enough to mark <b> as emphatic without shouting. */
b{font-weight:500}
:focus-visible{outline:2px solid var(--accent-solid);outline-offset:2px}

/* ── Masthead: title and nav are page CHROME and are drawn as chrome — one quiet band ending in a
   rule, so the eye crosses it once and lands on the content.
   TABS, NOT PILLS (spec section 9, owner decision q-2026-07-20-008). The reference products put a
   sidebar here; a sidebar would mean restructuring the header, and nav+flex-wrap is contract (see
   the greps in section 10.4) as well as the GSL-100 invariant at 390px. So the TECHNIQUE is
   borrowed rather than the shape: the active item is marked by DENSITY OF BACKGROUND, not by
   colour. It is deliberately not accent-coloured — blue means "link" on these pages, and the page
   you are already on must not read as the most important link on it.

   ⚠️ THE NAV RULE BELOW MUST STAY ONE LINE, with no space before its brace and none after the
   colon of the wrap property. smoke.sh:2236 greps it verbatim with a positive control, and grep is
   line-based. Splitting it, adding a space, or listing another selector first all FAIL — as
   does expressing the same behaviour as display:grid or flex-flow:row wrap. It is load-bearing for
   more than the grep: the renderer emits <a>Overview</a><a>Timeline</a> with no whitespace between
   the elements, and inline boxes with no intervening white space have NO soft-wrap opportunity at
   all, so at 390px Cost and Library sat off-screen and unreachable (measured GSL-100). */
.masthead{margin-bottom:var(--s5);border-bottom:1px solid var(--line);padding-bottom:var(--s3)}
h1{font:500 var(--t-xl)/1.3 var(--sans);color:var(--fg);margin:0 0 var(--s3)}
nav{display:flex;flex-wrap:wrap;gap:var(--s1) var(--s1);margin:0}
nav a{padding:var(--s1) var(--s2);border-radius:var(--r2);border:0;
      font:400 var(--t-md)/1.5 var(--sans);color:var(--dim);text-decoration:none;white-space:nowrap}
nav a:hover{background:var(--sunken);color:var(--fg)}
nav a[aria-current="page"]{background:var(--raised);color:var(--fg);font-weight:500}

/* ── Section headings. 16px, sentence case, weight 500. GSL-109 had h2 at 11px uppercase, which
   put the section label at the same size as a column header and left the page with no middle rank
   between the title and the data. */
h2{font:500 var(--t-lg)/1.4 var(--sans);color:var(--fg);margin:var(--s6) 0 var(--s3)}

/* ── Prose. There is a lot of explanatory text on these screens and it cannot be deleted (it is
   asserted verbatim), so it is SUBORDINATED instead: one step down in ink, one measure of 68ch,
   and no italic or bold added by CSS. Italic that exists inside the source strings stays there;
   this file does not add emphasis of its own. */
p,.card p,.blind{font:400 var(--t-base)/1.5 var(--sans);color:var(--dim);max-width:68ch}

/* ── The staleness strip. It is META — it describes the page, not the night — so when the news is
   good it gets out of the way. It scales with what it has to say: fresh is a hairline whisper,
   stale is amber ink on the same quiet card, dead is filled and thick-edged. Only dead earns the
   fill: that is rule 3, pointed at the banner itself.
   The class string stays exactly "stale <grade>" (smoke.sh:314 greps class="stale dead").

   ⚠️ GRADES ARE SELECTED ON data-grade, NOT on the second class. The element carries
   class="stale <grade>", so a rule for the stale grade would have to be written .stale.stale —
   which is not "stale AND graded stale", it is .stale written twice, matching EVERY banner at
   equal specificity and winning on source order. Measured 2026-07-20: a FRESH build rendered its
   banner in the warning colour on all seven screens for the whole of Phase 5. data-grade is
   already contract, and matching on it makes the three rules mutually exclusive.
   ⚠️ client.ts:59 rewrites this element's className WHOLESALE on re-grade — no layout class may
   live here, which is why everything below hangs off the id, the attribute or the element type. */
.stale{border:1px solid var(--line);border-radius:var(--r2);padding:var(--s2) var(--s3);
       margin:0 0 var(--s4);font:400 var(--t-md)/1.5 var(--sans);background:var(--card)}
.stale #stale-head{font-weight:500}
.stale small{display:block;font-weight:400;color:var(--muted);margin-top:var(--s1);
       font-size:var(--t-xs);line-height:1.5}
.stale::before{content:"";display:inline-block;width:.5rem;height:.5rem;border-radius:50%;
       background:currentColor;margin-right:var(--s2);vertical-align:.05em}
.stale[data-grade="fresh"]{color:var(--ok)}
.stale[data-grade="stale"]{color:var(--warn);border-color:var(--warn-border)}
.stale[data-grade="dead"]{color:var(--dead);border:2px solid var(--dead-border);
       background:var(--dead-soft)}
/* GSL-115: the no-JS caveat. It is drawn ONLY when scripting is off (the browser renders <noscript>
   content in that case and nothing otherwise), so it never competes with the live re-grade. Quiet by
   construction — dim ink on the same card, a hairline above it — because it is a caveat, not an alarm:
   the news it carries is "this line cannot update", not "something is wrong". Colour is inherited from
   the grade on the parent, so it is left as --dim here and not tinted. */
.stale noscript{display:block;margin-top:var(--s1);padding-top:var(--s1);
       border-top:1px solid var(--line-subtle);color:var(--dim);
       font-size:var(--t-xs);line-height:1.5}

/* ── Cards, tiles, grid: one surface treatment, so seven screens read as one product. No shadows
   anywhere — neither reference product uses them on a dashboard surface; separation is done by a
   hairline and a surface level, which survives dark mode where a shadow does not. */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r2);
      padding:var(--s3) var(--s4);margin:var(--s2) 0;font:400 var(--t-md)/1.5 var(--sans)}
.grid{display:grid;gap:var(--s2);grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.kpi,.clock{background:var(--card);border:1px solid var(--line);border-radius:var(--r2);
      padding:var(--s3) var(--s4)}
/* THE VALUE IS ALWAYS --fg. A KPI number is a number; the judgement about it is carried by the
   badge beside it, which also spells the judgement out in a word. tabular-nums even on the hero
   step, against the general advice for large single figures: tickAges() repaints .age and .wk-age
   ONCE A SECOND, and proportional digits make the whole line twitch sideways on every tick. */
.kpi b,.clock-val{display:block;font:500 var(--t-hero)/1.15 var(--mono);
      font-variant-numeric:tabular-nums;color:var(--fg)}
/* :not(.unknown) is load-bearing: the Unknown marker is a span too, and it sits INSIDE .kpi b —
   an unqualified ".kpi span" (0,1,1) out-specifies ".unknown" (0,1,0) and repaints the one value
   the spec singles out (8.3: unknown keeps --unk at value size) as an 11px muted caption. */
.kpi span:not(.unknown),.clock-axis{display:block;font:400 var(--t-xs)/1.5 var(--sans);text-transform:uppercase;
      letter-spacing:.06em;color:var(--muted);margin-top:var(--s1)}
.clocks{display:grid;gap:var(--s2);grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
      margin-top:var(--s3)}
.clock{display:flex;flex-direction:column;gap:var(--s1)}
.clock-gauge{font:400 var(--t-sm)/1.5 var(--mono);color:var(--dim)}
.clock-kind{font:400 var(--t-xs)/1.5 var(--sans);text-transform:uppercase;letter-spacing:.06em;
      color:var(--muted)}
.clock-kind.stops{color:var(--dead)} .clock-kind.degrades{color:var(--warn)}
.clock-kind.completes{color:var(--ok)}
/* An unreadable clock must not look like a clock reading zero — but the marker is ink and a border
   colour, NOT a dashed edge: dashes are catalogued noise and this pass removes every one of them.
   Only the value is tinted; exhausted and clear no longer tint theirs, because a number carrying
   status ink is exactly what rule 2 forbids. */
.clock.unknown{border-color:var(--unk-border)}
.clock.unknown .clock-val{color:var(--unk)}

/* ── Tables. Thirteen of them, 589 rows across seven screens: this is the instrument, everything
   else serves it.
   NO ZEBRA — hover only. Measured, not preferred: neither reference product stripes any table
   component; both separate rows with a hairline and light only hover and selection. There is a
   second reason specific to us: timeline rows already carry SEMANTIC background tinting by
   severity, and a stripe would be indistinguishable from an incident.
   Row height lands at ~32px, denser than either reference (48px, 40-56px) and matching Supabase's
   own dense data grid at 28px. Justified by load: we put 200 rows on a screen, not 20. */
table{width:100%;border-collapse:collapse;font:400 var(--t-md)/1.5 var(--sans);
      background:var(--card)}
/* ⚠️ break-word HERE, not anywhere, and the difference is load-bearing rather than stylistic.
   Both values wrap a word too long for its line, which is the behaviour section 6.4 asks a cell
   for. Only "anywhere" ALSO drops the cell's min-content width to a single character, and a table
   layout then squeezes every narrow column to nothing: measured on timeline with the untruncated
   details in place, the 8-character timestamp 17:33:06 broke across THREE lines and vcs.push
   across two, turning the 32px row this section specifies into a 90px one. The long values still
   wrap — they are the only things wide enough to need it — and the mono-block rule below keeps the
   literal spelling that smoke.sh:2237 greps for.
   The max-width is the other half of the same fix and it is a MEASURE, in the same family as the
   68ch given to prose. Without it the auto table layout hands a column carrying a 500-character
   value a share proportional to that length: measured on timeline, the table ran 1253px inside a
   976px wrapper, so 277px of every long row sat behind the right edge, reachable only by a swipe
   nobody is told about. Capped, the table is exactly its container width, nothing is hidden, and
   the long values spend their length on extra LINES instead of extra WIDTH — which is what
   section 6.4 means by wrapping rather than clipping. */
td{padding:6px 10px;text-align:left;vertical-align:top;overflow-wrap:break-word;max-width:34ch;
      border-bottom:1px solid var(--line-subtle)}
th{padding:4px 10px;font:500 var(--t-xs)/1.5 var(--sans);text-transform:uppercase;
      letter-spacing:.06em;color:var(--muted);text-align:left;background:var(--sunken);
      border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:top}
tr:last-child td{border-bottom:0}
/* Scoped to td so the header row, which is a tr of th, does not light up under the pointer. */
tr:hover td{background:var(--sunken)}
/* Numbers right, tabular, mono — a column is right-aligned when its values are quantities that get
   compared by size. Keys and identifiers are mono too but stay LEFT: nobody compares a sha by
   magnitude, they scan for it down the first characters. */
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono)}
/* A table wider than the phone scrolls, and the scrollbar is left VISIBLE on purpose: an edge that
   silently hides a column is the same defect class as a card that silently clips a token. */
.wrap{overflow-x:auto;scrollbar-width:thin;border-radius:var(--r2)}

/* ── Code and mono. Two different cases that must not be dressed alike.
   INLINE code is an identifier inside a sentence: tinted background, NO border — a box drawn round
   a word tears the line apart vertically. Its size is relative (.9em) rather than a token, and
   that is deliberate: a mono face looks larger than a proportional one at equal size, so .9em
   optically matches it whether the surrounding text is 14px prose or a 13px cell.
   A MONO BLOCK is a quotation — raw JSON, a provenance line, a jq one-liner, an 892-character list
   of names. It sits one surface level DOWN so it reads as an inset rather than another panel, and
   its ink is --dim because a long technical string set in the primary colour outweighs the numbers
   the screen was opened for.
   ⚠️ NO overflow-x HERE. Horizontal scrolling inside a card hides the tail of the line behind the
   edge, and "the mono card silently cut the JSON" is precisely what cycle 61 was written up for.
   The wrap-anywhere declaration below breaks mid-token, including mid-path and mid-hash, and that
   is the wanted behaviour. Its exact spelling is greped by smoke.sh:2237 with a positive control;
   word-break:break-all would behave comparably and FAIL the gate. */
code{font-family:var(--mono);font-size:.9em;background:var(--sunken);border-radius:var(--r1);
      padding:0 var(--s1);color:var(--fg)}
.mono{font-family:var(--mono)}
.card.mono,pre{background:var(--sunken);border:1px solid var(--line);border-radius:var(--r2);
      padding:var(--s3);font:400 var(--t-sm)/1.55 var(--mono);color:var(--dim);
      overflow-wrap:anywhere}
/* Tables are exempt: they wrap on td above and scroll inside .wrap, and the two mechanisms must
   not fight. The shape of this selector is contract — do not simplify it. */
.mono:not(table):not(.wrap *){overflow-wrap:anywhere}
.dim{color:var(--dim)}
/* GSL-136 (spec 6.5): the absence placeholder in a table (the em-dash in cost, an empty title in
   library) is painted muted, one step quieter than dim, so a hole does not read as a datum. */
.muted{color:var(--muted)}

/* ── Badges. ONE SHAPE for all of them: translucent fill, coloured ink, coloured hairline. Neither
   reference product ships a solid-filled status badge, and at ~18px high this is a label, not a
   button. Mono, and deliberately NO text-transform: what these badges contain is identifiers out
   of the data (hook:PostToolUse, merge-commit, claude-opus-4-8) which uppercasing only degrades.
   Values that arrive already capitalised (DECISION, MERGED) stay that way because that is how the
   data has them.

   THE DEFAULT IS NEUTRAL, and that is the whole of rule 2 expressed in one declaration. Metadata
   families — provenance (hook:*, emit, poll-fill), artefact kind, model name, epic membership,
   question type, PR state, question status — carry the base rule and NOTHING else. They are not
   unstyled by omission; neutral IS their specification (spec section 7.2), and it is what removes
   twelve coloured badges from every one of 200 timeline rows. */
.tag{display:inline-flex;align-items:center;gap:var(--s1);padding:1px 6px;
      border-radius:var(--r-pill);border:1px solid var(--neutral-border);
      background:var(--neutral-soft);color:var(--neutral);
      font:500 var(--t-xs)/1.45 var(--mono);white-space:nowrap}
/* Only these grade something, so only these are coloured. */
.tag.ok{background:var(--ok-soft);color:var(--ok);border-color:var(--ok-border)}
.tag.warn{background:var(--warn-soft);color:var(--warn);border-color:var(--warn-border)}
.tag.dead,.tag.BLOCKER{background:var(--dead-soft);color:var(--dead);
      border-color:var(--dead-border)}
.tag.unknown,.tag.pr-unknown{background:var(--unk-soft);color:var(--unk);
      border-color:var(--unk-border);text-decoration:none}
.tag.sev.incident{background:var(--dead-soft);color:var(--dead);border-color:var(--dead-border)}
.tag.sev.warn{background:var(--warn-soft);color:var(--warn);border-color:var(--warn-border)}
.tag.sev.unknown{background:var(--unk-soft);color:var(--unk);border-color:var(--unk-border)}
/* The Tasks-board status chip (spec 7.2: Done -> ok, To Do -> warn, In Progress -> info). Done and
   To Do ride the generic .tag.ok/.tag.warn pairs above; info exists ONLY under the st scope — a
   bare .tag.info would also match the timeline's "tag sev info", the one default 7.2 keeps neutral. */
.tag.st.info{background:var(--info-soft);color:var(--info);border-color:var(--info-border)}
/* sev=info is left NEUTRAL although --info exists: info stands in 181 of 200 timeline rows, so
   colouring it would colour the screen. A default is not highlighted; warn and incident earn it.
   The --info role stays in the palette for a lone informational badge elsewhere. */

/* ── The bare status classes (GSL-124). The markup has carried these for two phases with no rule
   behind them, so a Self-health WARNING was printed in the ink of ordinary body text — the page
   could not raise its voice about itself. The fix required is to PAINT them, not to delete them:
   the markup already says the right thing.
   ⚠️ SCOPED TO span ON PURPOSE. meterClass() returns the same bare strings for three different
   places: an inline span inside a sentence, a badge (.tag ok), and the WHOLE METER CARD
   (class="card sh-m ok"). An unscoped .ok would tint an entire card of prose in status ink, which
   is rule 2 broken by the very fix meant to serve it. Cards take their state on the left edge
   below; badges take it above; only the inline spans take ink. */
span.ok{color:var(--ok)}
span.warn{color:var(--warn)}
span.dead{color:var(--dead)}

/* ── Absence, rendered ONE way. It used to have two forms — magenta italic with a dashed underline,
   and a bare em dash in the cost tables — so a reader met two appearances of one phenomenon.
   Italic is dropped (it leaked onto sibling labels wherever the class sat on a container), the
   dotted underline stays as the second channel that does not depend on hue, and the tooltip stays.
   The underline is scoped to span so it cannot propagate down into a card's children. */
.unknown{color:var(--unk);font-style:normal;cursor:help}
span.unknown{text-decoration:underline dotted;text-underline-offset:2px}
/* A caveat is not an alarm: what this screen cannot see is stated quietly, on the inset surface,
   without borrowing amber from the states that earned it. */
.card.blind{background:var(--sunken);border:1px solid var(--line);color:var(--dim)}
.stale-note{color:var(--dim)}

/* ── The autonomy runway: the answer to the only question asked at midnight. It was the single
   loudest source of the slop complaint — a full-width purple fill, a dashed border, and a 40px
   figure over five lines of italic prose, which is two catalogued anti-patterns at once.
   What carries meaning now is the VALUE and the badge beside it, never the backdrop. The block is
   an ordinary card, and its left edge grows louder strictly as the news gets worse: ok is a
   hairline nobody notices, warn and unk thicken it, and only DEAD earns a fill.
   ⚠️ unk and warn must remain two distinct values — smoke.sh:957 asserts NEGATIVELY that an
   unreadable runway is not marked warn. Merging the two tones would be a lie the gate catches. */
.runway{background:var(--card);border:1px solid var(--line);border-left:2px solid var(--line);
      border-radius:var(--r3);padding:var(--s4);margin:0 0 var(--s4)}
.runway.ok{border-left-color:var(--line)}
.runway.ok .runway-big{color:var(--ok)}
.runway.warn{border-left-color:var(--warn)}
.runway.warn .runway-big{color:var(--warn)}
.runway.dead{border-left-color:var(--dead);background:var(--dead-soft)}
.runway.dead .runway-big{color:var(--dead)}
.runway.unk{border-left-color:var(--unk)}
.runway.unk .runway-big{color:var(--unk)}
.runway-top{display:flex;align-items:baseline;gap:var(--s2) var(--s3);flex-wrap:wrap}
.runway-label{font:500 var(--t-xs)/1.5 var(--sans);text-transform:uppercase;letter-spacing:.06em;
      color:var(--muted)}
.runway-big{font:500 var(--t-hero)/1.15 var(--mono);font-variant-numeric:tabular-nums}
.runway-bind{font:500 var(--t-xs)/1.45 var(--mono);border:1px solid var(--neutral-border);
      background:var(--neutral-soft);color:var(--neutral);border-radius:var(--r-pill);
      padding:1px 6px;white-space:nowrap}
.runway-say,.runway-next{font:400 var(--t-base)/1.5 var(--sans);color:var(--dim);max-width:68ch}
.runway-say{margin-top:var(--s3)}
.runway-next{margin-top:var(--s2)}
.runway-trace{color:var(--muted);font-size:var(--t-sm);margin-top:var(--s3);
      border-top:1px solid var(--line-subtle);padding-top:var(--s2)}
.runway-trace summary{cursor:pointer;font-weight:500}
.runway-trace ul{margin:var(--s2) 0 0;padding-left:var(--s4)}
.runway-trace li{margin:var(--s2) 0;color:var(--dim)}

/* GSL-95: the deadline countdown. tabular-nums because it ticks once a second, and a number that
   jitters sideways is a number nobody trusts. The running value is --fg: it is a figure, not a
   verdict. PAST DUE is the verdict, and it takes ink and a fill — an expired deadline still in the
   OPEN list means the pulse that should have applied the default never came. */
.countdown{font-weight:500;color:var(--fg);font-variant-numeric:tabular-nums}
.countdown.past-due{color:var(--dead);background:var(--dead-soft);padding:0 var(--s1);
      border-radius:var(--r1)}

/* GSL-96: the epic rollup and the ages on the board. <details> collapses with no JavaScript at
   all, which matters twice — the page opens from file:// with nothing loaded, and a fold that
   depends on a script is a fold stuck shut for a reader with JS off. */
.epic{border:1px solid var(--line);border-radius:var(--r2);background:var(--card);
      padding:var(--s2) var(--s3);margin:var(--s2) 0}
.epic > summary{cursor:pointer;line-height:1.5;font-size:var(--t-md)}
.epic[open] > summary{border-bottom:1px solid var(--line-subtle);margin-bottom:var(--s2);
      padding-bottom:var(--s2)}
.epic-sum{font-weight:500}
.age{font-variant-numeric:tabular-nums;color:var(--muted);font-size:var(--t-sm)}

/* GSL-97: the client-side filter, and the severity of a timeline row.
   ⚠️ [hidden] is declared LOUDLY and MUST NOT BE REMOVED: the filter hides rows by setting
   r.hidden, and a UA stylesheet's [hidden]{display:none} loses to any rule that sets display on a
   tr. A filter whose hidden rows stay visible is merely broken; this rule is what prevents that.
   ⚠️ client.ts:201 rewrites .filter-count's className wholesale — no layout class may live on it.
   The count is the sentence that says what is NOT on screen. It turns amber when rows are hidden
   and red-filled when the filter hides EVERY row, because an empty table under a forgotten filter
   has the exact silhouette of a quiet night, and that misreading is what the feature exists to
   prevent. */
[hidden]{display:none!important}
.filters{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s3);align-items:end;
      background:var(--sunken);border:1px solid var(--line);border-radius:var(--r2);
      padding:var(--s3);margin:var(--s3) 0}
.filters label{display:flex;flex-direction:column;gap:var(--s1)}
.filters label span{color:var(--muted);font:500 var(--t-xs)/1.5 var(--sans);
      text-transform:uppercase;letter-spacing:.06em}
/* GSL-117: these borders were --line at 1.6:1 against the field, under the 3:1 WCAG floor for a
   control boundary. --line-strong measures 3.95:1 light and 3.87:1 dark. */
.filters select,.filters input{background:var(--card);color:var(--fg);
      border:1px solid var(--line-strong);border-radius:var(--r2);padding:var(--s1) var(--s2);
      font:400 var(--t-md)/1.5 var(--sans);max-width:12rem}
.filters button{background:var(--card);color:var(--dim);border:1px solid var(--line-strong);
      border-radius:var(--r2);padding:var(--s1) var(--s3);font:400 var(--t-md)/1.5 var(--sans);
      cursor:pointer}
.filters button:hover{color:var(--fg);border-color:var(--fg)}
.filter-count{color:var(--muted);font-size:var(--t-sm);margin:var(--s2) 0}
.filter-count.filtered{color:var(--warn)}
.filter-count.none{color:var(--dead);background:var(--dead-soft);border-radius:var(--r1);
      padding:var(--s2) var(--s3)}

/* An incident is marked in the MARKUP, not by a script: the owner reads this on a phone at 02:00
   and the page must be right wherever the script did not run. These two rules come AFTER the hover
   rule on purpose — equal specificity, later source order, so an incident keeps its tint while the
   pointer is over it. */
tr.sev-incident td{background:var(--dead-soft)}
tr.sev-incident td:first-child{box-shadow:inset 2px 0 0 var(--dead)}

/* The build-failed banner. Python writes this one — it is the only markup the view layer does not
   render, because the whole point is that it appears when the view layer could not run at all. It
   must therefore be styled by CSS ALREADY sitting in the stale page on disk. It keeps the thick
   edge and the fill: this is the dead state, and dead is what earns them. */
.ui-degraded{background:var(--dead-soft);border:1px solid var(--dead-border);
      border-left:2px solid var(--dead);color:var(--dead);border-radius:var(--r2);
      padding:var(--s3) var(--s4);margin:0 0 var(--s4);font:500 var(--t-md)/1.5 var(--sans)}
.ui-degraded small{display:block;font-weight:400;color:var(--dim);margin-top:var(--s2);
      font-size:var(--t-sm);line-height:1.5}
.ui-degraded code{background:var(--card);border:1px solid var(--line);border-radius:var(--r1);
      padding:0 var(--s1)}

/* GSL-98: the worker card. THE AGE IS THE HEADLINE and the CSS is where that stops being an
   opinion — it is set in the largest type on the card, above the name, because a worker nobody has
   heard from in an hour is not working, it is silent.
   Three states, three inks. SILENT IS AMBER, never red: red would read as dead, and dead is the
   one claim this screen is not entitled to make — a worker thinking inside a long tool call and a
   worker whose process is gone look identical from here. ENDED is muted grey; a finished worker is
   not a problem.
   ⚠️ NOTHING MAY BE NESTED INSIDE .wk-age beyond what is already there: smoke.sh:645 captures its
   contents non-greedily, and client.ts repaints it by textContent. */
.wk{background:var(--card);border:1px solid var(--line);border-radius:var(--r2);
      padding:var(--s3) var(--s4);margin:var(--s2) 0}
.wk-top{display:flex;align-items:baseline;gap:var(--s2) var(--s3);flex-wrap:wrap}
.wk-age{font:500 var(--t-hero)/1.15 var(--mono);font-variant-numeric:tabular-nums}
.wk-age small{display:block;font:400 var(--t-xs)/1.5 var(--sans);color:var(--muted);
      text-transform:uppercase;letter-spacing:.06em}
.wk-name{font:400 var(--t-md)/1.5 var(--mono);color:var(--fg)}
.wk.active .wk-age{color:var(--ok)}
.wk.silent .wk-age{color:var(--warn)}
.wk.ended  .wk-age{color:var(--muted)}
.wk.silent{border-color:var(--warn-border)}
.wk-why{color:var(--dim);font:400 var(--t-base)/1.5 var(--sans);margin:var(--s2) 0;max-width:68ch}
.wk-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--s2) var(--s3);
      border-top:1px solid var(--line-subtle);padding-top:var(--s2);font-size:var(--t-md)}
/* :not(.unknown) for the same cascade reason as ".kpi span": a field whose value is unknown puts
   span.unknown NEXT TO the label span, and the label rule must not caption-ify the value. */
.wk-f span:not(.unknown){display:block;color:var(--muted);font:500 var(--t-xs)/1.5 var(--sans);
      text-transform:uppercase;letter-spacing:.06em}
.wk-task{margin-top:var(--s2);font-size:var(--t-md)}
.wk-models{color:var(--warn)}

/* GSL-99: the self-health meters — the page reporting its own rot. The state lives on the LEFT
   EDGE of the card, not in the ink of its prose: the card is full of sentences, and tinting all of
   them would be the non-status colouring rule 2 forbids. The alarm (three cycles with no handoff)
   is the only meter that goes red and takes the fill, because at that point it is not a warning,
   it is the debt the PRD named. An unreadable meter is magenta-edged and NOT dashed — every dashed
   border in this stylesheet is gone. */
.sh-m{border-left:2px solid var(--line)}
.sh-m.ok{border-left-color:var(--ok)}
.sh-m.warn{border-left-color:var(--warn)}
.sh-m.dead{border-left-color:var(--dead);background:var(--dead-soft)}
.sh-m.dim{border-left-color:var(--line)}
.sh-m.unknown{border-left-color:var(--unk)}
.sh-h{font-weight:500;margin-bottom:var(--s2);font-size:var(--t-md)}
.sh-row{font-size:var(--t-md);margin:var(--s1) 0}
.sh-k{color:var(--muted);font:500 var(--t-xs)/1.5 var(--sans);text-transform:uppercase;
      letter-spacing:.06em;display:inline-block;min-width:11rem}
.sh-why{color:var(--dim);font:400 var(--t-base)/1.5 var(--sans);line-height:1.5;
      margin-top:var(--s2);max-width:68ch}
.sh-epic{font-size:var(--t-md);margin:var(--s1) 0;padding-top:var(--s1);
      border-top:1px solid var(--line-subtle)}

footer{color:var(--muted);font-size:var(--t-sm);margin-top:var(--s7);
      border-top:1px solid var(--line);padding-top:var(--s3);line-height:1.5}

/* ── 390px. The single breakpoint is 26rem (416px), so a 390px phone falls under it. The nav fix
   of GSL-100 is load-bearing and is NOT touched here: it stays flex+wrap, and all this block does
   is buy back horizontal room so the wrap has somewhere to go. The invariant that must survive:
   scrollWidth == clientWidth == 390 on all seven screens, with all seven nav links reachable. */
@media (max-width:26rem){
  body{padding:var(--s3) var(--s3) var(--s6)}
  h1{font-size:var(--t-lg)}
  .runway{padding:var(--s3)}
  .runway-big,.kpi b,.clock-val,.wk-age{font-size:var(--t-xl)}
  .sh-k{min-width:auto;display:block}
  td{padding:6px 8px}
  th{padding:4px 8px}
}
`;
