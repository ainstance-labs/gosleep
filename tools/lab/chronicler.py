#!/usr/bin/env python3
# gosleep lab — chronicler (GSL-86). The T3 regenerator. Invoked via tools/lab/chronicler.sh.
# See that wrapper for the full contract; this file is the implementation.
# python3 stdlib only. 0 API keys (C1).
import sys, os, re, json, html, subprocess, time, datetime, glob

# ───────────────────────────── args ─────────────────────────────

def parse_args(argv):
    a = {
        "repo": os.environ.get("GOSLEEP_REPO", ""),
        "date": "", "narrate": False, "max_budget_usd": "0.25",
        "model": os.environ.get("GOSLEEP_CHRONICLER_MODEL", "claude-haiku-4-5-20251001"),
        "prune": True, "retention_days": 30, "compact_queue": False,
        "poll": True, "dry_run": False, "json": False, "quiet": False,
    }
    i = 0
    while i < len(argv):
        f = argv[i]
        if   f == "--repo":            i += 1; a["repo"] = argv[i]
        elif f == "--date":            i += 1; a["date"] = argv[i]
        elif f == "--narrate":         a["narrate"] = True
        elif f == "--no-narrate":      a["narrate"] = False
        elif f == "--max-budget-usd":  i += 1; a["max_budget_usd"] = argv[i]
        elif f == "--model":           i += 1; a["model"] = argv[i]
        elif f == "--prune":           a["prune"] = True
        elif f == "--no-prune":        a["prune"] = False
        elif f == "--retention-days":  i += 1; a["retention_days"] = int(argv[i])
        elif f == "--compact-queue":   a["compact_queue"] = True
        elif f == "--no-poll":         a["poll"] = False
        elif f == "--dry-run":         a["dry_run"] = True
        elif f == "--json":            a["json"] = True
        elif f in ("--quiet", "-q"):   a["quiet"] = True
        elif f in ("--help", "-h"):    print(__doc__ or "see the header of chronicler.sh"); sys.exit(0)
        else: sys.exit("chronicler: unknown flag %r" % f)
        i += 1
    if not a["repo"]:
        a["repo"] = os.environ["CHRONICLER_REPO_DEFAULT"]
    if not a["date"]:
        a["date"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", a["date"]):
        sys.exit("chronicler: --date must be YYYY-MM-DD, got %r" % a["date"])
    return a

ARGS = parse_args(sys.argv[1:])
REPO = ARGS["repo"]
LAB  = os.path.join(REPO, "docs", "lab")
NOW  = time.time()

# The writers live NEXT TO this file, not under --repo. --repo says where the DATA is (so a test can
# point at a throwaway lab); it must not also decide which lab-write.sh is trusted to write it.
TOOLS = os.path.dirname(os.path.abspath(__file__))

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def log(msg):
    if not ARGS["quiet"]:
        sys.stderr.write("chronicler: %s\n" % msg)

# Degradations are DATA, not silence. Every source that failed to load ends up in the report, in
# status.json, and on the page — because "the digest is missing section 5" and "there was nothing in
# section 5" look identical to a sleeping owner, and they are not the same thing at all.
DEGRADED = []
def degrade(source, why):
    DEGRADED.append({"source": source, "why": str(why)[:200]})
    log("degraded: %s — %s" % (source, str(why)[:120]))

# lab-emit resolves the lab through GOSLEEP_LAB_DIR, so a chronicler pointed at --repo <throwaway>
# would otherwise fold the LIVE queue into a test's status.json. Pin the child's lab to ours.
CHILD_ENV = dict(os.environ, GOSLEEP_LAB_DIR=LAB, GOSLEEP_REPO=REPO)

def run(cmd, cwd=None, timeout=20, check=False):
    try:
        p = subprocess.run(cmd, cwd=cwd or REPO, capture_output=True, text=True, timeout=timeout,
                           env=CHILD_ENV)
        if check and p.returncode != 0:
            raise RuntimeError((p.stderr or p.stdout or "rc=%d" % p.returncode).strip())
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except subprocess.TimeoutExpired:
        raise RuntimeError("timeout after %ss: %s" % (timeout, " ".join(cmd[:3])))

def parse_ts(ts):
    try:
        return datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc).timestamp()
    except Exception:
        return None

