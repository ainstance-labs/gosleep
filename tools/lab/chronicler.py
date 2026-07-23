#!/usr/bin/env python3
# gosleep lab — chronicler (GSL-86). The T3 regenerator. Invoked via tools/lab/chronicler.sh.
# See that wrapper for the full contract; this file is the implementation.
# python3 stdlib only. 0 API keys (C1).
import sys, os, re, json, subprocess, time, datetime, glob, html

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

# The event log writes one format and one only: 2026-07-13T12:04:15Z. But the log is not the only
# thing with a timestamp in it. Jira hands poll-fill `occurred_at` as full ISO-8601 with fractional
# seconds and a numeric offset -- 2026-07-12T23:26:24.969+0200 -- and the old strict parser returned
# None for every one of them. The damage was silent and specific: the Tasks board knew a task's
# status but not WHEN it learned it, so `tracker_age` came out "never" on a board whose statuses were
# right there. And a `None` age reads as "no data", which is precisely the word this dashboard is not
# allowed to misuse.
#
# datetime.fromisoformat() would do this in one line -- from Python 3.11. macOS ships 3.9, which
# chokes on both the trailing Z and the colon-less offset, and this file is stdlib-only by contract.
ISO_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*(Z|z|[+-]\d{2}:?\d{2})?$")


