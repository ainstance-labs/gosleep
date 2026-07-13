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
`;