def human_age(seconds):
    if seconds is None:
        return "never"
    s = int(seconds)
    if s < 60:   return "%ds" % s
    if s < 3600: return "%dm" % (s // 60)
    if s < 86400:return "%dh %dm" % (s // 3600, (s % 3600) // 60)
    return "%dd %dh" % (s // 86400, (s % 86400) // 3600)

# ───────────────────────────── collect: T1 events ─────────────────────────────

def load_events():
    """Every day's timeline, plus the target day's slice. Bad lines are counted, never fatal:
    a corrupt tail must not blind the whole dashboard."""
    files = sorted(glob.glob(os.path.join(LAB, "events", "*.jsonl")))
    all_ev, bad = [], 0
    for path in files:
        day = os.path.basename(path)[:-6]
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = json.loads(line)
                        e["_day"] = day
                        all_ev.append(e)
                    except Exception:
                        bad += 1
        except OSError as exc:
            degrade("events:" + day, exc)
    if bad:
        degrade("events", "%d unparseable line(s) skipped" % bad)
    all_ev.sort(key=lambda e: (e.get("ts", ""), e.get("seq", 0)))
    return all_ev, [os.path.basename(p)[:-6] for p in files]

# A correction never rewrites history — it appends a line pointing at the seq it replaces (C8).
# Consumers must therefore FOLD before they count, or a superseded event is shown twice.
def fold_superseded(events):
    dead = set()
    for e in events:
        sup = e.get("supersedes")
        if sup is not None:
            dead.add((e.get("_day"), sup))
    return [e for e in events if (e.get("_day"), e.get("seq")) not in dead]

def tally(events, key):
    out = {}
    for e in events:
        v = e.get(key) or "?"
        out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))

# ───────────────────────────── collect: questions / decisions ─────────────────

def lab_emit(*args):
    """Reuse lab-emit's fold (patch records, dedup, deadlines) instead of reimplementing it here.
    Two folds of an append-only log WILL drift apart; one fold cannot."""
    rc, out, err = run(["bash", os.path.join(TOOLS, "lab-emit.sh")] + list(args))
    if rc != 0:
        raise RuntimeError(err or out or "rc=%d" % rc)
    return out

def parse_records(raw):
    """lab-emit --json emits JSONL — one record per line, not an array. An EMPTY queue emits nothing
    at all, which is why a naive json.loads() survived every test until the first real question was
    asked and the chronicler crashed on a dict. Accept both shapes; trust neither."""
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        val = json.loads(raw)
        if isinstance(val, list):
            return val
        if isinstance(val, dict):
            return [val]
    except ValueError:
        pass
    out = []
    for line in raw.splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out

def load_questions():
    try:
        items = parse_records(lab_emit("list", "--status", "all", "--json"))
    except Exception as exc:
        degrade("questions", exc)
        return [], []
    try:
        cand = parse_records(lab_emit("candidates", "--json"))
    except Exception as exc:
        degrade("candidates", exc)
        cand = []
    return items, cand

def load_decisions():
    path = os.path.join(LAB, "decisions", "log.jsonl")
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except Exception:
                        pass
    except FileNotFoundError:
        pass
    except OSError as exc:
        degrade("decisions", exc)
    return out

# ───────────────────────────── collect: git / gh / heartbeat / STATE ──────────

def load_git(date):
    g = {"branch": None, "head": None, "dirty": None, "commits": [], "remote": None}
    try:
        g["branch"] = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], check=True)[1]
        g["head"]   = run(["git", "rev-parse", "--short", "HEAD"], check=True)[1]
        g["dirty"]  = len([l for l in run(["git", "status", "--porcelain"])[1].splitlines() if l])
        rc, out, _  = run(["git", "log", "--since", date + "T00:00:00Z", "--until", date + "T23:59:59Z",
                           "--pretty=%h%x1f%an%x1f%cI%x1f%s"])
        if rc == 0:
            for line in out.splitlines():
                sha, author, cts, subj = (line.split("\x1f") + ["", "", "", ""])[:4]
                if sha:
                    g["commits"].append({"sha": sha, "author": author, "ts": cts, "subject": subj})
        rc, out, _ = run(["git", "remote", "get-url", "origin"])
        if rc == 0:
            g["remote"] = out
    except Exception as exc:
        degrade("git", exc)
    return g

def load_gh():
    """gh is nice-to-have: offline / unauthenticated / rate-limited must degrade, not fail."""
    prs = []
    try:
        rc, out, err = run(["gh", "pr", "list", "--state", "all", "--limit", "20",
                            "--json", "number,title,state,url,updatedAt,mergedAt,headRefName"],
                           timeout=25)
        if rc != 0:
            raise RuntimeError(err or "gh rc=%d" % rc)
        prs = json.loads(out or "[]")
    except FileNotFoundError:
        degrade("gh", "gh CLI not installed")
    except Exception as exc:
        degrade("gh", exc)
    return prs

def load_heartbeat():
    path = os.path.join(REPO, "docs", "handoff", ".orchestrator-heartbeat")
    try:
        with open(path, encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip()]
        if not lines:
            return None
        return json.loads(lines[-1])
    except FileNotFoundError:
        degrade("heartbeat", "no .orchestrator-heartbeat (orchestrator never wrote one)")
    except Exception as exc:
        degrade("heartbeat", exc)
    return None

def load_state():
    """ORCHESTRATION-STATE is the AUTHORITY (C8); status.json is derived and may lag. We quote it,
    we never contradict it."""
    path = os.path.join(REPO, "docs", "handoff", "ORCHESTRATION-STATE.md")
    st = {"live_status": None, "telemetry_last": None, "path": "docs/handoff/ORCHESTRATION-STATE.md"}
    try:
        text = open(path, encoding="utf-8").read()
    except Exception as exc:
        degrade("state", exc)
        return st
    m = re.search(r"^## LIVE-STATUS\s*\n+(.+?)(?=\n## )", text, re.S | re.M)
    if m:
        st["live_status"] = m.group(1).strip().strip("`").strip()[:2000]
    m = re.search(r"^## TELEMETRY.*?\n(.*?)(?=\n## )", text, re.S | re.M)
    if m:
        tel = [l.strip() for l in m.group(1).splitlines() if l.strip().startswith("- `")]
        if tel:
            st["telemetry_last"] = tel[-1].strip("- ").strip("`")[:500]
    return st

# ───────────────────────────── staleness (F4-S3) ─────────────────────────────

FRESH_S = int(os.environ.get("GOSLEEP_FRESH_S", 1800))    # 30 min
DEAD_S  = int(os.environ.get("GOSLEEP_DEAD_S", 10800))    # 3 h

