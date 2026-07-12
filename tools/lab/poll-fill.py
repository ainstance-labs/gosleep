#!/usr/bin/env python3
# gosleep lab — poll-fill (GSL-87). Reconcile-don't-trust. Invoked via tools/lab/poll-fill.sh,
# and automatically as the first step of every chronicler pass. See the wrapper for the contract.
# python3 stdlib only. 0 API keys (C1).
import sys, os, re, json, subprocess, datetime, glob

# ───────────────────────────── args ─────────────────────────────

def parse_args(argv):
    a = {"repo": os.environ.get("GOSLEEP_REPO", ""), "since_days": 7, "dry_run": False,
         "json": False, "quiet": False, "jira_json": "", "no_git": False, "no_gh": False,
         "no_jira": False, "prehistory": False, "git_repo": ""}
    i = 0
    while i < len(argv):
        f = argv[i]
        if   f == "--repo":        i += 1; a["repo"] = argv[i]
        elif f == "--git-repo":    i += 1; a["git_repo"] = argv[i]
        elif f == "--since-days":  i += 1; a["since_days"] = int(argv[i])
        elif f == "--jira-json":   i += 1; a["jira_json"] = argv[i]
        elif f == "--no-git":      a["no_git"] = True
        elif f == "--no-gh":       a["no_gh"] = True
        elif f == "--no-jira":     a["no_jira"] = True
        elif f == "--prehistory":  a["prehistory"] = True
        elif f == "--dry-run":     a["dry_run"] = True
        elif f == "--json":        a["json"] = True
        elif f in ("--quiet", "-q"): a["quiet"] = True
        else: sys.exit("poll-fill: unknown flag %r" % f)
        i += 1
    if not a["repo"]:
        a["repo"] = os.environ.get("POLLFILL_REPO_DEFAULT") or os.getcwd()
    # Two different things, and conflating them silently disables `gh`: --repo says WHERE THE LAB IS
    # (where events are written), --git-repo says WHICH REPOSITORY to reconcile against. They are the
    # same in production and differ in a test, where the lab is a throwaway dir that git has never
    # heard of — and `gh` refuses to run outside a git worktree.
    if not a["git_repo"]:
        a["git_repo"] = (a["repo"] if os.path.isdir(os.path.join(a["repo"], ".git"))
                         else (os.environ.get("POLLFILL_REPO_DEFAULT") or a["repo"]))
    return a

ARGS  = parse_args(sys.argv[1:])
REPO  = ARGS["repo"]
GIT_REPO = ARGS["git_repo"]
LAB   = os.path.join(REPO, "docs", "lab")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CHILD_ENV = dict(os.environ, GOSLEEP_LAB_DIR=LAB, GOSLEEP_REPO=REPO)

SKIPPED = []
def skip(source, why):
    SKIPPED.append({"source": source, "why": str(why)[:200]})
    if not ARGS["quiet"]:
        sys.stderr.write("poll-fill: skipped %s — %s\n" % (source, str(why)[:120]))

def run(cmd, timeout=25):
    """git/gh run inside GIT_REPO (the repository being reconciled), never inside the lab dir."""
    try:
        p = subprocess.run(cmd, cwd=GIT_REPO, capture_output=True, text=True, timeout=timeout,
                           env=CHILD_ENV)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except FileNotFoundError:
        raise RuntimeError("%s not installed" % cmd[0])
    except subprocess.TimeoutExpired:
        raise RuntimeError("timeout after %ss" % timeout)

# ───────────────────────────── what the log already knows ─────────────────────

def short(sha):
    return (sha or "")[:7]

def scan_log():
    """Every identity the timeline already carries, across ALL days — hook-written and poll-written
    alike. This set is the entire idempotency mechanism: a second pass adds nothing because every
    key it computes is already in here. Keyed on the EXTERNAL id (sha / PR number / issue+status),
    never on seq or ts, because the same fact re-observed must collapse onto the same key.

    Also returns the log's FLOOR — the timestamp of its very first line. See below for why."""
    keys, floor = set(), None
    for path in sorted(glob.glob(os.path.join(LAB, "events", "*.jsonl"))):
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    ts = e.get("ts")
                    if ts and (floor is None or ts < floor):
                        floor = ts
                    for k in identity_keys(e):
                        keys.add(k)
        except OSError:
            pass
    return keys, floor