def parse_ts(ts):
    if not ts:
        return None
    m = ISO_RE.match(str(ts).strip())
    if not m:
        return None
    try:
        dt = datetime.datetime.strptime(m.group(1) + "T" + m.group(2), "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None
    off = m.group(3)
    if off in (None, "Z", "z"):
        tz = datetime.timezone.utc
    else:
        body = off[1:].replace(":", "")
        try:
            delta = datetime.timedelta(hours=int(body[:2]), minutes=int(body[2:4]))
        except ValueError:
            return None
        tz = datetime.timezone(delta if off[0] == "+" else -delta)
    return dt.replace(tzinfo=tz).timestamp()


def iso_utc(ts):
    """Any ISO-8601 -> the ONE canonical form this repo compares and stores: ...Z, in UTC.

    Timestamps in two formats must never meet in a string comparison. `2026-07-12T23:26:24+0200` sorts
    ABOVE `2026-07-12T21:33:25Z` lexically while being the EARLIER instant -- so a naive `>=` picks the
    stale record and calls it the newest. Normalise at the door, compare afterwards."""
    e = parse_ts(ts)
    if e is None:
        return None
    return datetime.datetime.fromtimestamp(e, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

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

# A correction never rewrites history — it appends a line pointing at the record it replaces (C8).
# Consumers must therefore FOLD before they count, or a superseded event is shown twice.
#
# A reference is a (file, seq) coordinate, because seq is unique per FILE, not globally (GSL-89):
#   42             seq 42 in the CORRECTING event's own day file — the same-day form.
#   2026-07-12:42  seq 42 in THAT day's file — the cross-day form.
# poll-fill fixes last night's log this morning, so its corrections are cross-day by nature. Read as
# a bare seq, such a reference would retire whichever innocent line happens to hold seq 42 in TODAY's
# file — a correction that silently deletes an unrelated event is worse than the error it fixes.
def fold_superseded(events):
    dead = set()
    for e in events:
        sup = e.get("supersedes")
        if sup is None:
            continue
        if isinstance(sup, str) and ":" in sup:
            day, _, seq = sup.partition(":")
            try:
                dead.add((day, int(seq)))
            except ValueError:
                continue                      # malformed reference: fold nothing, never guess
        else:
            try:
                dead.add((e.get("_day"), int(sup)))
            except (TypeError, ValueError):
                continue
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
    # `commits` is the target DAY (the digest and the Overview are day-shaped). `recent` is the last
    # 200 commits regardless of day, because the Tasks board is TASK-shaped: a row for GSL-84 needs
    # the commit that closed it whether that happened tonight or last week, and a board that only
    # links today's commits shows an empty cell for every task it did not happen to touch today.
    g = {"branch": None, "head": None, "dirty": None, "commits": [], "recent": [], "remote": None}
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
        rc, out, _ = run(["git", "log", "-n", "200", "--pretty=%h%x1f%an%x1f%cI%x1f%s"])
        if rc == 0:
            for line in out.splitlines():
                sha, author, cts, subj = (line.split("\x1f") + ["", "", "", ""])[:4]
                if sha:
                    g["recent"].append({"sha": sha, "author": author, "ts": cts, "subject": subj})
        rc, out, _ = run(["git", "remote", "get-url", "origin"])
        if rc == 0:
            g["remote"] = out
    except Exception as exc:
        degrade("git", exc)
    return g

def gh_cache():
    """An operator may hand the build the GitHub mirror in a file instead of a network call.

    The laboratory holds no credentials (C1) and must build on a machine with no `gh` and no network;
    it must also be TESTABLE, and a test that can only ever exercise the degraded path is a test that
    never sees the column it is guarding. So `GOSLEEP_GH_JSON` names a file shaped exactly like what
    `gh` returns -- {"prs": [...], "issues": [...]} -- and it is used INSTEAD of calling gh. It is an
    injection point, not a fallback: an unreadable file degrades loudly rather than quietly pretending
    GitHub said nothing."""
    path = os.environ.get("GOSLEEP_GH_JSON")
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return {"prs": d.get("prs") or [], "issues": d.get("issues") or []}
    except Exception as exc:
        degrade("gh-cache", exc)
        return None


def load_gh():
    """gh is nice-to-have: offline / unauthenticated / rate-limited must degrade, not fail."""
    cached = gh_cache()
    if cached is not None:
        return cached["prs"]
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


def load_gh_issues():
    """The Jira->GitHub issue mirror, which the board was told did not exist.

    It does. It was never on DISK -- the mirror is recorded in handoff prose -- and the previous board
    concluded from that that no machine-readable source maps a Jira key to an issue number, so it left
    the column out. But the build already reaches GitHub for pull requests, and the delivery conventions
    put the key in the issue TITLE ("GSL-101: [Docs] ..."), where a regex can read it. The mirror is
    machine-readable; it just is not a file.

    The old caution stands and is why this degrades instead of guessing: a plausible link to the WRONG
    issue is worse than no link, because the owner clicks it once, lands somewhere wrong, and stops
    trusting the column that was right. So an issue whose title carries no key maps to nothing, and a
    build with no gh maps NOTHING at all and says so on the page."""
    cached = gh_cache()
    if cached is not None:
        return cached["issues"]
    issues = []
    try:
        rc, out, err = run(["gh", "issue", "list", "--state", "all", "--limit", "300",
                            "--json", "number,title,state,url,labels"], timeout=25)
        if rc != 0:
            raise RuntimeError(err or "gh rc=%d" % rc)
        issues = json.loads(out or "[]")
    except FileNotFoundError:
        degrade("gh-issues", "gh CLI not installed")
    except Exception as exc:
        degrade("gh-issues", exc)
    return issues

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


def load_heartbeat_history():
    """Every pulse, not just the last one.

    A single heartbeat says "context is at 78%". That is a level, and a level cannot answer "how long
    have I got" -- only a RATE can, and a rate needs two readings. The runway's context clock (GSL-94)
    is the reason this loader exists; the last line alone was enough for a status page and is not
    enough for a prediction."""
    path = os.path.join(REPO, "docs", "handoff", ".orchestrator-heartbeat")
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass          # a torn pulse is one lost reading, never a lost dashboard
    except FileNotFoundError:
        pass                      # already degraded by load_heartbeat()
    except OSError as exc:
        degrade("heartbeat-history", exc)
    return [h for h in out if h.get("ts")]

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
            st["telemetry_lines"] = [l.strip("- ").strip("`") for l in tel]
    return st

# ───────────────────────────── collect: cost (GSL-93) ─────────────────────────

# The TELEMETRY section of ORCHESTRATION-STATE is a HAND-WRITTEN ledger: one markdown bullet per
# cycle, appended by whoever closed it. It is prose with numbers in it, not a data file -- and it
# shows: values are approximations (`~`, `≈`), `cache_read=est-unavailable` and
# `tokens_this_cycle=UNRECOVERED` both appear, `cache_write` is missing from most lines, and there is
# free Russian commentary in brackets. So parse it LENIENTLY and COUNT WHAT YOU COULDN'T READ. A
# parser that silently drops the lines it does not understand turns a ledger with holes into a
# smaller ledger that looks whole -- and the Cost screen would then under-report spend with total
# confidence.
COST_FIELDS = {
    "cycle":       re.compile(r"\bcycle=(\d+)"),
    "worker":      re.compile(r"\bworker=(\S+)"),
    "model":       re.compile(r"\bmodel=(\S+)"),
    "tokens_out":  re.compile(r"\btokens_out=~?≈?(\d+)"),
    "tokens_in":   re.compile(r"\btokens_in=~?≈?(\d+)"),
    "cache_read":  re.compile(r"\bcache_read=~?≈?(\d+)"),
    "cache_write": re.compile(r"\bcache_write=~?≈?(\d+)"),
    "running_total": re.compile(r"total\s*[≈~]?\s*(\d+)"),
    "running_cycles": re.compile(r"cycles=(\d+)"),
}


def load_cost(state, events=(), days=()):
    """The Cost screen's data (PRD R5.2, screen 6) and the token axis of the runway (GSL-94).

    THE CEILING DOES NOT EXIST. manifest.md §5.phase-ceiling delegates it to "the epic brief", and no
    epic brief on disk names a number. So this returns a numerator with no denominator, and says so:
    `ceiling: null`. It must NOT be papered over with a plausible default -- a made-up ceiling makes
    the budget clock finite, which lengthens nothing but shortens the owner's trust the first time it
    is wrong in either direction."""
    cost = {"cycles": [], "unparsed": 0, "cumulative_total": None, "cumulative_cycles": None,
            "ceiling": None, "ceiling_source": None,
            # GSL-132: the lead used to repeat the sentence its consumers already print ("There is no
            # token ceiling on disk." on cost.html, "No ceiling is set" on mobile), so the reader saw
            # the same claim twice. The why now carries only what the lead does NOT — the reason.
            "ceiling_why": "manifest.md §5.phase-ceiling delegates it to the epic brief, and no brief "
                           "names a number (override with GOSLEEP_TOKEN_CEILING)"}

    env_ceiling = os.environ.get("GOSLEEP_TOKEN_CEILING")
    if env_ceiling:
        try:
            cost["ceiling"] = int(env_ceiling)
            cost["ceiling_source"] = "env GOSLEEP_TOKEN_CEILING"
            cost["ceiling_why"] = None
        except ValueError:
            degrade("cost", "GOSLEEP_TOKEN_CEILING=%r is not an integer" % env_ceiling)

    for line in state.get("telemetry_lines") or []:
        row, got = {"raw": line[:300]}, 0
        for name, rx in COST_FIELDS.items():
            m = rx.search(line)
            if m:
                got += 1
                row[name] = m.group(1) if name in ("worker", "model") else int(m.group(1))
            else:
                row[name] = None
        if row["cycle"] is None:
            cost["unparsed"] += 1        # not a telemetry bullet at all, or one we cannot key
            continue
        cost["cycles"].append(row)
        if row["running_total"] is not None:
            cost["cumulative_total"] = row["running_total"]
        if row["running_cycles"] is not None:
            cost["cumulative_cycles"] = row["running_cycles"]

    if cost["ceiling"] and cost["cumulative_total"]:
        cost["used_pct"] = round(100.0 * cost["cumulative_total"] / cost["ceiling"], 1)
    else:
        cost["used_pct"] = None
    cost["by_model"] = cost_by_model(cost["cycles"])
    cost["quota"] = cost_quota(events, list(days))
    return cost


TOKEN_FIELDS = ("tokens_out", "tokens_in", "cache_read")


def cost_by_model(cycles):
    """Spend rolled up per model (GSL-98).

    The rollup carries `partial`: how many of the bucket's cycles had at least one token field the
    ledger could not spell. A sum that quietly skips the lines it could not read is a sum that
    UNDER-REPORTS with total confidence -- and the one direction a cost screen must never err in is
    "cheaper than reality". So the total is printed WITH the count of what is missing from it, and a
    bucket whose every line was unreadable prints its tokens as unknown rather than as 0."""
    agg = {}
    for c in cycles:
        model = c.get("model")
        r = agg.setdefault(model or "", {"model": model, "cycles": 0, "partial": 0, "readable": 0})
        r["cycles"] += 1
        holes = 0
        for f in TOKEN_FIELDS:
            v = c.get(f)
            if isinstance(v, int):
                r[f] = r.get(f, 0) + v
            else:
                holes += 1
        if holes:
            r["partial"] += 1
        if holes < len(TOKEN_FIELDS):
            r["readable"] += 1
    rows = []
    for r in agg.values():
        for f in TOKEN_FIELDS:
            # No readable line at all -> unknown, NOT zero. Zero is a claim; this is an absence.
            r.setdefault(f, None if r["readable"] == 0 else 0)
        rows.append(r)
    return sorted(rows, key=lambda r: (-(r.get("tokens_out") or 0), r["model"] or ""))


# `api.failure` is written by the StopFailure hook; the quota pair brackets a wait. NONE of them has
# ever been seen in this repository -- see `why_empty` below, which is the whole point of the section.
QUOTA_TYPES = ("api.failure", "quota.wait_started", "quota.wait_ended")


def cost_quota(events, days):
    """Quota events for the Cost screen (GSL-98): the StopFailure failures and the reset ETA.

    THIS SECTION IS EXPECTED TO BE EMPTY, and an empty section that cannot say where it looked is
    indistinguishable from a broken one. So it always prints its own glob: how many events it read,
    over which day files, and which types it was looking for. "The quota never bit us" and "the hook
    that would have told us is dead" are different sentences, and only one of them is safe to sleep
    on -- the log cannot yet tell you which one you are in, so the screen says exactly that."""
    rows = []
    for e in events:
        if e.get("type") not in QUOTA_TYPES:
            continue
        d = e.get("data") or {}
        rows.append({
            "ts": e.get("ts"),
            "type": e.get("type"),
            "src": e.get("src"),
            "error_type": d.get("error_type"),
            "eta": iso_utc(d.get("until") or d.get("reset_at") or d.get("eta")),
            "detail": str(d.get("message") or d.get("reason") or "")[:160] or None,
        })
    span = "%s..%s" % (days[0], days[-1]) if days else "no day files at all"
    searched = ("docs/lab/events/*.jsonl — %d event(s) over %d day file(s) (%s), matching type in {%s}"
                % (len(events), len(days), span, ", ".join(QUOTA_TYPES)))
    return {
        "events": rows[-20:],
        "total": len(rows),
        "searched": searched,
        # GSL-132: the lead ("No quota event has ever been logged.") is already printed on the screen
        # beside this string, so it opened by saying the same thing again. It now begins with the part
        # the lead does not carry — why an empty section is not the same as a safe one.
        "why_empty": None if rows else (
            "The StopFailure hook that writes api.failure is wired, but it has never been observed "
            "firing — so this emptiness means 'never seen', not 'never happened'. A quiet quota and a "
            "dead hook look identical from here, and until one fires the difference is unknown."),
    }

# ───────────────────────────── collect: fleet (GSL-93) ────────────────────────

# The pane cap. manifest.md §5.slots: "слоты воркеров: max 3 (C5)".
SLOT_CAP = int(os.environ.get("GOSLEEP_SLOT_CAP", 3))

# How long a worker may say nothing before the card stops calling it "active". This is NOT a liveness
# probe and the threshold is not a claim about death -- see `worker_state()`.
QUIET_AFTER_S = int(os.environ.get("GOSLEEP_QUIET_AFTER_S", 900))

# The transcript is the ONLY place the model a worker actually ran on is written down by the runtime
# rather than by the worker. Cycles 49/50 are why this exists: a worker's self-report said one model
# and the transcript said another, and the transcript was right. So the Fleet card reads the SAME
# source the audit reads -- never the worker's word for it.
MODEL_RE = re.compile(r'"model"\s*:\s*"(claude-[^"]+)"')


def transcript_dir():
    d = os.environ.get("GOSLEEP_TRANSCRIPT_DIR")
    if d:
        return d, "env GOSLEEP_TRANSCRIPT_DIR"
    slug = re.sub(r"[^A-Za-z0-9]", "-", os.path.abspath(REPO))
    return os.path.join(os.path.expanduser("~"), ".claude", "projects", slug), "~/.claude/projects/<repo-slug>/<session-id>.jsonl"


def session_models(session_ids):
    """session_id -> the model(s) the RUNTIME recorded for that session.

    Scanned line-by-line with a regex rather than json.loads: a transcript is megabytes of turns and
    we want one field out of it. Absence is reported as unknown, never as a default -- a Fleet card
    that guesses "probably Opus" is exactly the lie cycles 49/50 were about.

    Distinct models in ONE session are kept and shown. That is not noise: it is the fingerprint of a
    mid-session model switch, and a card that collapsed it to a single value would hide the very
    discrepancy this field exists to expose."""
    root, how = transcript_dir()
    out = {}
    if not os.path.isdir(root):
        degrade("fleet-model", "no transcript dir at %s (%s) — every model reads unknown, never a default"
                % (root, how))
        return out, root, how
    for sid in session_ids:
        path = os.path.join(root, sid + ".jsonl")
        seen = {}
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if '"model"' not in line:
                        continue
                    for m in MODEL_RE.findall(line):
                        seen[m] = seen.get(m, 0) + 1
        except FileNotFoundError:
            continue                      # a session with no transcript on disk: unknown, not a guess
        except OSError as exc:
            degrade("fleet-model:" + sid[:8], exc)
            continue
        if seen:
            ranked = sorted(seen.items(), key=lambda kv: (-kv[1], kv[0]))
            out[sid] = {"model": ranked[0][0], "models": [k for k, _ in ranked],
                        "path": os.path.join(os.path.basename(root), sid + ".jsonl")}
    return out, root, how


def worker_state(ended_ts, age_s):
    """THE HONESTY OF THIS SCREEN LIVES IN THIS FUNCTION, so it has exactly three answers.

    `ended`  — a pane.ended was logged. This we KNOW; the runtime said so.
    `active` — an event landed within QUIET_AFTER_S. This we KNOW; something moved.
    `silent` — neither. This we DO NOT KNOW, and the word is chosen to say so.

    There is deliberately no `dead`. A worker deep in a long tool call and a worker whose process was
    killed emit exactly the same thing -- nothing -- and no amount of threshold-tuning separates them
    from inside the log. The PRD's instruction is literal: a worker nobody has heard from in an hour
    is not "working", it is silent, and the card must not launder silence into either death or work."""
    if ended_ts:
        return "ended", "the runtime logged pane.ended (SessionEnd) at %s — this one is over" % ended_ts
    if age_s is None:
        return "silent", "not one event carries a timestamp we could read — the age is unknown"
    if age_s <= QUIET_AFTER_S:
        return "active", "an event landed %s ago" % human_age(age_s)
    return "silent", (
        "nothing for %s, and no pane.ended. This is NOT 'dead' — a worker thinking inside a long tool "
        "call and a worker whose process is gone are both silent, and the log cannot tell them apart. "
        "Read it as unknown, never as working." % human_age(age_s))


def fleet_workers(events, cost):
    """One card per worker (PRD R5.2 screen 5, GSL-98): state / model / pane / started / last-event-age
    / tokens / current task.

    HOW A WORKER GETS A NAME AT ALL. `task.completed` is the ONE event that carries both a session_id
    and the worker's name, so it is the join that makes every other event attributable: bind the two
    once, and the session's whole trail — pane.started, agent.turn_ended, pane.ended — becomes that
    worker's trail. Nothing else in the log binds them: hook lines all say actor="claude" (the
    process, not the person), and the semantic src=emit lines that DO carry a worker's name carry no
    session_id at all.

    THE GAP THIS LEAVES, stated because it is load-bearing: a worker that never completed a task
    through the task system is never named, and therefore never gets a card. It is not missing from
    the fleet — it is missing from the LOG's vocabulary. `unnamed_sessions` counts them, and the
    roster below still lists whatever the emit channel could name."""
    named, tasks = {}, {}
    for e in events:
        raw = (e.get("data") or {}).get("raw")
        if not isinstance(raw, dict):
            continue
        sid = e.get("session_id")
        if not sid:
            continue
        # The C5 denylist exempts this ONE literal: it is a read-only key in an append-only log, and
        # reading it is not the power to take a pane. smoke.sh proves the exemption stays that narrow.
        nm = raw.get("teammate_name")
        if nm:
            named[sid] = nm
        subj = raw.get("task_subject")
        if subj:
            tasks[sid] = subj

    by_sid = {}
    for e in events:
        sid = e.get("session_id")
        if sid not in named:
            continue
        w = by_sid.setdefault(sid, {"events": 0, "types": {}, "first_ts": None, "last_ts": None,
                                    "started_ts": None, "ended_ts": None})
        w["events"] += 1
        ts, t = e.get("ts") or "", e.get("type") or "?"
        w["types"][t] = w["types"].get(t, 0) + 1
        if ts and (w["first_ts"] is None or ts < w["first_ts"]):
            w["first_ts"] = ts
        if ts > (w["last_ts"] or ""):
            w["last_ts"] = ts
        if t == "pane.started" and (w["started_ts"] is None or ts < w["started_ts"]):
            w["started_ts"] = ts
        if t == "pane.ended" and ts > (w["ended_ts"] or ""):
            w["ended_ts"] = ts

    models, root, how = session_models(list(by_sid))

    # Tokens are joined from the HAND-WRITTEN ledger, keyed on the worker's name -- the event log
    # carries no token counts at all. Two different sources, one card, and the card says which is which.
    ledger = {}
    for c in cost.get("cycles") or []:
        if c.get("worker"):
            ledger.setdefault(c["worker"], []).append(c)

    cards = []
    for sid, w in by_sid.items():
        name = named[sid]
        age = NOW - parse_ts(w["last_ts"]) if parse_ts(w["last_ts"] or "") else None
        age_s = int(age) if age is not None else None
        state, why = worker_state(w["ended_ts"], age_s)
        mi = models.get(sid)
        rows = ledger.get(name) or []
        outs = [r["tokens_out"] for r in rows if isinstance(r.get("tokens_out"), int)]
        cards.append({
            "name": name,
            "session_id": sid,
            "session_short": sid[:8],
            "state": state,
            "state_why": why,
            "last_ts": w["last_ts"],
            "last_age_s": age_s,
            "last_age_human": human_age(age),
            "model": mi["model"] if mi else None,
            "models": mi["models"] if mi else [],
            "model_source": mi["path"] if mi else None,
            "model_why": None if mi else (
                "no transcript on disk for this session under %s (%s). The model is UNKNOWN — and it "
                "stays unknown: the worker's own word for it is exactly what this field refuses to "
                "trust." % (root, how)),
            # Verified against the whole log, not inherited: zero events carry a pane id, and no hook
            # payload has a pane/window/tty field of any kind. The orchestrator knows the pane; the
            # log never learns it. So this is unknown by ABSENCE OF SOURCE, and the fix is a hook
            # change, not a renderer change.
            "pane": None,
            "pane_why": "no pane id reaches the event log — no hook payload carries one (checked: "
                        "zero events, any day, have a pane/window/tty field)",
            # `started_ts`, and deliberately not the obvious name for it: C5 bans the verb for creating
            # a worker in EVERY form, and here a rename costs nothing — so the capability word stays
            # banned rather than getting an exemption it does not need. The log's own vocabulary
            # (`pane.started`) is the more accurate one anyway: the chronicler never creates a pane, it
            # only observes that one opened. Do not rename this field.
            "started_ts": w["started_ts"],
            "started_why": None if w["started_ts"] else
                           "no pane.started for this session — the first event we hold is %s" % (w["first_ts"] or "none"),
            "first_ts": w["first_ts"],
            "task": tasks.get(sid),
            "events": w["events"],
            "types": dict(sorted(w["types"].items(), key=lambda kv: (-kv[1], kv[0]))[:6]),
            "tokens_out": sum(outs) if outs else None,
            "tokens_cycles": len(rows),
            # A NAME MISS, and it must never be allowed to read as "this worker spent nothing". The
            # two sources are typed by hand in two different places -- the log's name is whatever was
            # given at hire, the ledger's is whatever got written into the bullet at the end -- and
            # nothing forces them to agree. Today most of them do not.
            "tokens_why": None if outs else (
                "no TELEMETRY bullet uses worker=%s. The ledger's names and the log's names are typed "
                "by hand in two different places and nothing reconciles them, so this is a failed JOIN, "
                "not evidence of zero spend. Unknown, not free." % name),
            "tokens_source": "docs/handoff/ORCHESTRATION-STATE.md §TELEMETRY (worker=%s) — hand-written, "
                             "not an event" % name,
        })
    cards.sort(key=lambda c: (c["last_ts"] or ""), reverse=True)
    unnamed = len({e.get("session_id") for e in events if e.get("session_id")} - set(named))
    # The other half of the join failure, and the actionable half: ledger names that matched no card.
    # Printed rather than dropped, because seen next to the cards they are a diff the owner can fix --
    # `gsl81-reviewer` in the ledger vs `reviewer-lab` in the log is one worker with two names, and
    # only a human looking at both columns can say so.
    matched = {c["name"] for c in cards}
    ledger_only = sorted(n for n in ledger if n not in matched)
    return cards, unnamed, ledger_only


def fleet_census(events, hb, cost=None):
    """The Fleet screen's data (PRD R5.2, screen 5) and the slots axis of the runway (GSL-94).

    WHAT THIS CANNOT SEE, and says so rather than guessing:
      * No pane id reaches the event log -- CHECKED, across every day file: not one event carries a
        pane/window/tty field of any kind. The orchestrator knows the pane; the log never learns it.
      * No model reaches the event log either -- but the model is NOT unknown, because the runtime
        writes it to the session transcript. GSL-98 joins it in (see `fleet_workers`), from the same
        source the audit uses, never from the worker's self-report.
      * The one live count that is authoritative is the orchestrator's own heartbeat (`open_workers`).
        It is gitignored: on a fresh clone there is no heartbeat, and then the census is UNKNOWN --
        not zero. "Nobody is working" and "I cannot see who is working" must never render the same.

    `roster` (by actor) and `workers` (by session) are two DIFFERENT channels and neither subsumes the
    other, so both are kept. The roster sees whoever the emit lines name but cannot bind them to a
    session; the cards bind a session but only for a worker that completed a task. A worker can
    therefore appear in one and not the other, and pretending otherwise would invent a fleet.
    """
    actors = {}
    for e in events:
        a = e.get("actor") or "?"
        r = actors.setdefault(a, {"actor": a, "events": 0, "last_ts": None, "types": {}})
        r["events"] += 1
        ts = e.get("ts") or ""
        if ts > (r["last_ts"] or ""):
            r["last_ts"] = ts
        t = e.get("type") or "?"
        r["types"][t] = r["types"].get(t, 0) + 1
    for r in actors.values():
        age = NOW - parse_ts(r["last_ts"]) if parse_ts(r["last_ts"] or "") else None
        r["last_age_s"] = int(age) if age is not None else None
        r["last_age_human"] = human_age(age)
        r["types"] = dict(sorted(r["types"].items(), key=lambda kv: (-kv[1], kv[0]))[:6])

    roster = sorted(actors.values(), key=lambda r: (r["last_ts"] or ""), reverse=True)
    live = hb.get("open_workers") if isinstance(hb, dict) else None
    workers, unnamed, ledger_only = fleet_workers(events, cost or {})

    return {
        "open_workers": live,
        "cap": SLOT_CAP,
        "free_slots": (SLOT_CAP - live) if isinstance(live, int) else None,
        "cycle": hb.get("cycle") if isinstance(hb, dict) else None,
        "orchestrator_status": hb.get("status") if isinstance(hb, dict) else None,
        "orchestrator_context_pct": hb.get("context_pct") if isinstance(hb, dict) else None,
        "source": "docs/handoff/.orchestrator-heartbeat (gitignored — absent on a fresh clone)",
        "known": isinstance(live, int),
        "workers": workers,
        "unnamed_sessions": unnamed,
        "ledger_only": ledger_only,
        "quiet_after_s": QUIET_AFTER_S,
        # Where the cards came from, printed even when there are none: an empty Fleet screen that
        # cannot say where it looked is indistinguishable from a broken one.
        "workers_searched": "docs/lab/events/*.jsonl — a card per session named by a task.completed "
                            "event (the only event carrying BOTH a session_id and the worker's name); "
                            "the model is then read from that session's transcript",
        "roster": roster[:20],
        "blind_spots": [
            "no pane id in the event log — checked: not one event, any day, carries a pane/window/tty "
            "field. The cards read `pane: unknown` and no amount of rendering can fix that; the hooks "
            "would have to emit it.",
            "a worker is named only by task.completed — one that never completed a task through the "
            "task system gets NO card, however hard it worked. %d session(s) in the log are nameless "
            "for exactly this reason." % unnamed,
            "tokens come from the hand-written ORCHESTRATION-STATE ledger, joined by worker NAME — the "
            "event log carries no token counts at all. The two name spaces are typed by hand and do "
            "not reconcile: %d ledger name(s) match no card at all (%s%s). A card with no tokens is a "
            "failed join, NOT a worker that spent nothing."
            % (len(ledger_only), ", ".join(ledger_only[:6]) or "none",
               ", …" if len(ledger_only) > 6 else ""),
            "hook-written lines all carry actor=\"claude\"; only semantic (src=emit) lines name the "
            "worker, and those carry no session_id — so the roster below cannot be joined to the cards",
        ],
    }

# ───────────────────────────── collect: tasks board (GSL-93) ──────────────────

JIRA_BASE = os.environ.get("GOSLEEP_JIRA_BASE", "https://ainstance-labs.atlassian.net/browse")
KEY_RE = re.compile(r"\b(GSL-\d+)\b")


def gh_base(remote):
    """github.com/<org>/<repo> out of whatever form `git remote get-url` handed us. Returns None if
    the remote is missing or not GitHub — and then the board simply carries no commit links, rather
    than plausible ones pointing nowhere."""
    if not remote:
        return None
    m = re.search(r"github\.com[:/]+([^/]+)/([^/\s]+?)(?:\.git)?/?$", remote)
    return "https://github.com/%s/%s" % (m.group(1), m.group(2)) if m else None


LEAD_KEY_RE = re.compile(r"^(GSL-\d+)\b")           # a commit subject STARTS with the task's key
BRANCH_KEY_RE = re.compile(r"(GSL-\d+)-[\w.-]+$")   # ...and an epic branch is <EPIC-KEY>-<slug>


def default_branch():
    """The trunk an epic branch is measured against. None if this is not a repository with one."""
    rc, out, _ = run(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
    if rc == 0 and out:
        return out
    for cand in ("origin/main", "main", "origin/master", "master"):
        if run(["git", "rev-parse", "--verify", "--quiet", cand])[0] == 0:
            return cand
    return None


def epic_ranges():
    """Every epic git can see, and the commit range that IS that epic. (key, range, source).

    Membership is read off git TOPOLOGY, and this works only because the delivery conventions make it
    exact: ONE branch per epic (`<EPIC-KEY>-<slug>`), ONE commit per task (subject starts with the task
    key), and a REGULAR merge, never a squash. So:

        merged epic     -> the merge commit's second parent IS the epic's own history:  mc^1..mc^2
        epic in flight  -> its branch is simply not in the trunk yet:              trunk..<branch>

    The PR body carries a task checklist and would have been the easier source. It is the wrong one:
    it is prose, written by hand, at the moment we OPENED the PR. A rollup built on it reports the epic
    we meant to ship. The topology reports the one we did -- and when the two disagree, the second is
    the one the owner needs at 03:00."""
    out, seen = [], set()

    rc, log, _ = run(["git", "log", "--merges", "-n", "200", "--pretty=%H%x1f%s"])
    if rc == 0:
        for line in log.splitlines():
            sha, _, subj = line.partition("\x1f")
            m = BRANCH_KEY_RE.search(subj.strip())
            if m and m.group(1) not in seen:
                seen.add(m.group(1))
                out.append((m.group(1), "%s^1..%s^2" % (sha, sha), "merge-commit"))

    trunk = default_branch()
    rc, refs, _ = run(["git", "for-each-ref", "--format=%(refname:short)",
                       "refs/heads", "refs/remotes/origin"])
    if rc == 0:
        for ref in refs.splitlines():
            name = ref.split("/", 1)[1] if ref.startswith("origin/") else ref
            m = re.match(r"(GSL-\d+)-", name)
            if not m or m.group(1) in seen:
                continue
            seen.add(m.group(1))
            if not trunk:
                out.append((m.group(1), None, "no-trunk"))
            elif run(["git", "merge-base", "--is-ancestor", ref, trunk])[0] == 0:
                # Already in the trunk, yet no merge commit named it: squashed, fast-forwarded, or
                # merged before the window this build reads. Its tasks are NOT knowable from topology,
                # and a guess here would put tasks under an epic that never carried them.
                out.append((m.group(1), None, "merged-unwitnessed"))
            else:
                out.append((m.group(1), "%s..%s" % (trunk, ref), "branch"))
    return out


MEMBERSHIP_WHY = {
    "merge-commit": "read off the epic's merge commit (mc^1..mc^2) — the exact commits it merged",
    "branch": "read off the epic's branch, which the trunk does not carry yet",
    "merged-unwitnessed": "the epic's branch is already in the trunk but no merge commit names it "
                          "(squashed, fast-forwarded, or older than this build's window), so which "
                          "tasks it carried is NOT knowable from the topology and is left unclaimed",
    "no-trunk": "this checkout has no trunk (no main/master) to measure the branch against",
}


def epics_rollup(rows, prs, issues, issue_by_key):
    """F5-S3, second half: the epic folds up its tasks and shows its PR, and its PR's state.

    The invariant is ONE PR per epic. When there is none -- and today GSL-90 has none, the branch is
    pushed and the PR is not open -- the card says so. It does not borrow the epic's GitHub ISSUE
    number and dress it as a pull request: they share a numbering space, so the wrong one is not just
    wrong, it RESOLVES, and the owner lands on a real page that is not the thing he clicked."""
    pr_by_key = {}
    for p in prs:
        for key in KEY_RE.findall("%s %s" % (p.get("title") or "", p.get("headRefName") or "")):
            pr_by_key.setdefault(key, p)

    epics = []
    for key, rng, source in epic_ranges():
        tasks, commits = [], 0
        if rng:
            rc, log, _ = run(["git", "log", "--pretty=%s", rng])
            if rc == 0:
                for subj in log.splitlines():
                    m = LEAD_KEY_RE.match(subj.strip())
                    if m and m.group(1) != key:
                        commits += 1
                        if m.group(1) not in tasks:
                            tasks.append(m.group(1))

        p = pr_by_key.get(key)
        issue = issue_by_key.get(key)
        by_status = tally([{"s": (rows.get(t) or {}).get("status") or "unknown"} for t in tasks], "s")
        epics.append({
            "key": key,
            "summary": (rows.get(key) or {}).get("summary") or (issue or {}).get("title"),
            "jira_url": "%s/%s" % (JIRA_BASE, key),
            "gh_url": (issue or {}).get("url"),
            "gh_number": (issue or {}).get("number"),
            "pr": {"number": p.get("number"), "state": p.get("state"), "url": p.get("url"),
                   "title": p.get("title")} if p else None,
            # An absent PR is a fact about the DELIVERY, not a hole in the page: the invariant says one
            # PR per epic, so an epic with commits and no PR is work that exists nowhere GitHub can see.
            "pr_why": None if p else ("no pull request names this epic" +
                                      ("" if issues or prs else " — and this build could not reach "
                                       "GitHub at all, so it may exist and be unseen here")),
            "tasks": tasks,
            "task_count": len(tasks),
            "commits": commits,
            "by_status": by_status,
            "membership": source,
            "membership_why": MEMBERSHIP_WHY[source],
            "merged": source == "merge-commit",
        })
    return epics


def tasks_board(events, git, prs, issues):
    """The Tasks screen's data (PRD R5.2, screen 3; F5-S3 lands in GSL-96).

    Rows are keyed on the Jira key, and every cell is EARNED — but "earned" turned out to be a higher
    bar than "on disk". The GH column used to be absent on the grounds that no machine-readable source
    maps a key to an issue number; the mirror is in fact readable through `gh` (the key is in the issue
    TITLE), which this build already reaches for pull requests. So the column is filled from GitHub
    when GitHub answers, and left EMPTY WITH A REASON when it does not. What is still refused is the
    guess in between.

    The tracker STATUS comes from `tracker.issue.updated` (src=poll-fill), and it is only as fresh as
    the last poll — which needs Jira credentials the laboratory does not hold (C1), so in practice it
    is fed by hand. The row therefore carries the AGE of its status, and the screen shows it.

    And the status is never INFERRED. Most rows here have a commit and no status, and a commit is the
    single most tempting thing to read as "Done" — it is not. It witnesses that code landed; it says
    nothing about what Jira thinks, which is the only thing the status column claims to report. A row
    that says `unknown` while carrying a commit is not a gap in this board: it is the board declining
    to answer a question it was never told the answer to."""
    ghb = gh_base(git.get("remote"))
    rows = {}

    # The mirror, read off the issue TITLE ("GSL-101: [Docs] ..."). An issue whose title carries no key
    # maps to nothing — it is not guessed at by position, adjacency, or creation order.
    issue_by_key = {}
    for i in issues or []:
        m = KEY_RE.search(i.get("title") or "")
        if m:
            issue_by_key.setdefault(m.group(1), i)

    def row(key):
        return rows.setdefault(key, {
            "key": key, "status": None, "status_ts": None, "status_age_s": None,
            "summary": None, "commits": [], "dev_history": [], "prs": [],
            "jira_url": "%s/%s" % (JIRA_BASE, key), "gh_url": None,
        })

    for e in events:
        if not str(e.get("type", "")).startswith("tracker.issue."):
            continue
        d = e.get("data") or {}
        key = d.get("key")
        if not key:
            continue
        r = row(key)
        # `occurred_at` is the fact's OWN time (when Jira says it moved); the envelope `ts` is when we
        # LEARNED it. Prefer the former, normalised — Jira writes it with an offset, the log writes Z,
        # and the two must be in one format before `>=` is allowed anywhere near them.
        st = d.get("status")
        ts = iso_utc(d.get("occurred_at")) or e.get("ts")
        # `tracker.issue.transitioned` witnesses THAT an issue moved, never WHERE TO: the MCP payload
        # carries a transition id, not a status name, so `data.transition` is the empty string. It is
        # a timestamp, not a status, and must not be allowed to overwrite one.
        if st and ts and ts >= (r["status_ts"] or ""):
            r["status"], r["status_ts"] = st, ts
        if d.get("summary"):
            r["summary"] = d["summary"]

    for c in git.get("recent") or []:
        for key in KEY_RE.findall(c.get("subject") or ""):
            r = row(key)
            if len(r["commits"]) < 8:
                r["commits"].append({
                    "sha": c["sha"], "subject": c["subject"], "ts": c.get("ts"),
                    "url": ("%s/commit/%s" % (ghb, c["sha"])) if ghb else None,
                })

    for p in sorted(glob.glob(os.path.join(REPO, "docs", "dev_history", "GSL-*.md"))):
        base = os.path.basename(p)
        m = KEY_RE.match(base)
        if m:
            row(m.group(1))["dev_history"].append({
                "name": base, "href": os.path.relpath(p, os.path.join(LAB, "site")),
            })

    for p in prs:
        # GSL-130 (root): a PR normally carries its key in BOTH title ("GSL-136 …") and branch
        # ("GSL-136-…"), so KEY_RE.findall returned it twice and the same PR landed on the row's list
        # twice — one #NN#NN token to the eye, with no space between the two anchors and so no wrap
        # point either. dict.fromkeys keeps each DISTINCT key once (a PR that names two real keys still
        # maps to both). The view keeps its own url de-dup as a second line of defence.
        for key in dict.fromkeys(KEY_RE.findall("%s %s" % (p.get("title") or "", p.get("headRefName") or ""))):
            row(key)["prs"].append({"number": p.get("number"), "state": p.get("state"),
                                    "url": p.get("url"), "title": p.get("title")})

    for key, i in issue_by_key.items():
        row(key)["gh_url"] = i.get("url")
        row(key)["gh_number"] = i.get("number")

    for r in rows.values():
        r.setdefault("gh_number", None)
        age = NOW - parse_ts(r["status_ts"]) if parse_ts(r["status_ts"] or "") else None
        r["status_age_s"] = int(age) if age is not None else None
        r["status_age_human"] = human_age(age)

    def sort_key(r):
        m = re.match(r"GSL-(\d+)", r["key"])
        return -int(m.group(1)) if m else 0

    ordered = sorted(rows.values(), key=sort_key)
    by_status = tally([{"s": r["status"] or "unknown"} for r in ordered], "s")
    freshest = max([r["status_ts"] for r in ordered if r["status_ts"]], default=None)
    tracker_age = NOW - parse_ts(freshest) if parse_ts(freshest or "") else None

    return {
        "rows": ordered,
        "by_status": by_status,
        "todo": by_status.get("To Do", 0),
        "tracker_last_polled": freshest,
        "tracker_age_s": int(tracker_age) if tracker_age is not None else None,
        "tracker_age_human": human_age(tracker_age),
        # The board is only as true as its last poll. Above this, the To Do count is a NUMBER FROM
        # THE PAST wearing the present tense — and GSL-94's work-remaining clock must refuse it.
        "tracker_stale": (tracker_age is None) or (tracker_age > 12 * 3600),
        "gh_base": ghb,
        "epics": epics_rollup(rows, prs, issues or [], issue_by_key),
        "gh_issue_links": bool(issue_by_key),
        "gh_why": "" if issue_by_key else
                  "this build could not read the GitHub issue mirror (no gh, no network, or no "
                  "GOSLEEP_GH_JSON), so the GH column is empty rather than filled with a plausible "
                  "wrong link — the mirror exists, this build simply did not see it",
    }

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
    # GSL-132: ONE instant for the stamp and for every age printed beside it. These ages used to be
    # measured against NOW (process start) while generated_at was stamped here, at assembly — so a
    # pass that spent 3s collecting (a slow gh, a big log) printed "7s old" next to a stamp that
    # says 10s, in the very block that teaches the reader to ADD two ages. Both numbers truncate to
    # the second from the same clock reading, so `max_event_age_s == generated_at − latest_event_ts`
    # holds exactly, and anyone re-doing the sum from the file gets the file's own answer.
    gen = time.time()
    gen_iso = datetime.datetime.fromtimestamp(gen, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    age = (gen - parse_ts(last_ts)) if last_ts and parse_ts(last_ts) else None
    hb = ctx["heartbeat"]
    hb_age = None
    if hb and hb.get("ts") and parse_ts(hb["ts"]):
        hb_age = gen - parse_ts(hb["ts"])

    q_open = [q for q in ctx["questions"] if q.get("status") == "open"]
    status = {
        "schema": "gosleep.lab.status/1",
        "generated_at": gen_iso,
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

# ═════════════════════ the autonomy runway (GSL-94, PRD R5.1 / F5-S1) ═════════════════════
#
# ONE headline answers the only question the owner actually asks at midnight -- "can I go to sleep?"
# -- and it answers it with evidence, not vibes. It is the nearest of SIX independent exhaustion
# clocks, with the binding one named.
#
# THREE RULES THIS THING LIVES BY. Each was paid for.
#
# 1. A CLOCK WITH NO SOURCE IS `unknown`, NEVER A COMFORTABLE DEFAULT. Guess an axis long and min()
#    gets LONGER -- the runway grows because we know LESS, and the dashboard tells the owner to go to
#    sleep on evidence it does not have. So an unreadable axis does not silently drop out of the
#    minimum: it turns the answer from "≈ 4h" into "≤ 4h, and 2 of 6 clocks are unreadable". Less
#    knowledge must never read as more runway.
#
# 2. `unknown` AND `clear` ARE DIFFERENT AND MUST NEVER RENDER THE SAME. "No quota wait is armed" is
#    knowledge -- that clock is provably not the constraint, and it does not weaken the answer.
#    "The heartbeat is missing so I cannot see the fleet" is ignorance. One is a green tick, the
#    other is a hole in the evidence, and a dashboard that draws them alike has learned nothing from
#    Phase 4.
#
# 3. EXHAUSTION DOES NOT MEAN THE SAME THING ON EVERY AXIS, so min() over the raw six is a lie by
#    arithmetic. Hitting the context ceiling forces a ROLL, which the watchdog performs by itself and
#    the night survives. Filling all three panes makes the fourth worker QUEUE. Running out of To Do
#    is the job being FINISHED. None of those are a reason to wake anybody, and a naive
#    min(0h, 4h, 8h) would scream "RUNWAY 0h" because a pane is busy. So every clock declares what its
#    own zero MEANS:
#         stops     -> the night ends here without you   (budget exceeded, quota window, open BLOCKER)
#         degrades  -> the night continues, worse        (context roll, full pane queue)
#         completes -> the night ends here, happily      (no work left)
#    RUNWAY is the nearest `stops`. `next_event` is the nearest of ALL six, so nothing is hidden --
#    the page shows both, and says which is which.

CONTEXT_CEILING_PCT = int(os.environ.get("GOSLEEP_CONTEXT_CEILING_PCT", 80))   # watchdog.sh:133
ROLL_CYCLES_LOW  = int(os.environ.get("GOSLEEP_ROLL_CYCLES_LOW", 8))           # PRD R5.1: the 8-15
ROLL_CYCLES_HIGH = int(os.environ.get("GOSLEEP_ROLL_CYCLES_HIGH", 15))         # cycle roll heuristic
QUOTA_NOTE_RE = re.compile(r"quota-wait until\s+(\d{4}-\d{2}-\d{2}T[\d:]+Z?)")  # watchdog.sh:287


def clock(axis, label, on_exhaustion, state, hours=None, eta=None, gauge=None, why="", sources=()):
    """One exhaustion clock. `state` is the whole point, so it is never inferred from `hours`:

         counting  -- a finite number of hours, from real data
         exhausted -- it is out, now (hours = 0)
         clear     -- KNOWN not to be a constraint (0 blockers, free panes, no quota wait armed)
         unknown   -- the source could not be read. Bounds the answer; never drops out silently.
    """
    return {"axis": axis, "label": label, "on_exhaustion": on_exhaustion, "state": state,
            "hours": (round(hours, 2) if isinstance(hours, (int, float)) else None),
            "eta": eta, "gauge": gauge, "why": why, "sources": list(sources)}


def _pulse_rate(pulses):
    """Context %/hour and cycles/hour, measured since the last ROLL.

    A roll resets the context, so a window that straddles one measures a fall and concludes the
    orchestrator will never fill up again -- the most dangerous possible reading of this number. So:
    cut at the last drop, and measure only the segment since."""
    pts = [(parse_ts(h.get("ts")), h.get("context_pct"), h.get("cycle")) for h in pulses]
    pts = [p for p in pts if p[0] is not None and isinstance(p[1], int)]
    if len(pts) < 2:
        return None, None, len(pts)
    cut = 0
    for i in range(1, len(pts)):
        if pts[i][1] < pts[i - 1][1]:
            cut = i                              # context fell => a roll happened here
    seg = pts[cut:]
    if len(seg) < 2:
        return None, None, len(seg)
    span_h = (seg[-1][0] - seg[0][0]) / 3600.0
    if span_h <= 0:
        return None, None, len(seg)
    ctx_rate = (seg[-1][1] - seg[0][1]) / span_h
    cyc_rate = None
    if isinstance(seg[0][2], int) and isinstance(seg[-1][2], int):
        cyc_rate = (seg[-1][2] - seg[0][2]) / span_h
    return ctx_rate, cyc_rate, len(seg)


def clock_context(hb, pulses):
    """Orchestrator context vs the ceiling -- CROSS-CHECKED, because PRD R5.1 says in so many words:
    do not trust the number alone. A model reporting its own context is the "fabricated 80% vs real
    63%" failure; the independent check is the roll heuristic (an orchestrator rolls every 8-15
    cycles), and where the two disagree we take the SHORTER. An optimistic clock is the only kind
    that can hurt you here."""
    src = ["docs/handoff/.orchestrator-heartbeat (gitignored)", "watchdog.sh WD_CONTEXT_CEILING_PCT=%d" % CONTEXT_CEILING_PCT]
    pct = hb.get("context_pct") if isinstance(hb, dict) else None
    if not isinstance(pct, int):
        return clock("context", "orchestrator context", "degrades", "unknown",
                     why="no heartbeat on disk — it is gitignored, so a fresh clone has none. "
                         "A missing pulse is not a healthy orchestrator; it is an invisible one.",
                     sources=src)

    # GSL-118: "%d%% of %d%%" read as a product ("50 percent OF 80 percent" = 40%), the opposite of
    # the fact — the level, and the ceiling it rolls at. Two percentages need the relation spelled out.
    gauge = "%d%% (rolls at %d%%)" % (pct, CONTEXT_CEILING_PCT)
    if pct >= CONTEXT_CEILING_PCT:
        return clock("context", "orchestrator context", "degrades", "exhausted", hours=0.0, gauge=gauge,
                     why="at/over the ceiling: the watchdog forces a handoff. Planned, not fatal — "
                         "the night continues on the other side of a roll.", sources=src)

    ctx_rate, cyc_rate, n = _pulse_rate(pulses)
    if ctx_rate is None:
        return clock("context", "orchestrator context", "degrades", "unknown", gauge=gauge,
                     why="%d usable pulse(s) since the last roll — a level is not a rate, and two "
                         "readings are the minimum for a prediction." % n, sources=src)
    if ctx_rate <= 0:
        return clock("context", "orchestrator context", "degrades", "clear", gauge=gauge,
                     why="context is not growing (%.1f %%/h since the last roll)" % ctx_rate, sources=src)

    self_h = (CONTEXT_CEILING_PCT - pct) / ctx_rate
    why = "self-reported %d%%, rising %.1f %%/h -> ceiling %d%% in %.1fh" % (
        pct, ctx_rate, CONTEXT_CEILING_PCT, self_h)

    # The independent estimate. It needs a cycle rate and a cycle count since the roll.
    hours = self_h
    if cyc_rate and cyc_rate > 0:
        cycles_now = hb.get("cycle")
        seg_cycles = None
        if isinstance(cycles_now, int):
            pts = [(parse_ts(h.get("ts")), h.get("context_pct"), h.get("cycle")) for h in pulses]
            pts = [p for p in pts if p[0] is not None and isinstance(p[1], int)]
            cut = 0
            for i in range(1, len(pts)):
                if pts[i][1] < pts[i - 1][1]:
                    cut = i
            if pts and isinstance(pts[cut][2], int):
                seg_cycles = cycles_now - pts[cut][2]
        if isinstance(seg_cycles, int):
            roll_h = max(0.0, (ROLL_CYCLES_LOW - seg_cycles) / cyc_rate)
            hours = min(self_h, roll_h)
            why += "; roll heuristic (%d-%d cycles, %d done since the roll at %.1f cyc/h) says %.1fh" % (
                ROLL_CYCLES_LOW, ROLL_CYCLES_HIGH, seg_cycles, cyc_rate, roll_h)
            if self_h > 0 and (max(self_h, roll_h) / max(0.01, min(self_h, roll_h))) >= 2.0:
                why += " — THE TWO DISAGREE BY MORE THAN 2x; taking the shorter, and do not trust " \
                       "the self-report alone"
            else:
                why += " — taking the shorter"

    return clock("context", "orchestrator context", "degrades", "counting", hours=hours, gauge=gauge,
                 why=why, sources=src)


def clock_budget(cost, cyc_rate):
    """Token ceiling. TODAY THIS IS `unknown`, AND THAT IS THE FINDING, not a bug.

    manifest §5.phase-ceiling delegates the ceiling to "the epic brief"; no brief on disk names a
    number. So §5.warn-80 and §3.budget (BUDGET_EXCEEDED = BLOCKER) are rules that cannot fire, and
    this clock has a numerator with no denominator. Inventing one would make the whole runway finite
    on a fabricated basis -- exactly the failure this indicator exists to prevent."""
    src = ["docs/handoff/ORCHESTRATION-STATE.md §TELEMETRY", "manifest.md §5.phase-ceiling"]
    used, ceiling = cost.get("cumulative_total"), cost.get("ceiling")
    if ceiling is None:
        return clock("budget", "token budget", "stops", "unknown",
                     gauge=("%s used, no ceiling" % f"{used:,}") if used else None,
                     why=cost.get("ceiling_why") or "no ceiling on disk", sources=src)
    if used is None:
        return clock("budget", "token budget", "stops", "unknown",
                     why="a ceiling exists but the telemetry ledger has no cumulative total to "
                         "measure against", sources=src)

    gauge = "%s of %s (%s%%)" % (f"{used:,}", f"{ceiling:,}", cost.get("used_pct"))
    if used >= ceiling:
        return clock("budget", "token budget", "stops", "exhausted", hours=0.0, gauge=gauge,
                     why="cumulative spend is at or over the ceiling — manifest §3.budget makes this "
                         "a BLOCKER, not a warning", sources=src)

    # Per-cycle burn from the ledger's own running total; cycles/hour from the heartbeat. Both are
    # needed: the ledger has cycle NUMBERS but no timestamps, so it cannot tell time by itself.
    totals = [c["running_total"] for c in cost.get("cycles", []) if c.get("running_total")]
    per_cycle, measurable = None, len(totals) >= 2
    if measurable:
        deltas = [b - a for a, b in zip(totals, totals[1:]) if b > a]
        if deltas:
            per_cycle = sum(deltas[-8:]) / len(deltas[-8:])       # the recent 8, not all history

    # A ledger that is not growing is not an unreadable ledger -- it is a fleet that is not spending.
    # That is KNOWLEDGE, and it belongs on the green side of the line: `clear`, not `unknown`. The
    # distinction is the whole discipline of this indicator, and it applies to the budget too.
    if measurable and not per_cycle:
        return clock("budget", "token budget", "stops", "clear", gauge=gauge,
                     why="the telemetry ledger shows no spend growth — nothing is burning against the "
                         "ceiling", sources=src)
    if not per_cycle or not cyc_rate or cyc_rate <= 0:
        return clock("budget", "token budget", "stops", "unknown", gauge=gauge,
                     why="a ceiling and a total, but no burn RATE: the telemetry ledger records "
                         "cycle numbers and no timestamps, so it needs the heartbeat to tell time — "
                         "and that is missing or too short to measure.", sources=src)

    hours = (ceiling - used) / (per_cycle * cyc_rate)
    return clock("budget", "token budget", "stops", "counting", hours=hours, gauge=gauge,
                 why="%s left; burning ~%s tokens/cycle at %.1f cycles/h" % (
                     f"{ceiling - used:,}", f"{int(per_cycle):,}", cyc_rate), sources=src)


def clock_quota(events, hb):
    """The quota window. Armed either by an unmatched `quota.wait_started`, or by the literal string
    `quota-wait until <ISO>` in the heartbeat note (the form watchdog.sh already parses).

    Honest caveat, carried onto the page: `api.failure` (src=hook:StopFailure) has NEVER fired in
    this repository. The hook is wired and the type is in the vocabulary, but nothing has ever forced
    one -- so "no quota wait is armed" rests on a mechanism that has never been observed working. That
    is `clear`, but it is a `clear` with an asterisk, and the asterisk is printed."""
    src = ["docs/lab/events/*.jsonl (quota.wait_started / quota.wait_ended, api.failure)",
           "docs/handoff/.orchestrator-heartbeat note"]
    started, ended, fails = None, None, 0
    for e in events:
        t = e.get("type")
        if t == "quota.wait_started":
            started = e
        elif t == "quota.wait_ended":
            ended = e
        elif t == "api.failure" and (e.get("data") or {}).get("error_type") in ("rate_limit", "overloaded"):
            fails += 1

    eta = None
    if started and (not ended or (ended.get("ts") or "") < (started.get("ts") or "")):
        d = started.get("data") or {}
        eta = iso_utc(d.get("until") or d.get("reset_at") or d.get("eta"))
    if not eta and isinstance(hb, dict):
        m = QUOTA_NOTE_RE.search(str(hb.get("note") or ""))
        if m:
            eta = iso_utc(m.group(1) if m.group(1).endswith("Z") else m.group(1) + "Z")

    caveat = ("(api.failure has never fired in this repo — the StopFailure hook is wired but has "
              "never been observed, so this clear rests on an untested mechanism)")
    if not eta:
        if started and not ended:
            return clock("quota", "quota window", "stops", "unknown",
                         why="a quota wait is armed but carries no reset ETA — the fleet is paused "
                             "for an unknown length of time", sources=src)
        return clock("quota", "quota window", "stops", "clear",
                     gauge="%d rate-limit/overload failure(s) logged" % fails,
                     why="no quota wait is armed " + caveat, sources=src)

    secs = parse_ts(eta) - NOW if parse_ts(eta) else None
    if secs is None:
        return clock("quota", "quota window", "stops", "unknown",
                     why="a quota wait is armed but its ETA (%r) could not be read" % eta, sources=src)
    if secs <= 0:
        return clock("quota", "quota window", "stops", "clear", eta=eta,
                     why="the quota window has already reset (%s)" % eta, sources=src)
    return clock("quota", "quota window", "stops", "counting", hours=secs / 3600.0, eta=eta,
                 gauge="resets %s" % eta,
                 why="the fleet quiesces until the window resets at %s" % eta, sources=src)


def clock_slots(fleet):
    """Panes in use vs the cap of 3 (manifest §5.slots). Filling them QUEUES the next worker; it does
    not stop the night -- so this clock degrades, and never drives the headline."""
    src = ["docs/handoff/.orchestrator-heartbeat open_workers", "manifest.md §5.slots (max 3)"]
    live, cap = fleet.get("open_workers"), fleet.get("cap")
    if not isinstance(live, int):
        return clock("slots", "pane slots", "degrades", "unknown",
                     why="no heartbeat: the live worker count is unreadable. Not zero — unreadable.",
                     sources=src)
    gauge = "%d/%d" % (live, cap)
    if live >= cap:
        return clock("slots", "pane slots", "degrades", "exhausted", hours=0.0, gauge=gauge,
                     why="every pane is busy — the next worker queues until one frees. Queueing, "
                         "not stopping.", sources=src)
    return clock("slots", "pane slots", "degrades", "clear", gauge=gauge,
                 why="%d free slot(s)" % (cap - live), sources=src)


def clock_blockers(queue):
    """Open BLOCKERs. The ONLY question type that can stop a night: manifest §3 gives a BLOCKER no
    default, ever, so it has no timer and cannot resolve itself. A DECISION auto-applies at its
    deadline and the night keeps moving; a BLOCKER waits for a human.

    A BLOCKER open at midnight means the runway is already zero for the work it names. This clock is
    deliberately CONSERVATIVE -- it reports zero even though other tasks may still advance -- because
    the bias of a "can I sleep?" indicator must be toward waking you, never toward comfort."""
    src = ["docs/lab/questions/queue.jsonl (type=BLOCKER, status=open)", "manifest.md §3"]
    b = queue.get("open_blockers") or []
    if not b:
        return clock("blockers", "open blockers", "stops", "clear", gauge="0",
                     why="nothing the fleet is doing is waiting on a human", sources=src)
    ids = ", ".join(str(x.get("id")) for x in b[:3])
    return clock("blockers", "open blockers", "stops", "exhausted", hours=0.0, gauge=str(len(b)),
                 why="%d open BLOCKER(s) (%s) — a BLOCKER takes no default and has no timer; the work "
                     "it names is parked until you answer it" % (len(b), ids), sources=src)


def clock_work(tasks, cyc_rate):
    """Work remaining. Its exhaustion is the GOOD ending -- Done = idle -- so it never drives the
    runway headline; it only tells you when the fleet will run out of things to do.

    Refuses a stale board on purpose. The To Do count comes from `tracker.issue.updated`, and the
    laboratory holds no Jira credentials (C1), so the poll is fed by hand. Reading a count from last
    Tuesday and printing it in the present tense is exactly the class of lie this dashboard exists to
    not tell."""
    src = ["docs/lab/events/*.jsonl (tracker.issue.updated, src=poll-fill)"]
    if tasks.get("tracker_stale"):
        last = tasks.get("tracker_last_polled")
        return clock("work", "work remaining", "completes", "unknown",
                     gauge=("%d To Do (stale)" % tasks.get("todo", 0)) if last else None,
                     why="the task board has not been polled since %s (%s ago). Its To Do count is a "
                         "number from the past in the present tense, and this clock will not use it."
                         % (last, tasks.get("tracker_age_human")) if last else
                         "the task board has never been polled on this machine", sources=src)
    todo = tasks.get("todo", 0)
    if todo == 0:
        return clock("work", "work remaining", "completes", "exhausted", hours=0.0, gauge="0 To Do",
                     why="no work left on the board — the fleet goes idle. The good ending.", sources=src)
    if not cyc_rate or cyc_rate <= 0:
        return clock("work", "work remaining", "completes", "unknown", gauge="%d To Do" % todo,
                     why="%d task(s) left, but no cycle rate to turn that into hours (the heartbeat "
                         "is missing or too short)" % todo, sources=src)
    hours = todo / cyc_rate                     # one task per cycle is this project's own invariant
    return clock("work", "work remaining", "completes", "counting", hours=hours,
                 gauge="%d To Do" % todo,
                 why="%d task(s) left at %.1f cycles/h, one task per cycle" % (todo, cyc_rate),
                 sources=src)


def compute_runway(ctx):
    """RUNWAY = the nearest clock whose exhaustion STOPS the night. `next_event` = the nearest of all
    six, whatever it means. Both are reported, and every clock says which it is."""
    pulses = ctx["pulses"]
    hb = ctx["heartbeat"] or {}
    _, cyc_rate, _ = _pulse_rate(pulses)

    clocks = [
        clock_context(hb, pulses),
        clock_budget(ctx["cost"], cyc_rate),
        clock_quota(ctx["events"], hb),
        clock_slots(ctx["fleet"]),
        clock_blockers(ctx["queue"]),
        clock_work(ctx["tasks"], cyc_rate),
    ]

    def nearest(pool):
        live = [c for c in pool if c["hours"] is not None]
        return min(live, key=lambda c: c["hours"]) if live else None

    stoppers = [c for c in clocks if c["on_exhaustion"] == "stops"]
    binding  = nearest(stoppers)
    nxt      = nearest(clocks)

    # An unreadable clock cannot be ruled out, so it cannot be dropped: it turns the answer from an
    # ESTIMATE into an UPPER BOUND. Knowing less must never read as more runway (rule 1, above).
    unknown_stoppers = [c["axis"] for c in stoppers if c["state"] == "unknown"]
    unknown_all      = [c["axis"] for c in clocks if c["state"] == "unknown"]

    # Four answers, and the difference between the last two is the whole discipline:
    #   exact   -- a stopping clock is counting, and we can read every stopping clock.  "≈ 4h"
    #   upper   -- a stopping clock is counting, but one we cannot read might be shorter. "≤ 4h"
    #   clear   -- NO stopping clock is counting, and we can read them all. Nothing will stop you.
    #   unknown -- no stopping clock is counting, but one is unreadable. We cannot say. NOT "clear".
    if binding is not None:
        bound = "upper" if unknown_stoppers else "exact"
    else:
        bound = "unknown" if unknown_stoppers else "clear"

    return {
        "hours": binding["hours"] if binding else None,
        "bound": bound,                      # exact | upper | unknown
        "binding": binding["axis"] if binding else None,
        "binding_label": binding["label"] if binding else None,
        "binding_why": binding["why"] if binding else None,
        "binding_eta": binding["eta"] if binding else None,
        "unknown_axes": unknown_stoppers,
        "unknown_axes_all": unknown_all,
        "known": len(clocks) - len(unknown_all),
        "total": len(clocks),
        "next_event": ({"axis": nxt["axis"], "label": nxt["label"], "hours": nxt["hours"],
                        "on_exhaustion": nxt["on_exhaustion"], "why": nxt["why"]} if nxt else None),
        "clocks": clocks,
        # The reasoning trace, one line per axis. This is the "evidence, not vibes" half of R5.1:
        # the owner must be able to see WHY the number is what it is without opening a single file.
        "trace": ["%s — %s: %s" % (
            ("%.1fh" % c["hours"]) if c["hours"] is not None else c["state"],
            c["label"], c["why"]) for c in clocks],
    }

# ───────────────────── build: render bundle + the TypeScript view layer ─────────────────────
#
# THE PYTHON/TYPESCRIPT BOUNDARY (GSL-92). Everything above this line is the DATA layer: it reads
# the three tiers, folds them, grades them, and computes every number. Everything the owner LOOKS at
# is rendered by tools/lab/ui/ (Preact, server-rendered once per pass by esbuild). They meet at
# exactly one artifact — docs/lab/render_bundle.json — and nowhere else.
#
# Why the HTML left Python. It used to be here, and it drifted from itself within one phase: the
# staleness banner re-graded when the page was opened, while the SENTENCE beneath it stayed frozen at
# build time, so a page could show a red DEAD banner over "Live -- the laboratory is writing itself
# right now" (REVIEW-gsl81 M1). That is what two renderers of one truth produce, every time, and the
# fix is not "be careful" -- it is to have one renderer.
#
# What did NOT move: the morning digest. It is markdown for a phone at 07:00, not a screen, and it
# must keep building when node does not exist at all. Below.

UI_DIR = os.path.join(TOOLS, "ui")

# Paired markers the view layer emits into every page (tools/lab/ui/src/page.tsx: DEGRADE_ANCHOR).
# Python fills the gap between them when it could not run the renderer, and the next successful
# render writes the empty pair back -- so the banner appears and disappears exactly when it is true.
UI_DEGRADE_START = "<!--UI-DEGRADE-START-->"
UI_DEGRADE_END   = "<!--UI-DEGRADE-END-->"

# The closed vocabulary render.sh may answer with. Keep in sync with the header of that script.
UI_REASONS = {
    "no-node":      "node is not installed, so the HTML could not be rebuilt",
    "no-deps":      "the view layer is not bootstrapped (run: cd tools/lab/ui && npm install)",
    "build-failed": "the renderer failed to build",
    "bad-bundle":   "the data layer produced a bundle the renderer could not read",
    "no-renderer":  "tools/lab/ui/render.sh is missing",
}


def prev_ui_last_success():
    """When did the view layer last build successfully? Read it back out of the status.json we are
    about to overwrite.

    Without this the degrade banner can only say "may be stale" -- true, but useless. With it the
    banner says stale SINCE WHEN, and the owner can tell at a glance whether he is looking at last
    night's dashboard or at one from a week ago. It has to be carried forward like this precisely
    because the last successful build is the one fact a FAILED build cannot know about itself."""
    try:
        with open(os.path.join(LAB, "status.json"), encoding="utf-8") as f:
            return (json.load(f).get("ui") or {}).get("last_success_at")
    except Exception:
        return None


# The Library's sources (PRD R5.2, screen 7: a cross-index of handoffs / dev_history / reviews /
# reports / research / RCA, with links).
#
# ORDER MATTERS: a file is claimed by the FIRST section whose glob matches it. `rca` therefore comes
# before `reports` -- an incident post-mortem is an incident first and a report second, and the same
# artifact listed twice in a cross-index makes a reader ask which of the two entries is the real one.
#
# THERE IS NO docs/rca/ IN THIS REPO. Declaring an empty RCA section for it would have been the easy
# lie, and a bad one: "no RCAs" reads as "nothing ever broke". The post-mortems DO exist -- they live
# under docs/reports/ and they are named for what they are -- so the section finds them by that name,
# and the page prints the glob it used. An empty section that names where it looked has proven
# something. An empty section that names nothing has merely failed to look, and looks identical.
LIBRARY_SECTIONS = (
    # key           label              dir                 glob             recursive
    ("handoffs",    "Handoffs",        "docs/handoff",     "*.md",          False),
    ("dev_history", "Dev history",     "docs/dev_history", "GSL-*.md",      False),
    ("reviews",     "Reviews",         "docs/reviews",     "REVIEW-*.md",   False),
    ("rca",         "Incidents / RCA", "docs/reports",     "**/*incident*", True),
    ("reports",     "Reports",         "docs/reports",     "*/index.html",  False),
    ("research",    "Research",        "docs/research",    "*/*.md",        False),
    ("digests",     "Morning digests", "docs/lab/digest",  "*-morning.md",  False),
    ("prd",         "PRD",             "docs/prd",         "*.md",          False),
)


def doc_title(path):
    """The artifact's own first heading. Markdown answers with `# `, HTML with <title> or <h1>. A row
    indexed with a blank title is a link the owner has to OPEN to find out whether he wanted it -- and
    a cross-index whose rows must each be opened is not an index."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            head = f.read(8192)
    except OSError:
        return ""
    # GSL-131: the title is returned WHOLE. It used to end in [:110], which cut 11 of 12 cross-index
    # headings mid-word with no marker — and because the cut happened here, in the data, the tail was
    # absent from render_bundle.json and from the page, unreachable by selection or search. A heading
    # broken on a half-word reads as complete and can reverse its own meaning. The view wraps the tail
    # (td{overflow-wrap:anywhere}); the data no longer hides it.
    if path.endswith((".html", ".htm")):
        m = (re.search(r"<title[^>]*>(.*?)</title>", head, re.S | re.I)
             or re.search(r"<h1[^>]*>(.*?)</h1>", head, re.S | re.I))
        if not m:
            return ""
        # GSL-148: decode entities AFTER stripping tags. A <title> arrives entity-encoded (&amp;),
        # and the view layer escapes on render; without a decode here the bundle carries "&amp;",
        # the page prints the five characters, and a search for "&" cannot match the row. Decoding
        # after the tag strip keeps a literal "&lt;b&gt;" in a title as text instead of a tag.
        return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip())
    for line in head.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def library_index():
    """The Library screen's data (PRD R5.2, screen 7). The raw event log is exhaust -- it is pruned at
    30 days. THIS is the memory that survives retention, so it is computed from the filesystem itself
    and never from anyone's recollection of what was written."""
    site = os.path.join(LAB, "site")
    claimed = set()
    sections, total = [], 0

    for key, label, subdir, pattern, recursive in LIBRARY_SECTIONS:
        root = os.path.join(REPO, subdir)
        items = []
        for p in sorted(glob.glob(os.path.join(root, pattern), recursive=recursive), reverse=True):
            # A glob may land on a DIRECTORY (docs/reports/<slug>-incident-<date>/), and a directory
            # is not a link. The artifact is the index.html inside it; if there is none, there is
            # nothing here to point at, and we point at nothing rather than at a folder.
            if os.path.isdir(p):
                p = os.path.join(p, "index.html")
                if not os.path.isfile(p):
                    continue
            real = os.path.realpath(p)
            if real in claimed:
                continue
            claimed.add(real)
            items.append({
                # Relative to site/, so ONE href works from file:// AND from the GitHub blob view.
                "href": os.path.relpath(p, site),
                "name": os.path.basename(p),
                "title": doc_title(p),
            })
            # GSL-127: NO cap. The list used to stop at 40, which made `count` below read 40 for the
            # dev_history (93) and handoff (46) shelves — the cutoff limit dressed as a file count —
            # AND silently dropped 59 files from a cross-index whose whole purpose is that every
            # artifact the night wrote is reachable from here. count == len(items) == what was found.
        total += len(items)
        sections.append({
            "key": key,
            "label": label,
            # The glob, verbatim, on the page. This is the difference between "there are no incidents"
            # and "I looked for incidents HERE and found none" -- and the owner can run it himself.
            "source": os.path.join(subdir, pattern),
            "dir_exists": os.path.isdir(root),
            "items": items,
            "count": len(items),
        })

    return {"sections": sections, "total": total}


# ═══════════════ the laboratory's own rot (GSL-99, PRD R5.3) ═══════════════
#
# The tasty-lunch risk turned on the laboratory itself. A hub that is hand-kept and half-rotten is
# WORSE than no hub at all: it still looks authoritative, and it lies with a timestamp on it. Phase 4
# closed that for the DATA (a page whose chronicler died must look dead). This closes it for the
# DOCUMENTATION — the dashboard now reports its own rot, and names it.
#
# ONE RULE ABOVE ALL THREE METERS: A METER WITH NO SOURCE IS `unknown`, NEVER GREEN. Green is a claim
# and a claim needs evidence; ignorance is not evidence, and it must never render like proof.
#
#   freshness    — TWO ages, never one. `grade` judges the DATA at the instant of the build; the
#                  reader's clock has moved since. `now − generated_at` must be ADDED before the
#                  verdict means anything, so the page prints both and re-grades on open (client.ts).
#   dev_history  — which of an epic's tasks carry a history file, BY NAME. Read off the git INDEX
#                  (`git ls-files` — what `git show :<path>` resolves), NEVER off the working tree:
#                  an uncommitted dev_history file does not exist for whoever arrives after the next
#                  compaction, and that reader is the only one this meter serves. Fact, not intent.
#   handoff age  — the last handoff against the last CYCLE BOUNDARY. A fleet that ran three cycles
#                  and wrote no handoff is debt accruing in silence; the meter's job is to end the
#                  silence.

DEV_HISTORY_GLOB = "docs/dev_history/GSL-*.md"
HANDOFF_GLOB     = "docs/handoff/*.md"
HANDOFF_ALARM_CYCLES = int(os.environ.get("GOSLEEP_HANDOFF_ALARM_CYCLES", 3))

# The live state file sits in docs/handoff/ and is NOT a handoff. It is rewritten continuously by
# whoever is orchestrating, so counting it would make this meter read FRESH exactly when the fleet has
# stopped writing handoffs — fresh in the reassuring direction, the only direction that matters.
#
# The `handoff.written` hook has precisely that blind spot: it fires on every write to this file, so
# the event stream cannot be the source here. The COMMITTED file is, timestamped by the commit that
# added it — which is also the only version a reader who arrives tomorrow will ever see.
NOT_A_HANDOFF = ("ORCHESTRATION-STATE.md",)

# What ends a cycle. `task.completed` would be the obvious source and it is the WRONG one: it is
# emitted by the task system, which a worker can simply not use — and in this repo's own log it stops
# firing hours before the last worker finished. `pane.ended` is the closing signal that survived, and
# it is the same one the Fleet screen already keys a worker's end-of-life on.
CYCLE_BOUNDARY_TYPE = "pane.ended"

# ...but it fires per PANE, and a cycle holds up to THREE of them (manifest §5.slots — the Fleet screen
# prints that cap on its own KPI row). Two panes of one cycle closing nine seconds apart are not two
# cycles, and those nine seconds are a window no handoff can physically land in, so each extra pane
# manufactured a GUARANTEED unit of debt: a routine three-worker cycle invented two undocumented
# cycles, which is exactly the alarm threshold. The meter was counting panes and calling them cycles.
#
# There is no cycle id to key on — a `pane.ended` carries `reason` and `raw`, nothing else — so a run
# of closes with no gap longer than this window is treated as ONE cycle's teardown, dated by the LAST
# pane to close, because that is the instant the cycle actually ended.
#
# THE ERROR DIRECTION IS NAMED, NOT HIDDEN. Two cycles that genuinely ran closer together than this
# window are counted as one, which UNDER-states the debt — the reassuring direction, the only one that
# matters. So the meter prints both numbers on the page: the raw pane count AND the debounced cycle
# count, with the window beside them, and a reader who distrusts the collapse can do his own division.
CYCLE_DEBOUNCE_S = int(os.environ.get("GOSLEEP_CYCLE_DEBOUNCE_S", 600))


def git_index_files(pathspec):
    """The files the INDEX carries — what a fresh clone gets. `None` means git could not be read at
    all, which is `unknown`; an empty list means git answered and there are none, which is a FACT."""
    rc, out, err = run(["git", "ls-files", "--", pathspec])
    if rc != 0:
        degrade("self_health", "git ls-files %s: %s" % (pathspec, err or "rc=%d" % rc))
        return None
    return [l.strip() for l in out.splitlines() if l.strip()]


def git_untracked_files(pathspec):
    """Written into the working tree and never committed. To this meter these files DO NOT EXIST —
    they are listed only so the owner can see the difference between "not written" and "written,
    and lost to the next clone"."""
    rc, out, _ = run(["git", "ls-files", "--others", "--exclude-standard", "--", pathspec])
    if rc != 0:
        return []
    return [l.strip() for l in out.splitlines() if l.strip()]


def dev_history_coverage(epics):
    """Which of each epic's tasks have a committed dev_history file — and which do not, BY NAME.

    A percentage is not the deliverable here. "84% covered" tells the owner nothing he can act on;
    "GSL-93 has no history" tells him exactly what to write tonight. So the missing keys travel by
    name, per epic, and the totals are a footnote to them rather than the other way round.

    An epic whose task list is not knowable from git topology (squashed, fast-forwarded) reports
    `unknown`, NOT 100%. Zero-of-zero is the easiest green on this page to earn dishonestly."""
    searched = ("`git ls-files -- %s` — the git INDEX, which is what `git show :<path>` resolves and "
                "what a fresh clone gets. The working tree is deliberately NOT consulted." % DEV_HISTORY_GLOB)
    files = git_index_files(DEV_HISTORY_GLOB)
    if files is None:
        return {"state": "unknown", "searched": searched, "epics": [],
                "why": "git could not be read in this checkout, so coverage is unknown — not zero, "
                       "and certainly not green",
                "tasks": 0, "covered": 0, "missing": 0, "uncommitted": []}

    by_key = {}
    for p in files:
        m = KEY_RE.match(os.path.basename(p))
        if m:
            by_key.setdefault(m.group(1), []).append(os.path.basename(p))

    rows, n_tasks, n_covered, n_missing = [], 0, 0, 0
    for e in epics:
        # `merged-unwitnessed` / `no-trunk`: the topology cannot say which tasks this epic carried, so
        # neither can this meter. It says so, in the epic's own words.
        if e["membership"] not in ("merge-commit", "branch"):
            rows.append({"key": e["key"], "state": "unknown", "why": e["membership_why"],
                         "tasks": [], "covered": [], "missing": [], "task_count": 0})
            continue
        tasks = list(e.get("tasks") or [])
        covered = [t for t in tasks if t in by_key]
        missing = [t for t in tasks if t not in by_key]
        n_tasks += len(tasks); n_covered += len(covered); n_missing += len(missing)
        rows.append({
            "key": e["key"],
            # An epic whose range carries no task commits has nothing to cover. That is not `ok` —
            # `ok` is a statement about documentation that exists, and here none was ever owed.
            "state": ("empty" if not tasks else ("gaps" if missing else "ok")),
            "why": ("this epic's range carries no task commits, so there is nothing to document"
                    if not tasks else ""),
            "tasks": tasks, "covered": covered, "missing": missing, "task_count": len(tasks),
        })

    measured = [r for r in rows if r["state"] in ("ok", "gaps")]
    return {
        # `unknown` when not one epic could be measured: an empty coverage table is ignorance, and
        # ignorance must not inherit the colour of a clean bill of health.
        "state": ("unknown" if not measured else ("gaps" if n_missing else "ok")),
        "why": ("" if measured else
                "no epic in this checkout has a task list git can read, so there is nothing to "
                "measure coverage against"),
        "searched": searched,
        "epics": rows,
        "tasks": n_tasks, "covered": n_covered, "missing": n_missing,
        # Present in the working tree, absent from the index. They do not count, and the page says
        # why: the reader this history is written FOR arrives after a compaction, with a clone.
        "uncommitted": [os.path.basename(p) for p in git_untracked_files(DEV_HISTORY_GLOB)],
    }


def handoff_add_times():
    """Each committed handoff, timestamped by the commit that ADDED it. One git call, not one per file.

    The file's mtime would have been easier and it is worthless: a checkout rewrites it, so on a fresh
    clone every handoff is seconds old. The commit that added it is the instant the handoff became
    real for anybody but its author."""
    rc, out, _ = run(["git", "log", "--diff-filter=A", "--format=%x01%cI", "--name-only",
                      "--", "docs/handoff"])
    if rc != 0:
        return None
    added, ts = {}, None
    for line in out.splitlines():
        if line.startswith("\x01"):
            ts = iso_utc(line[1:].strip())
        elif line.strip() and ts:
            added.setdefault(line.strip(), ts)   # git walks newest-first: the newest addition wins
    return added


def handoff_debt(events):
    """The last handoff against the last cycle boundary — and how many cycles closed after it.

    The debt is a RUN, not a ratio: what matters at 03:00 is how many cycles in a row have now ended
    with nothing written down. So the boundaries are walked backwards from the newest, and each is
    asked whether a handoff landed inside its cycle (between the previous boundary and itself). The
    walk stops at the first cycle that was documented — everything before that is already paid for."""
    searched = ("committed `%s` (excluding %s), dated by the commit that ADDED each file; cycle "
                "boundaries are `%s` events in docs/lab/events/*.jsonl"
                % (HANDOFF_GLOB, ", ".join(NOT_A_HANDOFF), CYCLE_BOUNDARY_TYPE))
    base = {"state": "unknown", "searched": searched, "last": None, "boundary": None,
            "undocumented_cycles": None, "alarm_at": HANDOFF_ALARM_CYCLES, "alarm": False,
            "boundaries": 0, "committed": 0, "uncommitted": [], "undated": [], "why": ""}

    tracked = git_index_files(HANDOFF_GLOB)
    added = handoff_add_times()
    if tracked is None or added is None:
        base["why"] = "git could not be read in this checkout, so the last handoff is unknown"
        return base

    docs, undated = [], []
    for p in tracked:
        name = os.path.basename(p)
        if name in NOT_A_HANDOFF:
            continue
        ts = added.get(p)
        if ts:
            docs.append({"name": name, "ts": ts})
        else:
            # In the index, in no commit: staged and never committed. It cannot date a cycle.
            undated.append(name)
    docs.sort(key=lambda d: d["ts"])

    # Normalised at the door. These strings are about to be compared with `<` against commit dates
    # that came through `iso_utc` already, and `2026-07-12T23:26:24+0200` sorts ABOVE
    # `2026-07-12T21:33:25Z` while being the EARLIER instant — the exact trap iso_utc's own docstring
    # names. Every event in this log carries `Z` today; that is a fact about today, not a guarantee.
    panes = sorted(t for t in (iso_utc(e.get("ts")) for e in events
                               if e.get("type") == CYCLE_BOUNDARY_TYPE) if t)

    # Panes -> cycles (see CYCLE_DEBOUNCE_S). A cluster collapses onto its LAST close, which is when
    # the cycle it belongs to actually ended.
    bounds = []
    for t in panes:
        prev, cur = (parse_ts(bounds[-1]) if bounds else None), parse_ts(t)
        if prev is not None and cur is not None and cur - prev <= CYCLE_DEBOUNCE_S:
            bounds[-1] = t
        else:
            bounds.append(t)

    if len(panes) != len(bounds):
        searched += ("; %d pane close(s) debounced into %d cycle boundary(ies) at %ds — a cycle holds "
                     "up to 3 panes and they close together, so counting panes would count one cycle "
                     "several times (two cycles closer together than %ds would be counted as one, "
                     "which UNDER-states this debt)"
                     % (len(panes), len(bounds), CYCLE_DEBOUNCE_S, CYCLE_DEBOUNCE_S))
        base["searched"] = searched

    base.update({
        "committed": len(docs), "undated": undated, "boundaries": len(bounds),
        "uncommitted": [os.path.basename(p) for p in git_untracked_files(HANDOFF_GLOB)],
    })

    if docs:
        d = docs[-1]
        age = NOW - parse_ts(d["ts"]) if parse_ts(d["ts"]) else None
        base["last"] = {"name": d["name"], "ts": d["ts"],
                        "age_s": int(age) if age is not None else None,
                        "age_human": human_age(age)}

    if not bounds:
        # No boundary source, so "no cycle has gone undocumented" is a sentence this build has not
        # earned. It stays `unknown` even when handoffs exist — a handoff proves a cycle was written
        # up, never that no OTHER cycle closed unwritten.
        base["why"] = ("the event log carries no `%s`, so this build cannot see where one cycle ends "
                       "and the next begins" % CYCLE_BOUNDARY_TYPE)
        return base

    b_ts = bounds[-1]
    b_age = NOW - parse_ts(b_ts) if parse_ts(b_ts) else None
    base["boundary"] = {"ts": b_ts, "age_s": int(b_age) if b_age is not None else None,
                        "age_human": human_age(b_age), "source": CYCLE_BOUNDARY_TYPE,
                        "total": len(bounds)}

    # Walk back from the newest boundary. A cycle is DOCUMENTED when a handoff was committed inside
    # it: after the previous boundary, and no later than this one.
    #
    # THE NEWEST INTERVAL IS OPEN AT THE TOP, and that is the whole correction. The cycle that began
    # at the last boundary has not ended yet — nothing has closed it — so it runs to NOW, and a
    # handoff committed inside it documents it.
    #
    # The rule this replaces closed every interval at its boundary, reasoning that "a handoff is
    # written before its own pane closes". That is true of the WRITE and false of the COMMIT — and the
    # commit is what dates a handoff here (`handoff_add_times` reads `git log --diff-filter=A`). A
    # commit happens after the pane has closed, by definition; on this branch handoffs 28/29/35 were
    # carried in by ledger commits hours later still. So every handoff newer than the last boundary
    # fell into NO interval and documented NOTHING: with 36 handoffs committed on this branch, one
    # committed right now left all 22 boundaries counted as undocumented debt. The alarm fired
    # loudest on a night that had been written up in full.
    undoc = 0
    for i in range(len(bounds) - 1, -1, -1):
        lo = bounds[i - 1] if i > 0 else ""
        hi = bounds[i] if i < len(bounds) - 1 else max(bounds[i], now_iso())
        if any(lo < d["ts"] <= hi for d in docs):
            break
        undoc += 1

    base["undocumented_cycles"] = undoc
    base["state"] = "ok" if undoc == 0 else "debt"
    base["alarm"] = undoc >= HANDOFF_ALARM_CYCLES
    if undoc:
        base["why"] = ("%d cycle(s) have closed since the last handoff was committed — that is debt, "
                       "and it is accruing" % undoc)
    return base


def build_self_health(ctx, status):
    """The three meters, as ONE block, computed once. R5.3's anti-rot alarm."""
    st = status["staleness"]
    return {
        # TWO AGES, and the page must print both. `grade` is a verdict on the DATA, delivered at the
        # instant of the build; a reader opening this page five hours later holds a verdict five hours
        # out of date, and the arithmetic he owes is: data_age + (now − generated_at). The client
        # script does exactly that on open (client.ts: regradeStaleness) — this block is what a reader
        # with JS off, or a machine reading the bundle, needs in order to do it himself.
        "generated_at": status["generated_at"],
        "data_age_s": st["max_event_age_s"],
        "data_age_human": st["max_event_age_human"],
        "latest_event_ts": st["latest_event_ts"],
        "grade": st["grade"],
        "grade_is_about": ("the DATA, at build time. Add (now − generated_at) to `data_age_s` before "
                           "trusting it: there are two ages here, not one"),
        "dev_history": dev_history_coverage(ctx["tasks"]["epics"]),
        "handoffs": handoff_debt(ctx["events"]),
    }


# Every question the queue holds, not just the open ones. The Questions screen (PRD R5.2, screen 4)
# has to show what the night DECIDED as well as what it is still waiting on -- "answered-by-default,
# and here is the default it took" is the record that makes an autonomous night auditable in the
# morning. status.json keeps only the open ones; that is a summary, and this is the ledger.
QUESTION_KEYS = ("id", "ts", "type", "from", "task", "question", "options", "default",
                 "default_rationale", "reversibility", "impact_if_wrong", "auto_apply_at",
                 "status", "seen_by", "high_impact", "answered_by", "answer", "links")


def build_queue(questions):
    items = [{k: q.get(k) for k in QUESTION_KEYS if k in q} for q in questions]
    open_items = [q for q in items if q.get("status") == "open"]
    return {
        "open": len(open_items),
        "total": len(items),
        "by_type": tally(open_items, "type"),
        "open_items": open_items,
        # Recently closed, newest first. The morning wants to audit last night's defaults.
        "closed_items": sorted([q for q in items if q.get("status") != "open"],
                               key=lambda q: q.get("ts") or "", reverse=True)[:20],
        # BLOCKERs take no default, ever (manifest §3) -- so they have no auto_apply_at and no timer.
        # They are the only question type that STOPS the night, which is why GSL-94's runway keys on
        # them and not on the DECISIONs, which resolve themselves.
        "open_blockers": [q for q in open_items if q.get("type") == "BLOCKER"],
    }


# How many events travel to the view layer. Bounded on purpose: render_bundle.json is COMMITTED, so
# an unbounded list is a file that grows forever and a git diff nobody can read. The screens show a
# recent feed and aggregate counts, never the full history -- the full history is the jsonl itself.
RECENT_CAP = int(os.environ.get("GOSLEEP_RECENT_CAP", 200))

# The envelope carries plenty the screens never show: session_id, cwd, agent_id, and a `raw` copy of
# whatever the hook was handed. Committing all of it, on every pass, would make the bundle several
# times its useful size and its diff unreadable -- for fields no page prints. So the feed is
# PROJECTED down to what a row actually renders. The full envelope is never lost: it is in
# docs/lab/events/*.jsonl, which is the source of truth this file is derived FROM.
#
# `data` is narrowed to the keys the detail column reads (tools/lab/ui/src/components.tsx:
# eventDetail). Add a key here the day a screen needs it -- not before.
EVENT_VIEW_KEYS = ("ts", "seq", "actor", "type", "src")
EVENT_DATA_KEYS = ("sha", "path", "key", "question", "error_type", "decision", "cmd")


def project_event(e):
    d = e.get("data") or {}
    return dict(
        {k: e[k] for k in EVENT_VIEW_KEYS if k in e},
        data={k: d[k] for k in EVENT_DATA_KEYS if k in d},
    )


def build_render_bundle(ctx, status):
    """The ONE contract with the view layer (tools/lab/ui/src/types.ts mirrors this shape).

    The events travel as ONE recent, cross-day, already-folded list. Not as "the target day": a
    timeline keyed on today is empty at 00:05 and empty all morning after a quiet night, and an
    empty feed is indistinguishable from a dead hook layer -- the exact confusion this whole tier
    exists to prevent. Screens slice it by date when they want a day; every COUNT they print comes
    from `events` below, computed once, here. A number the renderer works out for itself is a second
    opinion waiting to disagree with status.json."""
    return {
        # /7 (GSL-99): `self_health` — the laboratory's three meters about ITSELF: two ages (not one),
        # dev_history coverage by NAME off the git index, and the handoff debt measured in cycles. It
        # is mandatory in the bundle on purpose: a self-health block a producer can silently stop
        # emitting is an anti-rot alarm that rots.
        #
        # /6 (GSL-98): `fleet.workers` (a card per worker, keyed on the session a task.completed named,
        # with the model read from that session's TRANSCRIPT rather than from the worker's word for it)
        # and `cost.by_model` + `cost.quota`. /5's fleet could name actors but could not attribute an
        # event to one, so it could not answer the only question the screen exists for: how long has
        # this worker been silent.
        #
        # /5 (GSL-97): `library` stopped being five fixed lists and became declared SECTIONS, each
        # carrying the glob it was built from -- reviews, research and the incident post-mortems were
        # simply not indexed before, and a section that cannot say where it looked cannot be trusted
        # when it comes back empty.
        "schema": "gosleep.lab.render/7",
        "generated_at": status["generated_at"],
        "generated_by": "tools/lab/chronicler.sh -> tools/lab/ui (GSL-94)",
        "date": ctx["date"],
        "staleness": status["staleness"],
        "self_health": ctx["self_health"],
        "events": status["events"],
        "recent_events": [project_event(e) for e in ctx["events"][-RECENT_CAP:]],
        "recent_cap": RECENT_CAP,
        "questions": status["questions"],
        "runway": ctx["runway"],
        "queue": ctx["queue"],
        "tasks": ctx["tasks"],
        "fleet": ctx["fleet"],
        "cost": ctx["cost"],
        "decisions": {"total": len(ctx["decisions"]), "recent": ctx["decisions"][-30:]},
        "delivery": status["delivery"],
        "orchestrator": status["orchestrator"],
        "library": library_index(),
        "degraded": DEGRADED,
        "narrative": ctx.get("narrative"),
    }


def render_site(bundle):
    """Hand the bundle to the view layer; get {filename: html} back. Never raises.

    node is given no filesystem access at all: it reads stdin, it writes stdout, and Python writes
    every byte that lands in the repo through lab-write.sh (temp + rename). A renderer killed halfway
    through page five therefore cannot leave a torn dashboard -- it can only fail, and a failure here
    is DATA, not an outage."""
    script = os.path.join(UI_DIR, "render.sh")
    if not os.path.exists(script):
        return {"ok": False, "reason": "no-renderer", "hint": script}
    try:
        p = subprocess.run(["bash", script],
                           input=json.dumps(bundle, ensure_ascii=False),
                           capture_output=True, text=True, timeout=120,
                           cwd=REPO, env=CHILD_ENV)
        out = (p.stdout or "").strip()
        if not out:
            return {"ok": False, "reason": "build-failed",
                    "hint": (p.stderr or "render.sh printed nothing").strip()[:400]}
        return json.loads(out)
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "build-failed", "hint": "render.sh timed out after 120s"}
    except Exception as exc:
        return {"ok": False, "reason": "build-failed", "hint": str(exc)[:400]}


def degrade_banner_html(reason, hint, last_success):
    """The one piece of markup Python still renders -- and the ONLY one it may.

    This is not a second renderer sneaking back in: it displays no laboratory data, so it has nothing
    to drift about. It says exactly one thing -- "the thing that draws these pages could not run" --
    and it exists precisely for the case where the thing that draws these pages cannot run."""
    when = ("last successful build: %s" % last_success) if last_success else \
           "these pages have never been built successfully"
    return ("%s<div class=\"ui-degraded\">&#9888;&#65039; UI build unavailable "
            "&mdash; this page may be stale<small><b>%s</b> &mdash; %s.<br>"
            "The DATA is not affected: <code>docs/lab/status.json</code>, the event log and the "
            "morning digest were all regenerated by this same pass. Only the HTML you are reading "
            "could not be. Everything below is whatever the last successful build left here "
            "(%s).<br>%s</small></div>%s") % (
        UI_DEGRADE_START, esc_min(reason), esc_min(UI_REASONS.get(reason, "unknown reason")),
        esc_min(when), esc_min(str(hint or "")[:300]), UI_DEGRADE_END)


def esc_min(x):
    """Minimal escaping for the banner. The view layer escapes everything it renders; this is the one
    string Python still puts on a page, and a `reason` code with a `<` in it is not a licence to
    inject markup into a file the owner opens."""
    return (str("" if x is None else x)
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def apply_degrade_banner(reason, hint, last_success):
    """Stamp the banner across every page already on disk, and leave a page behind if there are none.

    A page that cannot be rebuilt must NEVER look fresh. It may look stale -- that is honest, and it
    is the entire premise of F4-S3 -- but the owner has to be told, on the page itself, at the top,
    before he reads a single number that might be from yesterday."""
    site = os.path.join(LAB, "site")
    banner = degrade_banner_html(reason, hint, last_success)
    stamped = []
    pages = sorted(glob.glob(os.path.join(site, "*.html")))

    for path in pages:
        try:
            with open(path, encoding="utf-8") as f:
                doc = f.read()
        except OSError as exc:
            degrade("ui:banner", exc)
            continue
        i, j = doc.find(UI_DEGRADE_START), doc.find(UI_DEGRADE_END)
        if i >= 0 and j > i:
            # Idempotent: replace whatever sits between the markers (an older banner, or nothing).
            doc = doc[:i] + banner + doc[j + len(UI_DEGRADE_END):]
        else:
            # A page built before the markers existed. Put the banner where a body starts, and if we
            # cannot even find that, at the very top -- a banner in an odd place beats no banner.
            k = doc.find("</style>")
            at = (k + len("</style>")) if k >= 0 else 0
            doc = doc[:at] + "\n" + banner + doc[at:]
        lab_write(os.path.relpath(path, REPO), doc)
        stamped.append(os.path.basename(path))

    if not pages:
        # Nothing to stamp: a fresh clone that has never had node. An owner who opens index.html and
        # gets "file not found" learns nothing; one who gets this learns exactly what to run.
        lab_write("docs/lab/site/index.html", (
            "<!doctype html>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
            "<title>gosleep lab &mdash; UI not built</title>\n"
            "<style>body{font:16px/1.6 -apple-system,system-ui,sans-serif;max-width:44rem;"
            "margin:3rem auto;padding:0 1rem}"
            ".ui-degraded{background:#fdeaea;border:2px solid #a51d24;color:#a51d24;border-radius:.5rem;"
            "padding:.9rem 1rem;font-weight:700}"
            ".ui-degraded small{display:block;font-weight:400;color:#1a1a19;margin-top:.35rem;"
            "font-size:.85rem}"
            "code{background:#f1f1ef;border-radius:.25rem;padding:.05rem .3rem;"
            "font-family:ui-monospace,Menlo,monospace}</style>\n"
            + banner +
            "\n<p>The laboratory's <b>data</b> is fine &mdash; only its <b>view layer</b> has never "
            "been built on this machine. Read <code>docs/lab/status.json</code> or the morning "
            "digest in <code>docs/lab/digest/</code> in the meantime.</p>\n"))
        stamped.append("index.html (placeholder)")

    return stamped


SITE_README = """# `docs/lab/site/` — DERIVED. Do not hand-edit.

Every file here is overwritten by `tools/lab/chronicler.sh` on its next pass. An edit you make by hand
survives exactly until then, and in the meantime it is a lie with a `generated_at` stamp on it.

This is the tasty-lunch-wiki rule (blueprint 05 §1.4-1), and it is the only reason a regenerated hub
does not rot: **nobody edits it, so nobody has to maintain it.** To change what the page says, change
what the chronicler *reads* — or change the renderer in `tools/lab/ui/`.

## How a page is built

```
docs/lab/{events,decisions,questions}/*  ->  tools/lab/chronicler.py   (Python: reads the world)
                                         ->  docs/lab/render_bundle.json   (schema gosleep.lab.render/7)
                                         ->  tools/lab/ui/  (TypeScript + Preact, server-rendered)
                                         ->  7 self-contained .html files here
```

The bundle is the only thing crossing the Python/TypeScript border. Bumping its schema means editing
four files in one commit — `chronicler.py`, `types.ts`, `render.tsx`, `smoke.sh` — never fewer.

If node is unavailable the pages are **NOT** regenerated: they stay exactly as they were, under a red
banner that says so. A stale page that admits it is stale is the product; a fresh-looking page full
of yesterday is the failure.

## The contract: self-contained, but not JavaScript-free

Open `index.html` from `file://`. Every page is self-contained — **no CDN, no web fonts, no external
stylesheet, no external script**. Measured 2026-07-20 with DevTools at `file://`: exactly **one**
network request per page (the HTML file itself) and **zero** console errors.

There IS JavaScript, and there is more of it than "a little". It is inlined in the page, and the rule
governing it is one sentence:

> **The client may only ever compute over data already inlined at build time. It must never make a
> network request of any kind.**

That is not a stylistic preference. `file://` cannot `fetch()` a sibling JSON file — CORS forbids it
— so a page that needed the network would simply be blank for the one reader it is written for.

Four things run when you open a page. Each exists because a *static* number would have been false in
the reassuring direction — the only direction that matters:

| What | Why it cannot be baked at build time |
|---|---|
| `regradeStaleness()` | A chronicler that died in the night would leave a page confidently reading "Live" forever. The banner re-grades fresh/stale/dead against **the reader's** clock, and never *softens* a verdict. |
| `tickCountdowns()` | "auto-applies in 2h" baked at 23:00 and read at 04:00 offers the owner two hours that were spent five hours ago. Deadlines are recomputed from the absolute instant in `data-auto-apply-at`. A countdown may never read a clock earlier than the build's. |
| `tickAges()` | The "last heard from" ages on Tasks/Fleet keep aging while the page is open, from `data-age-ts`. |
| `initFilters()` | Timeline and Library filter over a JSON index inlined beside the rows. The filter never hides silently: the page writes "36 of 107 shown — 71 hidden by the filter" in words, and reddens when it is hiding everything. Nothing is persisted — no `localStorage`, no hash — so every open starts from the full list. |

**With JS off, the build-time verdicts stand**, and they are honest for `generated_at`. Two details
of that degradation are deliberate:

- The filter bar ships with the `hidden` attribute and is revealed only *after* the island, the table
  and the count element have all been found. A `<select>` the reader can move that changes nothing is
  worse than no `<select>` at all — so with JS off there is no filter control on the page, and the
  full list stands.
- Severity is marked up **in the HTML**, not painted by script, because the incident row must be red
  in exactly the case where our JS did not run.

## How it is actually read on a phone (measured, not assumed)

The PRD said the owner would read these pages "from a phone, through the private GitHub repo".
Measured on 2026-07-20 against `ainstance-labs/gosleep` — that is **not** what GitHub does:

| Path | What GitHub actually returns |
|---|---|
| Contents API (`Accept: raw`) | `Content-Type: application/vnd.github.raw` + `X-Content-Type-Options: nosniff` + CSP `default-src 'none'` |
| `raw.githubusercontent.com` | `Content-Type: text/plain` + `nosniff` + CSP `sandbox` (a `.md` gets the same — raw serves everything as text) |
| GitHub Pages | Not enabled (404); org plan is `free`, and Pages for a **private** repo needs Enterprise Cloud |

`nosniff` is the decisive one **for these pages**: the file *is* HTML, and the browser is explicitly
**forbidden** to treat it as such. There is no URL on github.com that renders `.html` from this repo.

### The correction (GSL-108, 2026-07-20)

The sentence that used to close this section — *"GitHub is a transport for the bytes, not a viewer"* —
was wider than the evidence above, and it cost a phase. The measurements were of `.html` and of `raw`;
the conclusion was about GitHub. Re-measured against the same private repo, authenticated:

| Path | What GitHub actually returns |
|---|---|
| `.md` via Contents API (`Accept: html`) | `<article class="markdown-body">` — **rendered server-side** |
| `.html` via the same API | `<pre class="plain">&lt;!doctype html&gt;` — **escaped**, shown as source |
| a directory's `README.md` | rendered too (`GET /readme/<dir>`) |
| a directory with **no** `README.md` | `404` — the negative control, so the row above is not a default |

GitHub is **both**: a viewer for Markdown, a transport for everything else. `nosniff` never governed
Markdown, because Markdown is never handed to the browser to interpret — GitHub renders it to HTML on
its own servers and ships the result. The private repo was never the obstacle; the file extension was.

So the phone surface is Markdown, and it exists: **`docs/lab/mobile/README.md`**, regenerated from the
same `render_bundle.json` these seven screens render from, at a URL that carries no date and therefore
survives being bookmarked. Open the *directory* on a phone and GitHub renders it.

What remains true — and is the property this contract exists to protect — is that a page here is a
**single file with no dependencies**, so it renders completely once it reaches a phone by any means
that puts a file on it (download and open in Files, a git client, a sync folder). That is the desktop
and offline path. It is no longer the *only* path, and "the transport question is somebody else's
problem" is no longer an acceptable place to stop: it is what left `F5-S4c` open.

## Layout

Pages are a single fluid column with no breakpoints, verified at 390px (`GSL-100`). Two rules there
are load-bearing rather than cosmetic, and both are guarded in `smoke.sh`:

- **`nav` is a wrapping flex container.** The links are rendered adjacent with no whitespace between
  them, and inline boxes with no intervening white space have no soft-wrap opportunity at all — so
  before this rule the last two links sat off-screen, unreachable, on a phone.
- **`.mono` sets `overflow-wrap:anywhere`.** Monospace carries the unbreakable strings (raw JSON
  notes, shas, branch names); without it a card clips its own quote mid-token and the reader loses
  the rest of the sentence with nothing on screen to say so. Wide *tables* are exempt: they scroll
  inside `.wrap`, where the swipe is discoverable.
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

# ───────────────────────────── build: the phone page (GSL-108) ────────────────
#
# WHY THIS SURFACE IS MARKDOWN AND NOT ONE MORE .html — closes F5-S4c, refuted in Phase 5.
#
# Phase 5 measured that a private repo will not serve the dashboard to a phone: raw.githubusercontent
# sends text/plain + nosniff, and Pages on a private repo needs Enterprise Cloud. That measurement is
# correct and it still stands. The CONCLUSION drawn from it — "GitHub is a transport for the bytes,
# not a viewer" — was wider than the evidence, and it is what kept this page from existing.
#
# Re-measured 2026-07-20 against ainstance-labs/gosleep (private, authenticated):
#
#   .md   through the Contents API  ->  <article class="markdown-body">          RENDERED server-side
#   .html through the same API      ->  <pre class="plain">&lt;!doctype html&gt;  ESCAPED, shown as source
#   a directory's README.md         ->  rendered as well (GET /readme/<dir>)
#   a directory with no README.md   ->  404  (the negative control: the 200 above is not a default)
#
# GitHub is BOTH — a viewer for Markdown, a transport for everything else. nosniff never governed
# Markdown, because Markdown is never handed to the browser to interpret: GitHub renders it to HTML
# on its own servers and ships the result. The private repo was never the obstacle. The file
# extension was.
#
# Three properties follow, and each is load-bearing rather than incidental:
#
#   1. It is named README.md, so opening the DIRECTORY renders it. The URL carries no date and never
#      changes. The digest cannot do this job: it is <date>-morning.md, so a bookmark taken today is
#      wrong tomorrow, and a phone at 07:00 is exactly where you cannot go hunting for a filename.
#   2. It is projected from render_bundle.json — the same bundle the seven screens render from — so
#      it cannot drift from them. This is a view of the dashboard, not a second dashboard.
#   3. It is built by Python from a bundle Python already wrote, so it survives the one failure that
#      takes the HTML down (no node — see the degrade contract in docs/lab/site/README.md). When the
#      desktop dashboard is frozen under a red banner, the phone page is still current, and it says
#      which of the two the reader is holding.
#
# It links to .md and to directories ONLY. A link to a .html here would open the escaped source on a
# phone — a dead end dressed as a destination, and the reader would blame their phone.

def _ml(s, n=160):
    """One line, safe inside a Markdown table cell, bounded."""
    t = " ".join(str(s if s is not None else "").split())
    t = t.replace("|", "\\|")
    return (t[: n - 1] + "…") if len(t) > n else t

def _age(sec):
    if sec is None:
        return "?"
    sec = int(sec)
    if sec < 90:
        return "%ds" % sec
    if sec < 5400:
        return "%dm" % (sec // 60)
    if sec < 172800:
        return "%dh" % (sec // 3600)
    return "%dd" % (sec // 86400)

MOBILE_GRADE = {
    "fresh": ("🟢", "FRESH"),
    "stale": ("🟡", "STALE"),
    "dead":  ("🔴", "DEAD"),
}

def _iso(epoch):
    """Epoch → the ISO-8601-Z shape every other timestamp on the page already wears."""
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def mobile_staleness_caveat(st, generated_at):
    """The phone page's freshness verdict, re-expressed in a form that cannot lie as the night wears on.

    The seven screens re-grade themselves when they are opened: `client.ts: regradeStaleness` adds
    `max_event_age_s + (now − generated_at)` and re-tests it against the same two thresholds, never
    softening the result. Markdown runs no JavaScript — GitHub renders this file server-side and the
    phone receives whatever was frozen into it. So the one thing this page must NOT do is print the
    build's grade as a claim about now: a chronicler that died at 16:04 would leave `🟢 FRESH · last
    event 1m ago` standing at 03:00, on the only surface reachable from bed, and the page whose
    author is dead would look the liveliest thing in the repo.

    It cannot do the sum, but it can hand the reader the answer already solved. Each threshold is
    turned into the ABSOLUTE instant at which that same arithmetic tips the grade — and an absolute
    instant is the one currency here that does not decay while the file sits in git. `now > t_stale`
    is a comparison against the clock already in the reader's hand, and a clock only ever moves one
    way: the `never soften a verdict` guard, kept without executing a line of code.
    """
    grade   = st.get("grade") or "dead"
    age_s   = st.get("max_event_age_s")
    thr     = st.get("thresholds_s") or {}
    fresh_s, dead_s = thr.get("fresh"), thr.get("dead")
    gen     = parse_ts(generated_at)

    L = ["> **Frozen at build time — check it against your own clock.** Markdown runs no JavaScript,"
         " so unlike the seven screens this page cannot re-grade itself when you open it: the verdict"
         " above is what was true at `%s`, not a claim about now. There are two ages here, not one."
         % (generated_at or "?")]

    # `dead` is the floor: no worse grade exists to fall to, so there is no expiry moment to print and
    # time can only make the verdict truer. Checked before the arithmetic because a build that found no
    # events at all lands here too, and "already dead" tells the reader more than "cannot compute".
    if grade not in ("fresh", "stale"):
        L.append(">")
        L.append("> This page already graded itself **DEAD** at build time. It cannot degrade further,"
                 " and every minute since has only made that verdict more true.")
        return L

    # Solving the client's sum for each threshold needs all four terms. Missing one, the honest move is
    # to say so: a made-up expiry moment would be exactly the confident-and-wrong signal being fixed.
    if gen is None or age_s is None or fresh_s is None or dead_s is None:
        L.append(">")
        L.append("> This build could not compute when its own verdict expires (no %s), so this page"
                 " cannot tell you how much staler it has grown since — treat the grade as expired"
                 " on sight."
                 % ("build time" if gen is None else
                    "event age" if age_s is None else "thresholds"))
        return L

    # `stale` has already lost `fresh` and can only fall further. Printing a threshold the grade has
    # already crossed would invite the reader to re-earn a verdict backwards, which is the one
    # direction the guard forbids.
    marks = []
    if grade == "fresh":
        marks.append(("🟡", "STALE", gen + fresh_s - age_s))
    marks.append(("🔴", "DEAD", gen + dead_s - age_s))

    L.append(">")
    for dot, word, when in marks:
        L.append("> - %s **%s if you are reading this after `%s`**" % (dot, word, _iso(when)))
    L.append(">")
    L.append("> %s the only thing on this page that cannot go out of date. The grade may only ever get"
             " worse, never better." % ("Those two moments are" if len(marks) == 2
                                        else "That moment is"))
    return L

def build_mobile(bundle, ui=None):
    """The phone projection of the seven screens. Every number is read out of the bundle — nothing is
    recomputed here, because a second implementation of the same number is a second chance to be
    wrong about it."""
    st   = bundle.get("staleness") or {}
    grade = st.get("grade") or "dead"
    dot, word = MOBILE_GRADE.get(grade, ("🔴", "DEAD"))
    q    = bundle.get("questions") or {}
    fl   = bundle.get("fleet") or {}
    dl   = bundle.get("delivery") or {}
    tk   = bundle.get("tasks") or {}
    co   = bundle.get("cost") or {}
    rw   = bundle.get("runway") or {}
    ev   = bundle.get("events") or {}
    dec  = bundle.get("decisions") or {}
    date = bundle.get("date") or "?"

    L = []
    L.append("# gosleep — the phone page")
    L.append("")
    # The grade is stamped `at build` because that is the only thing it can honestly be on a surface
    # that never re-runs. The event age carries its absolute anchor for the same reason: `ago` counts
    # backwards from NOW, and a Markdown file has no way of knowing when now is — so it said `1m ago`
    # at 16:04 and went on saying it at 03:00. A timestamp cannot drift like that.
    if st.get("max_event_age_s") is None:
        L.append("%s **%s at build** · generated `%s` · no event has ever been logged in this checkout"
                 " · day `%s`" % (dot, word, bundle.get("generated_at") or "?", date))
    else:
        L.append("%s **%s at build** · generated `%s` · freshest event **%s** old at that moment (`%s`)"
                 " · day `%s`"
                 % (dot, word, bundle.get("generated_at") or "?",
                    st.get("max_event_age_human") or _age(st.get("max_event_age_s")),
                    st.get("latest_event_ts") or "never", date))
    L.append("")
    L.extend(mobile_staleness_caveat(st, bundle.get("generated_at")))
    L.append("")
    L.append("> Regenerated by `tools/lab/chronicler.sh` from `docs/lab/render_bundle.json` — the same"
             " bundle the seven screens render from. **Never hand-edited:** an edit here survives until"
             " the next pass and is a lie with a timestamp on it.")
    L.append("")

    # 1. The only section that asks anything of the reader. It goes first because at 07:00 the
    #    question "is anything waiting on me?" is the whole reason the page was opened.
    items = [i for i in (q.get("items") or []) if i]
    L.append("## 1. Waiting for you (%d)" % (q.get("open") or 0))
    L.append("")
    if not items:
        L.append("Nothing open. No decision is being held for you.")
    else:
        blockers = [i for i in items if (i.get("type") or "").upper() == "BLOCKER"]
        if blockers:
            L.append("**%d BLOCKER(s) — work is stopped until these are answered.**" % len(blockers))
            L.append("")
        for i in items:
            typ = (i.get("type") or "?").upper()
            # An icon only where there is an alarm to carry: a BLOCKER stops the night, so it earns 🛑.
            # A DECISION or CLARIFY is metadata about the question, not a verdict on it — the word says
            # what it is, and a second glyph beside every one of them is the decorative noise the rest
            # of this redesign is spending itself to remove.
            if typ == "BLOCKER":
                L.append("- 🛑 **%s** `%s` — %s" % (typ, _ml(i.get("id"), 40), _ml(i.get("question"), 300)))
            else:
                L.append("- **%s** `%s` — %s" % (typ, _ml(i.get("id"), 40), _ml(i.get("question"), 300)))
            dflt = i.get("default") or i.get("default_action")
            if dflt:
                L.append("  <br>default if unanswered: %s" % _ml(dflt, 220))
            if i.get("auto_applies_at"):
                L.append("  <br>auto-applies: `%s`" % _ml(i.get("auto_applies_at"), 40))
    L.append("")

    # 2. Fleet + orchestrator: is anything running, and does it have room.
    L.append("## 2. Fleet")
    L.append("")
    if not fl.get("known", True):
        L.append("Unknown — %s" % _ml(fl.get("source"), 200))
    else:
        L.append("| | |")
        L.append("|---|---|")
        L.append("| Open workers | **%s** of cap %s (%s free) |"
                 % (fl.get("open_workers"), fl.get("cap"), fl.get("free_slots")))
        L.append("| Cycle | %s |" % _ml(fl.get("cycle"), 40))
        L.append("| Orchestrator | %s · context %s%% |"
                 % (_ml(fl.get("orchestrator_status"), 40), fl.get("orchestrator_context_pct")))
    L.append("")

    # 3. Delivery: where the code is right now.
    L.append("## 3. Delivery")
    L.append("")
    L.append("Branch `%s` @ `%s`%s" % (_ml(dl.get("branch"), 60), _ml(dl.get("head"), 12),
             (" · %d dirty path(s)" % dl["dirty_paths"]) if dl.get("dirty_paths") else ""))
    L.append("")
    commits = dl.get("commits_on_date") or []
    if commits:
        L.append("Shipped %s (%d):" % (date, len(commits)))
        for c in commits[:8]:
            L.append("- `%s` %s" % (_ml(c.get("sha"), 12), _ml(c.get("subject"), 120)))
        if len(commits) > 8:
            L.append("- …and %d more" % (len(commits) - 8))
    else:
        L.append("No commits on %s." % date)
    L.append("")
    prs = [p for p in (dl.get("prs") or []) if (p.get("state") or "").upper() == "OPEN"]
    if prs:
        L.append("Open PRs (%d):" % len(prs))
        for p in prs[:5]:
            L.append("- #%s %s" % (_ml(p.get("number"), 10), _ml(p.get("title"), 120)))
        if len(prs) > 5:
            L.append("- …and %d more" % (len(prs) - 5))
        L.append("")

    # 4. Tasks — counts only. The full table is 100+ rows; a phone wants the shape, not the list.
    by = dict(tk.get("by_status") or {})
    L.append("## 4. Tasks")
    L.append("")
    if by:
        # Delivery order, not count order. Sorting by count puts `unknown` — which is an absence of
        # information, not a state of any task — first and largest, and the reader's eye lands on the
        # one number that says nothing. Known states lead; the unknowns are reported after, as the
        # measurement gap they are.
        unknown = by.pop("unknown", 0)
        lead = [s for s in ("In Progress", "In Review", "To Do", "Done") if s in by]
        rest = sorted(k for k in by if k not in lead)
        order = lead + rest
        if order:
            # The count is the one magnitude this section has to compare, and a table is the one place
            # Markdown will right-align it. Delivery order, not count order — sorting by count floats
            # the largest number up regardless of what it means; the unknown note below says why absence
            # is reported apart from the states, not ranked among them.
            L.append("| Status | Tasks |")
            L.append("|---|--:|")
            for k in order:
                L.append("| %s | %s |" % (_ml(k, 40), by[k]))
        else:
            L.append("No task is in a known state.")
        if unknown:
            L.append("")
            L.append("%s more carry no status here — the tracker was last polled **%s** ago, so this"
                     " is what the poll missed, not %s idle tasks."
                     % (unknown, tk.get("tracker_age_human") or _age(tk.get("tracker_age_s")), unknown))
    else:
        L.append("No task data.")
    L.append("")

    # 5. Cost & runway.
    L.append("## 5. Cost & runway")
    L.append("")
    L.append("Cumulative **%s** tokens over %s cycle(s)."
             % ("{:,}".format(co["cumulative_total"]) if isinstance(co.get("cumulative_total"), int)
                else "?", co.get("cumulative_cycles")))
    if co.get("ceiling") is None:
        L.append("")
        L.append("**No ceiling is set**, so there is no percentage to be at — %s"
                 % _ml(co.get("ceiling_why"), 240))
    nx = rw.get("next_event") or {}
    L.append("")
    if nx.get("label"):
        # The same lie the staleness grade told, wearing runway's clothes: `in 1m` counted minutes
        # from a NOW this file cannot see, so a page built at 23:00 kept promising a deadline `in 1m`
        # at 03:00 — five hours after it passed. Solve the build's own arithmetic once and print the
        # ABSOLUTE instant instead: generated_at + the offset. A moment does not decay while the file
        # sits in git, so the reader compares it against the clock in his hand, never against a stale
        # countdown. Same currency as the STALE/DEAD moments above it.
        gen = parse_ts(bundle.get("generated_at"))
        try:
            hrs = float(nx.get("hours"))
        except (TypeError, ValueError):
            hrs = None
        if gen is not None and hrs is not None:
            L.append("Next runway event: **%s** — %s at **`%s`**."
                     % (_ml(nx.get("label"), 60), _ml(nx.get("on_exhaustion"), 40),
                        _iso(gen + hrs * 3600)))
        else:
            L.append("Next runway event: **%s** — %s, but this build could not place it on a clock"
                     " (no %s), so treat its timing as unknown."
                     % (_ml(nx.get("label"), 60), _ml(nx.get("on_exhaustion"), 40),
                        "build time" if gen is None else "eta"))
    else:
        L.append("Runway: `%s` (%s of %s axes known)."
                 % (_ml(rw.get("bound"), 40), rw.get("known"), rw.get("total")))
    L.append("")

    # 6. Today's activity, and how much of it was mechanical rather than model-written.
    L.append("## 6. Activity")
    L.append("")
    L.append("**%s** events today of **%s** total%s."
             % (ev.get("today"), ev.get("total"),
                (" · %d%% mechanical" % round((ev.get("mechanical_share") or 0) * 100))
                if ev.get("mechanical_share") is not None else ""))
    # `decisions.recent` arrives OLDEST-first. Slicing the head of it under the word "latest" printed
    # the four oldest records on the page — a caption that contradicted its own list. Sort, then take
    # the tail. And print the DECISION: an id whose text is another id ("d-…-001 — q-…-001") tells a
    # reader at 07:00 nothing at all, which is worse than omitting the section.
    recent_dec = sorted((dec.get("recent") or []), key=lambda d: d.get("ts") or "")
    if recent_dec:
        shown = recent_dec[-4:]
        L.append("")
        L.append("Latest decisions (%s total, newest first):" % dec.get("total"))
        for d in reversed(shown):
            what = _ml(d.get("decision"), 180)
            task = d.get("task")
            L.append("- **%s**%s — %s"
                     % (what if what else "(no text recorded)",
                        (" `%s`" % _ml(task, 20)) if task else "",
                        _ml((d.get("ts") or "")[:16].replace("T", " "), 20)))
            if d.get("rule"):
                L.append("  <br>by rule: %s" % _ml(d.get("rule"), 120))
        # The caption already names the total; the marker makes the gap between it and the four shown
        # explicit, the same `…and N more` the commit list above uses so the reader learns one idiom
        # for a trimmed list, not two.
        total = dec.get("total")
        if isinstance(total, int) and total > len(shown):
            L.append("- …and %d more" % (total - len(shown)))
    L.append("")

    # 7. Where to go next — and an honest word about which links a phone can actually open.
    L.append("## 7. The rest of the dashboard")
    L.append("")
    if ui is not None and not ui.get("ok"):
        L.append("⚠️ The seven HTML screens did **not** regenerate this pass (`%s`) and are stale."
                 " This page is not — it is built without node, straight from the bundle."
                 % _ml(ui.get("reason"), 60))
        L.append("")
    L.append("- [Morning digests](../digest/) — Markdown, renders on a phone like this page does.")
    L.append("- The seven screens live in `docs/lab/site/` as self-contained HTML. **GitHub will not"
             " render them** — it shows `.html` as escaped source, on every surface, private repo or"
             " not. Open them from a desktop clone over `file://`, or see"
             " [the transport table](../site/README.md).")
    L.append("")
    L.append("<sub>`%s` · schema `%s`</sub>" % (_ml(bundle.get("generated_by"), 120),
                                                _ml(bundle.get("schema"), 40)))
    return "\n".join(L) + "\n"

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
    # Group the day by WHEN IT HAPPENED (ts), not by which file it was written into (_day). Since
    # GSL-89 a backfilled line lives in today's file carrying yesterday's ts — keyed on the filename,
    # last night's recovered commits would be counted as "events today" and land in this morning's
    # digest as today's work. That is the very lie poll-fill's floor was invented to prevent. For a
    # line written as it happened the two keys agree, so this changes nothing for the hook layer.
    day_events = [e for e in events_all if (e.get("ts") or "")[:10] == ARGS["date"]]
    questions, candidates = load_questions()
    ctx = {
        "date": ARGS["date"],
        "events": events_all, "event_days": event_days, "day_events": day_events,
        "questions": questions, "candidates": candidates,
        "decisions": load_decisions(),
        "git": load_git(ARGS["date"]),
        "prs": load_gh(),
        "gh_issues": load_gh_issues(),
        "heartbeat": load_heartbeat(),
        "state": load_state(),
        "narrative": None,
    }
    ctx["pulses"] = load_heartbeat_history()
    ctx["cost"]   = load_cost(ctx["state"], events_all, event_days)
    # Fleet AFTER cost, and not by accident: a worker's token count exists only in the telemetry
    # ledger, so the cards are joined onto it by worker name.
    ctx["fleet"]  = fleet_census(events_all, ctx["heartbeat"] or {}, ctx["cost"])
    ctx["tasks"]  = tasks_board(events_all, ctx["git"], ctx["prs"], ctx["gh_issues"])
    ctx["queue"]  = build_queue(questions)
    ctx["runway"] = compute_runway(ctx)

    status = build_status(ctx)
    # Self-health AFTER status: two of its three meters are about the build itself (its clock, and the
    # age of the freshest event IN it), and neither exists before status.json has been assembled.
    ctx["self_health"] = build_self_health(ctx, status)
    if ARGS["narrate"]:
        ctx["narrative"] = narrate(status)
        status["narrative"] = ctx["narrative"]
        status["degraded"] = DEGRADED          # narrate() may have degraded

    written = []
    ui = {"ok": False, "reason": "not-run", "renderer": None, "screens": [],
          "last_success_at": prev_ui_last_success()}
    try:
        os.makedirs(os.path.join(LAB, "site"), exist_ok=True) if not ARGS["dry_run"] else None

        bundle = build_render_bundle(ctx, status)
        written.append(lab_write("docs/lab/render_bundle.json",
                                 json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", as_json=True))

        # The view layer runs even under --dry-run: rendering is a pure function, and a --dry-run that
        # skipped it would report "ok" for a pass whose renderer would have failed. It is Python that
        # withholds the WRITE (lab_write short-circuits), not the renderer that withholds the work.
        res = render_site(bundle)
        if res.get("ok"):
            for name, doc in sorted((res.get("pages") or {}).items()):
                written.append(lab_write("docs/lab/site/%s" % name, doc))
            ui = {"ok": True, "reason": None, "renderer": res.get("renderer"),
                  "screens": res.get("screens") or [], "last_success_at": status["generated_at"]}
        else:
            reason, hint = res.get("reason", "build-failed"), res.get("hint", "")
            degrade("ui", "%s: %s" % (reason, UI_REASONS.get(reason, "?")))
            last = prev_ui_last_success()
            ui = {"ok": False, "reason": reason, "hint": str(hint)[:400], "renderer": None,
                  "screens": [], "last_success_at": last}
            # Never a false-fresh render: the pages that ARE on disk get told what happened to them.
            ui["banner_stamped_on"] = apply_degrade_banner(reason, hint, last)
            log("UI render degraded (%s) — pages left stale under a banner" % reason)

        written.append(lab_write("docs/lab/site/README.md", SITE_README))

        # The phone page (GSL-108). Written AFTER the render attempt so it can say whether the HTML
        # screens are current, and OUTSIDE its success branch so it is written whether they are or
        # not — the one surface the owner can reach from bed must not be the one that disappears when
        # node does. It is a projection of `bundle`, so it costs no new reads of the world.
        os.makedirs(os.path.join(LAB, "mobile"), exist_ok=True) if not ARGS["dry_run"] else None
        written.append(lab_write("docs/lab/mobile/README.md", build_mobile(bundle, ui)))

        # status.json is written LAST because it is the only artifact that knows how the render went;
        # it is also the one file a torn write would be catastrophic in, which is why it — like every
        # other byte here — goes out through lab-write.sh (temp + rename).
        status["ui"] = ui
        status["degraded"] = DEGRADED
        written.append(lab_write("docs/lab/status.json",
                                 json.dumps(status, ensure_ascii=False, indent=2) + "\n", as_json=True))

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
        "ui": ui,
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