def grade(age):
    """A dead page must LOOK dead. This grade is stamped on every artifact the chronicler emits;
    it is the whole reason the owner can trust a page he opens at 07:00 without checking git."""
    if age is None:      return "dead"
    if age <= FRESH_S:   return "fresh"
    if age <= DEAD_S:    return "stale"
    return "dead"

# ───────────────────────────── build: status.json ─────────────────────────────

def lab_write(target_rel, content, as_json=False):
    """The ONE file where a torn write is catastrophic goes through the ONE tool that cannot tear it."""
    if ARGS["dry_run"]:
        return "dry-run"
    cmd = ["bash", os.path.join(TOOLS, "lab-write.sh")]
    if as_json:
        cmd.append("--json")
    cmd.append(os.path.join(REPO, target_rel))
    p = subprocess.run(cmd, input=content, capture_output=True, text=True, cwd=REPO,
                       env=CHILD_ENV)
    if p.returncode != 0:
        raise RuntimeError("lab-write %s: %s" % (target_rel, (p.stderr or p.stdout).strip()))
    return target_rel

def build_status(ctx):
    ev, day_ev = ctx["events"], ctx["day_events"]
    last_ts = max([e.get("ts", "") for e in ev], default="") or None
    age = (NOW - parse_ts(last_ts)) if last_ts and parse_ts(last_ts) else None
    hb = ctx["heartbeat"]
    hb_age = None
    if hb and hb.get("ts") and parse_ts(hb["ts"]):
        hb_age = NOW - parse_ts(hb["ts"])

    q_open = [q for q in ctx["questions"] if q.get("status") == "open"]
    status = {
        "schema": "gosleep.lab.status/1",
        "generated_at": now_iso(),
        "generated_by": "tools/lab/chronicler.sh (GSL-86)",
        "date": ctx["date"],
        "authority": "docs/handoff/ORCHESTRATION-STATE.md + live git win on conflict (C8); this file is derived",
        "staleness": {
            "max_event_age_s": int(age) if age is not None else None,
            "max_event_age_human": human_age(age),
            "latest_event_ts": last_ts,
            "heartbeat_age_s": int(hb_age) if hb_age is not None else None,
            "grade": grade(age),
            "thresholds_s": {"fresh": FRESH_S, "dead": DEAD_S},
        },
        "events": {
            "total": len(ev),
            "today": len(day_ev),
            "days": ctx["event_days"],
            "by_type": tally(ev, "type"),
            "by_src": tally(ev, "src"),
            "by_actor": tally(ev, "actor"),
            "mechanical_share": round(
                sum(1 for e in ev if str(e.get("src", "")).startswith("hook:")) / len(ev), 3) if ev else 0.0,
        },
        "questions": {
            "open": len(q_open),
            "by_type": tally(q_open, "type"),
            "items": [{"id": q.get("id"), "type": q.get("type"), "question": q.get("question"),
                       "default": q.get("default"), "auto_apply_at": q.get("auto_apply_at"),
                       "task": q.get("task"), "high_impact": q.get("high_impact")}
                      for q in q_open],
        },
        "decisions": {
            "total": len(ctx["decisions"]),
            "last": ctx["decisions"][-1] if ctx["decisions"] else None,
            "manifest_candidates": ctx["candidates"],
        },
        "delivery": {
            "branch": ctx["git"]["branch"],
            "head": ctx["git"]["head"],
            "dirty_paths": ctx["git"]["dirty"],
            "commits_on_date": ctx["git"]["commits"],
            "prs": [{"number": p.get("number"), "state": p.get("state"), "title": p.get("title"),
                     "url": p.get("url"), "mergedAt": p.get("mergedAt")} for p in ctx["prs"]],
        },
        "orchestrator": {"heartbeat": hb, "live_status": ctx["state"]["live_status"],
                         "telemetry_last": ctx["state"]["telemetry_last"]},
        "degraded": DEGRADED,
        "narrative": ctx.get("narrative"),
    }
    return status

# ───────────────────────────── build: site/ (static HTML) ─────────────────────

CSS = """
:root{--bg:#fbfbfa;--fg:#1a1a19;--dim:#6b6b68;--line:#e3e3e0;--card:#fff;
      --ok:#1a7f4b;--warn:#a4600a;--dead:#a51d24;--accent:#3b5bdb}
@media (prefers-color-scheme:dark){
  :root{--bg:#131315;--fg:#e8e8e6;--dim:#8f8f8b;--line:#2a2a2e;--card:#1b1b1e;
        --ok:#4ade80;--warn:#fbbf24;--dead:#f87171;--accent:#8ba4ff}}
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
nav a{margin-right:.9rem}
"""

def esc(x):
    return html.escape("" if x is None else str(x), quote=True)

def src_class(src):
    s = str(src or "")
    if s.startswith("hook:"):  return "hook"
    if s == "poll-fill":       return "poll"
    return "emit"

def page(title, status, body):
    st = status["staleness"]
    g = st["grade"]
    verdict = {
        "fresh": "Live — the laboratory is writing itself right now.",
        "stale": "Stale — nothing has been logged for a while. Delivery may still be running; this page is not.",
        "dead":  "DEAD — this page is not being regenerated. Do not trust anything below without checking git.",
    }[g]
    return f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} — gosleep lab</title>