def identity_keys(e):
    """The identity of an event as a FACT, independent of who noticed it. A commit logged by the
    PostToolUse hook and the same commit seen later in `git log` must produce the same key — that is
    what stops poll-fill from duplicating the fleet's own work."""
    t = e.get("type") or ""
    d = e.get("data") or {}
    out = []
    if t == "vcs.commit":
        sha = short(str(d.get("sha") or ""))
        if sha:
            out.append("commit:" + sha)
    elif t.startswith("vcs.pr."):
        num = d.get("pr") or d.get("number")
        if num:
            out.append("%s:%s" % (t, num))
    elif t.startswith("tracker.issue."):
        key = d.get("key") or d.get("issue")
        if key:
            # The status is part of the identity: an issue moves more than once, and each state it is
            # seen in is a distinct fact. Without it, re-opened-then-closed would collapse to one.
            #
            # The hook writes {key, transition:""} — it witnesses THAT an issue moved but not WHERE
            # to (the MCP payload carries a transition id, not a status name). So a hook line and a
            # poll-fill line about the same issue are NOT duplicates: one says "it moved", the other
            # says "it now stands in Done". Both are true, neither implies the other, and they carry
            # different types (transitioned / updated), so they never collide on a key.
            st = (d.get("status") or d.get("to") or "").lower()
            out.append("%s:%s:%s" % (t, key, st))
    return out

# ───────────────────────────── sources of external truth ──────────────────────

def from_git(since_iso):
    """Commits made outside an agent session — by the owner, by a rebase, by a merge on another
    machine. The hook never saw them; git always has them."""
    out = []
    rc, txt, err = run(["git", "log", "--since", since_iso, "--all",
                        "--pretty=%h%x1f%cI%x1f%an%x1f%s"])
    if rc != 0:
        raise RuntimeError(err or "git rc=%d" % rc)
    for line in txt.splitlines():
        parts = line.split("\x1f")
        if len(parts) < 4:
            continue
        sha, cts, author, subj = parts[0], parts[1], parts[2], parts[3]
        out.append({
            "key": "commit:" + short(sha),
            "type": "vcs.commit",
            "data": {"sha": short(sha), "subject": subj[:200], "author": author,
                     "occurred_at": cts, "source": "git", "reconciled": True},
        })
    return out

def from_gh():
    """THE acceptance case (R4.2, verbatim): a PR merged from the web UI is invisible to every hook,
    because no agent ran a command. Without this, the timeline would confidently show a PR that is
    still open — and a lying timeline is worse than a missing one."""
    out = []
    rc, txt, err = run(["gh", "pr", "list", "--state", "all", "--limit", "50",
                        "--json", "number,title,state,url,createdAt,mergedAt,author"])
    if rc != 0:
        raise RuntimeError(err or "gh rc=%d" % rc)
    for pr in json.loads(txt or "[]"):
        num = pr.get("number")
        out.append({
            "key": "vcs.pr.opened:%s" % num,
            "type": "vcs.pr.opened",
            "data": {"pr": num, "title": (pr.get("title") or "")[:200], "url": pr.get("url"),
                     "occurred_at": pr.get("createdAt"), "source": "gh", "reconciled": True},
        })
        if pr.get("mergedAt"):
            out.append({
                "key": "vcs.pr.merged:%s" % num,
                "type": "vcs.pr.merged",
                "data": {"pr": num, "title": (pr.get("title") or "")[:200], "url": pr.get("url"),
                         "occurred_at": pr.get("mergedAt"), "source": "gh", "reconciled": True},
            })
    return out

def from_jira():
    """Jira has no CLI on this machine and we hold NO API key (C1) — so the JQL itself must come from
    the MCP side (an agent or the orchestrator). Two supported feeds, in order:

      1. --jira-json FILE  — a JSON array of issues: [{"key","status","updated","summary"}, …]
      2. acli / jira CLI   — if one is ever installed, we use it

    Neither present => skipped, LOUDLY: the skip lands in the report, in status.json (degraded[]) and
    on the page. An un-run reconcile that looks like a clean one is exactly the failure this whole
    task exists to prevent."""
    issues = None
    if ARGS["jira_json"]:
        with open(ARGS["jira_json"], encoding="utf-8") as f:
            issues = json.load(f)
    else:
        for cli in (["acli", "jira", "issue", "list", "--json"], ["jira", "issue", "list", "--json"]):
            try:
                rc, txt, _ = run(cli)
                if rc == 0 and txt:
                    issues = json.loads(txt)
                    break
            except RuntimeError:
                continue
    if issues is None:
        raise RuntimeError("no Jira feed: install acli/jira, or pass --jira-json "
                           "(the orchestrator can dump a JQL result from the Atlassian MCP)")
    out = []
    for it in issues:
        # Accept both a flat shape and the raw Jira REST shape, so an MCP dump can be piped in as-is.
        key = it.get("key")
        fields = it.get("fields") or {}
        status = it.get("status") or (fields.get("status") or {}).get("name") or ""
        updated = it.get("updated") or fields.get("updated") or ""
        summary = it.get("summary") or fields.get("summary") or ""
        if not key or not status:
            continue
        # NOT `transitioned` — `updated`. JQL tells us an issue IS in a status; it does not tell us a
        # transition HAPPENED. An issue created in To Do and never touched would otherwise be logged
        # as "transitioned to To Do" — an event that never occurred. That is precisely the lying
        # timeline this task exists to prevent, and it would be self-inflicted.
        # `updated` says exactly what we know and no more: at this moment, the issue stood in status X.
        # An issue dragged to Done on a phone still surfaces — with a new status, hence a new key.
        out.append({
            "key": "tracker.issue.updated:%s:%s" % (key, status.lower()),
            "type": "tracker.issue.updated",
            "task": key,
            "data": {"key": key, "status": status, "summary": summary[:200],
                     "occurred_at": updated, "source": "jira", "reconciled": True,
                     "note": "state observed via JQL; no transition was witnessed"},
        })
    return out

# ───────────────────────────── write (through the ONE writer) ─────────────────

def emit(ev):
    """Через lab-log.sh — единственного писателя events/*.jsonl. Never a hand-append: seq is
    allocated under a lock, and a hand-written line has none.

    NOTE on ts: lab-log stamps ts = NOW (it has no --ts flag). For a reconciled event that is the
    honest reading anyway — ts is WHEN WE LEARNED IT, and data.occurred_at is WHEN IT HAPPENED. The
    two differ precisely because nobody was watching, which is the whole point of this pass. If a
    later task adds --ts to lab-log (a good idea — see GSL-89), the fix is one line here."""
    cmd = ["bash", os.path.join(TOOLS, "lab-log.sh"),
           "--type", ev["type"], "--src", "poll-fill", "--actor", "poll-fill",
           "--data-json", json.dumps(ev["data"], ensure_ascii=False), "--quiet"]
    if ev.get("task"):
        cmd += ["--task", ev["task"]]
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO, env=CHILD_ENV)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip()[:200])

# ───────────────────────────── main ─────────────────────────────

def main():
    since = (datetime.datetime.now(datetime.timezone.utc)
             - datetime.timedelta(days=ARGS["since_days"])).strftime("%Y-%m-%dT%H:%M:%SZ")

    known, floor = scan_log()
    candidates, checked = [], []
    for name, enabled, fn in (("git",  not ARGS["no_git"],  lambda: from_git(since)),
                              ("gh",   not ARGS["no_gh"],   from_gh),
                              ("jira", not ARGS["no_jira"], from_jira)):
        if not enabled:
            skip(name, "disabled by flag")
            continue
        try:
            candidates += fn()
            checked.append(name)
        except Exception as exc:
            skip(name, exc)

    # THE FLOOR. lab-log stamps ts = now, so a week-old commit backfilled today would land on TODAY's
    # timeline — and the dashboard would report a hundred "events today" that happened last Tuesday.
    # A log is only answerable for the period it existed: anything older than its first line is
    # pre-history, not a gap. Skipped by default, counted out loud (never silently), and available on
    # demand with --prehistory for a one-off bootstrap.
    prehistory = []
    if floor and not ARGS["prehistory"]:
        keep = []
        for c in candidates:
            occ = (c["data"] or {}).get("occurred_at") or ""
            (prehistory if (occ and occ < floor) else keep).append(c)
        candidates = keep

    # Dedup against the log AND within this batch (gh lists a PR once per state; git --all can repeat
    # a sha across refs). Idempotency is the acceptance criterion, so it is enforced twice.
    seen, missing = set(), []
    for c in candidates:
        if c["key"] in known or c["key"] in seen:
            continue
        seen.add(c["key"])
        missing.append(c)

    written, failed = [], []
    if not ARGS["dry_run"]:
        for ev in missing:
            try:
                emit(ev)
                written.append(ev["key"])
            except Exception as exc:
                failed.append({"key": ev["key"], "why": str(exc)[:160]})

    report = {
        "ok": True,
        "dry_run": ARGS["dry_run"],
        "sources_checked": checked,
        "skipped": SKIPPED,
        "git_repo": GIT_REPO,
        "log_floor": floor,
        "prehistory_skipped": len(prehistory),   # counted, never silent: a dropped fact must be visible
        "known_facts": len(known),
        "candidates": len(candidates),
        "missing": [{"type": m["type"], "key": m["key"]} for m in missing],
        "written": written if not ARGS["dry_run"] else [],
        "failed": failed,
        "since": since,
    }
    if ARGS["json"]:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif not ARGS["quiet"]:
        print("poll-fill: %s%d gap(s) from %s — %d written%s%s" % (
            "[dry-run] " if ARGS["dry_run"] else "",
            len(missing), ",".join(checked) or "no source", len(written),
            (" · %d pre-history skipped (before the log began; --prehistory to include)"
             % len(prehistory)) if prehistory else "",
            (" · skipped: " + ",".join(s["source"] for s in SKIPPED)) if SKIPPED else ""))
    return 0 if not failed else 1

sys.exit(main())