<style>{CSS}</style>
<h1>{esc(title)}</h1>
<nav><a href="index.html">Dashboard</a><a href="timeline.html">Timeline</a><a href="library.html">Library</a></nav>
<div class="stale {g}">{g.upper()} · last event {esc(st['max_event_age_human'])} ago
  <small>generated_at {esc(status['generated_at'])} · latest event {esc(st['latest_event_ts'] or 'never')}
  · thresholds fresh&le;{FRESH_S//60}m, dead&gt;{DEAD_S//3600}h · {verdict}</small></div>
{body}
<footer>
  Regenerated by <code>tools/lab/chronicler.sh</code> (GSL-86) — <b>never hand-edit</b>: the next pass
  overwrites it. Authority on conflict: <code>ORCHESTRATION-STATE.md</code> + live git (C8).
  Source of truth for this page: <code>docs/lab/status.json</code>.
</footer>
"""

def html_events_table(events, limit=None):
    rows = []
    for e in reversed(events if limit is None else events[-limit:]):
        d = e.get("data") or {}
        detail = d.get("sha") or d.get("path") or d.get("key") or d.get("question") or \
                 d.get("error_type") or d.get("decision") or d.get("cmd") or ""
        rows.append(
            "<tr><td class='mono'>%s</td><td>%s</td><td class='mono'>%s</td>"
            "<td><span class='tag %s'>%s</span></td><td class='mono'>%s</td></tr>" % (
                esc((e.get("ts") or "")[11:19]), esc(e.get("type")), esc(e.get("actor")),
                src_class(e.get("src")), esc(e.get("src")), esc(str(detail)[:90])))
    if not rows:
        return "<div class='card'>No events. Either nothing ran, or the hooks are not firing — " \
               "check <code>.artifacts/lab/lab-log.err</code>.</div>"
    return "<div class='wrap'><table><tr><th>utc</th><th>type</th><th>actor</th><th>src</th>" \
           "<th>detail</th></tr>%s</table></div>" % "".join(rows)

def build_index(ctx, status):
    ev, day_ev = status["events"], ctx["day_events"]
    q = status["questions"]
    d = status["delivery"]

    kpis = "".join([
        "<div class='kpi'><b>%d</b><span>events today</span></div>" % ev["today"],
        "<div class='kpi'><b>%d%%</b><span>mechanical (0-token)</span></div>" % round(ev["mechanical_share"] * 100),
        "<div class='kpi'><b>%d</b><span>open questions</span></div>" % q["open"],
        "<div class='kpi'><b>%d</b><span>commits on %s</span></div>" % (len(d["commits_on_date"]), ctx["date"]),
    ])

    if q["items"]:
        qrows = "".join(
            "<tr><td class='mono'>%s</td><td><span class='tag'>%s</span></td><td>%s</td>"
            "<td class='mono'>%s</td></tr>" % (
                esc(i["id"]), esc(i["type"]), esc(i["question"]),
                esc(i.get("auto_apply_at") or i.get("default") or ""))
            for i in q["items"])
        qhtml = "<div class='wrap'><table><tr><th>id</th><th>type</th><th>question</th>" \
                "<th>auto-applies / default</th></tr>%s</table></div>" % qrows
    else:
        qhtml = "<div class='card'>Nothing is waiting for you. The night decided everything it was " \
                "licensed to decide.</div>"

    crows = "".join("<tr><td class='mono'>%s</td><td>%s</td><td class='mono'>%s</td></tr>" % (
        esc(c["sha"]), esc(c["subject"]), esc(c["author"])) for c in d["commits_on_date"])
    chtml = ("<div class='wrap'><table><tr><th>sha</th><th>subject</th><th>author</th></tr>%s</table></div>"
             % crows) if crows else "<div class='card'>No commits on %s.</div>" % esc(ctx["date"])

    prs = [p for p in d["prs"] if p.get("state") == "OPEN"]
    prhtml = ("<div class='card'>" + " · ".join(
        "<a href='%s'>#%s</a> %s" % (esc(p["url"]), esc(p["number"]), esc(p["title"])) for p in prs)
        + "</div>") if prs else "<div class='card'>No open PRs.</div>"

    hb = status["orchestrator"]["heartbeat"]
    hbhtml = "<div class='card mono'>%s</div>" % esc(json.dumps(hb, ensure_ascii=False)) if hb else \
             "<div class='card'>No heartbeat on disk.</div>"

    degr = ("<h2>Degraded sources</h2><div class='card'>%s</div>" % "<br>".join(
        "<code>%s</code> — %s" % (esc(x["source"]), esc(x["why"])) for x in status["degraded"])
    ) if status["degraded"] else ""

    narr = ("<h2>The night, in words</h2><div class='card'>%s</div>" % esc(ctx["narrative"]["text"])
            ) if ctx.get("narrative") and ctx["narrative"].get("text") else ""

    body = f"""
<div class="grid">{kpis}</div>
{narr}
<h2>Waiting for you ({q['open']})</h2>
{qhtml}
<h2>Delivery</h2>
<div class="card mono">branch <b>{esc(d['branch'])}</b> @ {esc(d['head'])} · {esc(d['dirty_paths'])} dirty path(s)</div>
{chtml}
{prhtml}
<h2>Orchestrator</h2>
{hbhtml}
<h2>Timeline — {esc(ctx['date'])} (last 25 of {len(day_ev)})</h2>
{html_events_table(day_ev, limit=25)}
<div class="card"><a href="timeline.html">Full timeline &rarr;</a></div>
{degr}
"""
    return page("Laboratory", status, body)

def build_timeline(ctx, status):
    by_type = "".join("<tr><td>%s</td><td class='mono'>%d</td></tr>" % (esc(k), v)
                      for k, v in status["events"]["by_type"].items())
    by_src = "".join("<tr><td><span class='tag %s'>%s</span></td><td class='mono'>%d</td></tr>" % (
        src_class(k), esc(k), v) for k, v in status["events"]["by_src"].items())
    body = f"""
<h2>{esc(ctx['date'])} — {len(ctx['day_events'])} events</h2>
{html_events_table(ctx['day_events'])}
<h2>All days — {status['events']['total']} events</h2>
<div class="grid">
  <div class="card"><table><tr><th>type</th><th>n</th></tr>{by_type}</table></div>
  <div class="card"><table><tr><th>provenance</th><th>n</th></tr>{by_src}</table></div>
</div>
<div class="card">Provenance is queryable, not claimed:
<code>jq -r 'select(.src|startswith("hook:")).type' docs/lab/events/*.jsonl</code> — that half of the
log cost 0 tokens and needed no model's cooperation.</div>
"""
    return page("Timeline", status, body)

def build_library(ctx, status):
    """The Library index (PRD task 4): every T2 narrative artifact, newest first. The raw log is
    exhaust; THIS is the memory that survives retention."""
    def listing(subdir, pattern, limit=40):
        paths = sorted(glob.glob(os.path.join(REPO, subdir, pattern)), reverse=True)[:limit]
        if not paths:
            return "<div class='card'>none yet</div>"
        rows = []
        for p in paths:
            rel = os.path.relpath(p, REPO)
            title = ""
            try:
                with open(p, encoding="utf-8") as f:
                    for line in f:
                        if line.startswith("# "):
                            title = line[2:].strip()
                            break
            except OSError:
                pass
            rows.append("<tr><td class='mono'><a href='%s'>%s</a></td><td>%s</td></tr>" % (
                esc(os.path.relpath(p, os.path.join(LAB, "site"))), esc(os.path.basename(p)),
                esc(title[:110])))
        return "<div class='wrap'><table><tr><th>file</th><th>title</th></tr>%s</table></div>" % "".join(rows)

    dec = "".join("<tr><td class='mono'>%s</td><td>%s</td><td class='mono'>%s</td></tr>" % (
        esc((d.get("ts") or "")[:16]), esc(d.get("decision")), esc(d.get("rule") or "—"))
        for d in reversed(ctx["decisions"][-30:]))
    dechtml = ("<div class='wrap'><table><tr><th>when</th><th>decision</th><th>manifest rule</th></tr>"
               "%s</table></div>" % dec) if dec else \
              "<div class='card'>No autonomous decisions logged yet.</div>"

    body = f"""
<h2>Morning digests</h2>
{listing("docs/lab/digest", "*-morning.md")}
<h2>Handoffs</h2>
{listing("docs/handoff", "*.md")}
<h2>Dev history</h2>
{listing("docs/dev_history", "GSL-*.md")}
<h2>Decisions ({len(ctx['decisions'])})</h2>
{dechtml}
<h2>Contracts</h2>
<div class="card">
  <a href="../README.md">docs/lab/README.md</a> — layout, three tiers, write discipline, retention<br>
  <a href="../events/README.md">events/README.md</a> — envelope + the closed type vocabulary<br>
  <a href="../status.json">status.json</a> — this dashboard's machine-readable source
</div>
"""
    return page("Library", status, body)

SITE_README = """# `docs/lab/site/` — DERIVED. Do not hand-edit.

Every file here is overwritten by `tools/lab/chronicler.sh` on its next pass. An edit you make by hand
survives exactly until then, and in the meantime it is a lie with a `generated_at` stamp on it.

This is the tasty-lunch-wiki rule (blueprint 05 §1.4-1), and it is the only reason a regenerated hub
does not rot: **nobody edits it, so nobody has to maintain it.** To change what the page says, change
what the chronicler *reads* — or change the chronicler.

Open `index.html` from `file://` (it is self-contained: no CDN, no fonts, no JS). Every page carries
`generated_at` + max event age and grades itself fresh / stale / dead, so a chronicler that died in
the night produces a page that SAYS it died — never a confident-looking page full of yesterday.
"""

# ───────────────────────────── build: morning digest ─────────────────────────

def build_digest(ctx, status):
    """The canonical 7-section template from docs/lab/digest/README.md. EVERY section is read from
    disk (queue, decisions, git, gh, STATE) — never from a model's memory of the night, which is the
    exact thing this whole tier exists to stop trusting."""
    d, q = status["delivery"], status["questions"]
    ev = ctx["day_events"]
    st = status["staleness"]

    first_ts = next((e.get("ts") for e in ev if e.get("ts")), None)
    last_ts  = next((e.get("ts") for e in reversed(ev) if e.get("ts")), None)
    window = "%s → %s" % ((first_ts or "?")[11:16], (last_ts or "?")[11:16])

    L = []
    L.append("# Morning digest — %s (night run: %s)" % (ctx["date"], window))
    L.append("")
    L.append("> Generated by `tools/lab/chronicler.sh` at %s · last event **%s** ago · **%s**. "
             "Regenerated only — never hand-edited (docs/lab/site/README.md)."
             % (status["generated_at"], st["max_event_age_human"], st["grade"].upper()))
    L.append("")

    # 1 — Waiting for you. BLOCKERs first, then DECISIONs by deadline; high_impact ranks up inside a group.
    blockers = [i for i in q["items"] if i["type"] == "BLOCKER"]
    decisions_q = [i for i in q["items"] if i["type"] == "DECISION"]
    others = [i for i in q["items"] if i["type"] not in ("BLOCKER", "DECISION")]
    ordered = (sorted(blockers, key=lambda i: (not i.get("high_impact"),)) +
               sorted(decisions_q, key=lambda i: (not i.get("high_impact"), i.get("auto_apply_at") or "")) +
               others)
    L.append("## 1. Waiting for you (%d)" % len(ordered))
    if ordered:
        for i in ordered:
            mark = "!" if i["type"] == "BLOCKER" else "?"
            tail = ("default: \"%s\"; auto-applies %s" % (i.get("default"), i.get("auto_apply_at"))
                    if i.get("auto_apply_at") else (i.get("task") or ""))
            L.append("- %s %-8s %s — %s%s" % (mark, i["type"], i["id"], i["question"],
                                              (" — " + tail) if tail else ""))
    else:
        L.append("- none — nothing needs you. Everything the night hit was inside its licence.")
    L.append("")

    # 2 — Decided for you. Every autonomous decision MUST cite a manifest rule (provenance, F3-S3).
    dec_today = [x for x in ctx["decisions"] if (x.get("ts") or "").startswith(ctx["date"])]
    L.append("## 2. Decided for you (%d)" % len(dec_today))
    if dec_today:
        for x in dec_today:
            L.append("- %s (%s, %s) — rule: `%s`" % (
                x.get("decision"), x.get("re") or x.get("id") or "—",
                (x.get("ts") or "")[11:16], x.get("rule") or "NO RULE CITED — audit this"))
    else:
        L.append("- none")
    L.append("")

    # 3 — What shipped. From git/gh/events, not from memory.
    L.append("## 3. What shipped")
    if d["commits_on_date"]:
        for c in d["commits_on_date"]:
            L.append("- `%s` %s" % (c["sha"], c["subject"]))
    else:
        L.append("- no commits on %s" % ctx["date"])
    merged = [p for p in d["prs"] if p.get("mergedAt", "") and str(p["mergedAt"])[:10] == ctx["date"]]
    for p in merged:
        L.append("- PR #%s merged — %s (%s)" % (p["number"], p["title"], p["url"]))
    tracker = [e for e in ev if str(e.get("type", "")).startswith("tracker.")]
    if tracker:
        L.append("- Jira: %d transition(s) — %s" % (
            len(tracker), ", ".join(sorted({str((e.get("data") or {}).get("key") or "?")
                                            for e in tracker}))))
    L.append("")

    # 4 — Incidents. api.failure is the quota detector Phase 2 wanted; a compaction on the
    # orchestrator is a red flag; a restart is never silent.
    inc = [e for e in ev if e.get("type") in
           ("api.failure", "context.pre_compact", "context.post_compact", "breaker.opened",
            "restart.recorded", "quota.wait_started")]
    L.append("## 4. Incidents")
    if inc:
        for e in inc:
            data = e.get("data") or {}
            L.append("- `%s` %s — %s" % ((e.get("ts") or "")[11:16], e.get("type"),
                                         json.dumps(data, ensure_ascii=False)[:160]))
    else:
        L.append("- none")
    L.append("")

    # 5 — Cost & runway. From STATE's TELEMETRY line (its grammar), not invented here.
    L.append("## 5. Cost & runway")
    L.append("- %s" % (ctx["state"]["telemetry_last"] or "no TELEMETRY line in ORCHESTRATION-STATE"))
    if status["orchestrator"]["heartbeat"]:
        hb = status["orchestrator"]["heartbeat"]
        L.append("- heartbeat: cycle %s · context %s%% · open_workers %s · status %s (%s ago)" % (
            hb.get("cycle"), hb.get("context_pct"), hb.get("open_workers"), hb.get("status"),
            human_age(st["heartbeat_age_s"])))
    L.append("")

    # 6 — Manifest candidates: verbatim from `lab-emit candidates`.
    L.append("## 6. Manifest candidates")
    if ctx["candidates"]:
        for c in ctx["candidates"]:
            L.append("- %s" % json.dumps(c, ensure_ascii=False)[:300])
    else:
        L.append("- none")
    L.append("")

    # 7 — Next: the state the orchestrator itself declared. We quote the authority (C8), we do not
    # guess a plan on its behalf.
    L.append("## 7. Next")
    L.append("- %s" % (ctx["state"]["live_status"] or "no LIVE-STATUS in ORCHESTRATION-STATE").replace("\n", " ")[:900])
    L.append("")

    if ctx.get("narrative"):
        n = ctx["narrative"]
        L.append("---")
        L.append("")
        if n.get("text"):
            L.append("## The night, in words")
            L.append("")
            L.append(n["text"])
            L.append("")
            L.append("<sub>Written by `claude -p` (%s, --max-budget-usd %s, --allowedTools NONE). "
                     "The seven sections above are machine-built and do not depend on it.</sub>"
                     % (n.get("model"), n.get("budget")))
        else:
            L.append("<sub>Narrator unavailable (%s). The digest above is complete without it — "
                     "by design: the LLM is glue, not the engine (C3/F4-S3).</sub>" % n.get("error"))
        L.append("")

    if status["degraded"]:
        L.append("## Degraded sources")
        for x in status["degraded"]:
            L.append("- `%s` — %s" % (x["source"], x["why"]))
        L.append("")
    return "\n".join(L)

# ───────────────────────────── the bounded LLM glue (C3, F4-S4) ───────────────

def narrate(status):
    """`claude -p` with a HARD budget and an EMPTY tool set: it can read nothing, write nothing, and
    run nothing. It gets facts on stdin and returns prose on stdout. If it fails for ANY reason, the
    caller keeps every artifact and stamps the failure — F4-S3 says a dead chronicler must not take
    delivery down, and an LLM that is load-bearing for a dashboard IS a way to take it down."""
    facts = {
        "date": status["date"],
        "events_today": status["events"]["today"],
        "event_types": dict(list(status["events"]["by_type"].items())[:12]),
        "mechanical_share": status["events"]["mechanical_share"],
        "commits": [c["subject"] for c in status["delivery"]["commits_on_date"]],
        "open_questions": [i["question"] for i in status["questions"]["items"]],
        "decisions_total": status["decisions"]["total"],
        "staleness": status["staleness"]["grade"],
        "branch": status["delivery"]["branch"],
        "degraded": [x["source"] for x in status["degraded"]],
    }
    prompt = (
        "You are the chronicler of an autonomous delivery fleet that worked while its owner slept.\n"
        "Below is the machine-collected record of one day, as JSON. Write 3-5 sentences of plain prose "
        "for the owner's morning: what actually happened, what it means, and the ONE thing that should "
        "worry him. Be concrete (name the branch, the commits). Never invent a fact that is not in the "
        "JSON. If the record is thin, say the night was thin — do not pad.\n\n"
        "Answer with the prose only. No preamble, no headings, no bullet points.\n\n"
        + json.dumps(facts, ensure_ascii=False, indent=1)
    )
    out = {"model": ARGS["model"], "budget": ARGS["max_budget_usd"], "text": None, "error": None}
    try:
        p = subprocess.run(
            ["claude", "-p", prompt,
             "--model", ARGS["model"],
             "--max-budget-usd", str(ARGS["max_budget_usd"]),
             "--allowedTools",                       # ← empty tool list: no Bash, no Read, no Write.
             "--disallowedTools", "Bash", "Edit", "Write", "Read", "WebFetch", "WebSearch", "Task"],
            capture_output=True, text=True, timeout=120, cwd=REPO)
        if p.returncode != 0:
            raise RuntimeError((p.stderr or p.stdout or "rc=%d" % p.returncode).strip()[:200])
        text = (p.stdout or "").strip()
        if not text:
            raise RuntimeError("empty output")
        out["text"] = text[:2000]
    except FileNotFoundError:
        out["error"] = "claude CLI not on PATH"
    except subprocess.TimeoutExpired:
        out["error"] = "timeout (120s)"
    except Exception as exc:
        out["error"] = str(exc)[:200]
    if out["error"]:
        degrade("narrator", out["error"])
    return out

# ───────────────────────────── retention (docs/lab/README) ────────────────────

def apply_retention(ctx):
    """events/ = exhaust: 30 days, then gone (poll-fill can rebuild it from gh/Jira/git — that is
    exactly why it is allowed to be pruned). digest/dev_history/handoff/decisions = the memory, kept
    forever. Answered questions are archived so the morning list stays the OPEN list."""
    report = {"events_pruned": [], "questions_archived": 0, "queue_compacted": False}
    if not ARGS["prune"]:
        return report

    cutoff = (datetime.datetime.now(datetime.timezone.utc)
              - datetime.timedelta(days=ARGS["retention_days"])).strftime("%Y-%m-%d")
    for path in sorted(glob.glob(os.path.join(LAB, "events", "*.jsonl"))):
        day = os.path.basename(path)[:-6]
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", day) or day >= cutoff:
            continue
        report["events_pruned"].append(day)
        if not ARGS["dry_run"]:
            try:
                os.unlink(path)
            except OSError as exc:
                degrade("prune:" + day, exc)

    # Answered/expired questions → archive.jsonl. The archive is a WHOLE file (rebuilt each pass,
    # atomically), so it is idempotent by construction: no dedup bookkeeping to get wrong.
    closed = [q for q in ctx["questions"] if q.get("status") in ("answered", "resolved", "expired",
                                                                 "auto_resolved", "deduped")]
    if closed:
        content = "".join(json.dumps(q, ensure_ascii=False) + "\n" for q in closed)
        try:
            lab_write("docs/lab/questions/archive.jsonl", content)
            report["questions_archived"] = len(closed)
        except Exception as exc:
            degrade("archive", exc)

    # Compacting queue.jsonl means REWRITING an append-only file that live agents append to under a
    # lock. Off by default: a lost question is a lost promise to the owner, and the queue is tiny.
    # When asked for explicitly, take lab-emit's own mkdir lock first so no append can be racing us.
    if ARGS["compact_queue"] and closed and not ARGS["dry_run"]:
        lock = os.path.join(LAB, "questions", ".queue.lock")
        got = False
        for _ in range(50):
            try:
                os.mkdir(lock)
                got = True
                break
            except FileExistsError:
                time.sleep(0.1)
        if not got:
            degrade("compact-queue", "could not take .queue.lock — queue left intact (correct)")
        else:
            try:
                keep_ids = {q["id"] for q in ctx["questions"] if q.get("status") == "open"}
                src = os.path.join(LAB, "questions", "queue.jsonl")
                kept = []
                with open(src, encoding="utf-8") as f:
                    for line in f:
                        if not line.strip():
                            continue
                        try:
                            rec = json.loads(line)
                        except Exception:
                            kept.append(line.rstrip("\n"))       # unparseable → keep, never drop
                            continue
                        rid = rec.get("id") or rec.get("re")
                        if rid in keep_ids or rec.get("kind") == "patch" and rec.get("re") in keep_ids:
                            kept.append(line.rstrip("\n"))
                lab_write("docs/lab/questions/queue.jsonl", "".join(k + "\n" for k in kept))
                report["queue_compacted"] = True
            except Exception as exc:
                degrade("compact-queue", exc)
            finally:
                try:
                    os.rmdir(lock)
                except OSError:
                    pass
    return report

# ───────────────────────────── poll-fill hook (GSL-87) ────────────────────────

def poll_fill():
    """Reconcile-don't-trust: hooks only see what happened THROUGH an agent. A PR merged from the web
    is invisible to them. poll-fill.sh backfills those as src="poll-fill" events. Optional by design —
    a chronicler on a machine without `gh` still produces every page."""
    script = os.path.join(TOOLS, "poll-fill.sh")
    if not os.path.exists(script):
        return {"ran": False, "why": "poll-fill.sh not present (GSL-87 not landed yet)"}
    cmd = ["bash", script, "--repo", REPO, "--json"]
    if ARGS["dry_run"]:
        cmd.append("--dry-run")
    try:
        rc, out, err = run(cmd, timeout=60)
        if rc != 0:
            raise RuntimeError((err or out)[:200])
        return {"ran": True, "result": json.loads(out or "{}")}
    except Exception as exc:
        degrade("poll-fill", exc)
        return {"ran": False, "why": str(exc)[:200]}

# ───────────────────────────── main ─────────────────────────────

def main():
    t0 = time.time()

    poll = poll_fill() if ARGS["poll"] else {"ran": False, "why": "--no-poll"}

    events_all, event_days = load_events()
    events_all = fold_superseded(events_all)
    day_events = [e for e in events_all if e.get("_day") == ARGS["date"]]
    questions, candidates = load_questions()
    ctx = {
        "date": ARGS["date"],
        "events": events_all, "event_days": event_days, "day_events": day_events,
        "questions": questions, "candidates": candidates,
        "decisions": load_decisions(),
        "git": load_git(ARGS["date"]),
        "prs": load_gh(),
        "heartbeat": load_heartbeat(),
        "state": load_state(),
        "narrative": None,
    }

    status = build_status(ctx)
    if ARGS["narrate"]:
        ctx["narrative"] = narrate(status)
        status["narrative"] = ctx["narrative"]
        status["degraded"] = DEGRADED          # narrate() may have degraded

    written = []
    try:
        written.append(lab_write("docs/lab/status.json",
                                 json.dumps(status, ensure_ascii=False, indent=2) + "\n", as_json=True))
        os.makedirs(os.path.join(LAB, "site"), exist_ok=True) if not ARGS["dry_run"] else None
        written.append(lab_write("docs/lab/site/index.html",    build_index(ctx, status)))
        written.append(lab_write("docs/lab/site/timeline.html", build_timeline(ctx, status)))
        written.append(lab_write("docs/lab/site/library.html",  build_library(ctx, status)))
        written.append(lab_write("docs/lab/site/README.md",     SITE_README))
        # A day with no activity gets no digest (docs/lab/digest/README.md): an empty digest trains
        # the owner to stop opening them.
        if day_events or ctx["git"]["commits"]:
            os.makedirs(os.path.join(LAB, "digest"), exist_ok=True) if not ARGS["dry_run"] else None
            written.append(lab_write("docs/lab/digest/%s-morning.md" % ARGS["date"],
                                     build_digest(ctx, status)))
    except Exception as exc:
        log("FATAL while writing: %s" % exc)
        report = {"ok": False, "error": str(exc), "written": written, "degraded": DEGRADED}
        print(json.dumps(report, ensure_ascii=False, indent=2) if ARGS["json"] else "chronicler: FAILED: %s" % exc)
        return 1

    retention = apply_retention(ctx)

    report = {
        "ok": True,
        "generated_at": status["generated_at"],
        "date": ARGS["date"],
        "dry_run": ARGS["dry_run"],
        "written": written,
        "events": {"total": len(events_all), "today": len(day_events)},
        "staleness": status["staleness"]["grade"],
        "max_event_age_human": status["staleness"]["max_event_age_human"],
        "questions_open": status["questions"]["open"],
        "poll_fill": poll,
        "retention": retention,
        "narrative": (ctx["narrative"] or {}).get("error") or
                     ("ok" if ctx.get("narrative") else "not requested"),
        "degraded": DEGRADED,
        "elapsed_s": round(time.time() - t0, 2),
    }
    if ARGS["json"]:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif not ARGS["quiet"]:
        print("chronicler: %s%s — %d events (%d on %s), %s, %d open question(s), %d file(s)%s" % (
            status["staleness"]["grade"].upper(),
            " [dry-run]" if ARGS["dry_run"] else "",
            len(events_all), len(day_events), ARGS["date"],
            "last event %s ago" % status["staleness"]["max_event_age_human"],
            status["questions"]["open"], len(written),
            (" · degraded: " + ",".join(x["source"] for x in DEGRADED)) if DEGRADED else ""))
    return 0

sys.exit(main())
