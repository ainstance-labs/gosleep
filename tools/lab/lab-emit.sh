#!/usr/bin/env bash
# =============================================================================
# gosleep lab — lab-emit: typed question records in docs/lab/questions/queue.jsonl
# (GSL-75; PRD Phase 3 R3.2 — append-only queue + dedup + patch records.)
#
# Subcommands:
#   question --type BLOCKER|DECISION|CLARIFY|FYI --question "..."
#            [--from ACTOR] [--task KEY] [--default "..."] [--default-rationale "..."]
#            [--reversibility high|med|low] [--impact "..."] [--auto-apply-at ISO-UTC]
#            [--link k=v ...] [--option "label|pros|cons" ...] [--high-impact]
#            -> prints the new id, or "DUPLICATE <id>" when deduped into an open record
#   answer   --re q-ID --answer "..." [--by owner|orchestrator] [--channel CH]
#   resolve  --re q-ID --applied "..."          # deadline hit -> default applied
#   list     [--status open|all|answered|auto-resolved|answered-by-default|noted]
#            [--type T] [--task KEY] [--due] [--json] [--count]
#   decision --decision "..." (--re q-ID | --question "...") [--task KEY]
#            [--rule "manifest §N.bullet"] [--by orchestrator|owner] [--channel CH]
#            -> appends to decisions/log.jsonl (GSL-77); an ORCHESTRATOR decision
#               REQUIRES --rule (provenance, F3-S3); --re pulls question/task/type
#               context from the queue record automatically
#   candidates [--min N] [--json]               # learning-loop scan (GSL-77):
#            same question-shape decided the same way >= N (default 3) times
#            -> manifest-candidate lines for the morning digest
#
# Discipline (skill "Question queue" section):
#   * append-only JSONL — a record is NEVER rewritten; every status change is a NEW
#     patch record {"re":"<id>", ...}; corrections append, never edit history (C8).
#   * dedup — an OPEN record with the same (task, question-hash) gets a seen_by
#     patch instead of a second question (question-spam guard, 05 §4.2).
#   * atomic — single-line O_APPEND writes under a mkdir lock (id generation and
#     dedup are read-then-append and must be exclusive).
#
# Env: GOSLEEP_LAB_DIR overrides the lab dir (default <repo>/docs/lab) — smoke uses it.
# 0 LLM calls (C1). python3 stdlib only (JSON safety). macOS/BSD userland.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export LAB_DIR="${GOSLEEP_LAB_DIR:-$REPO_ROOT/docs/lab}"

exec python3 - "$@" <<'PY'
import sys, os, json, hashlib, time, re
from datetime import datetime, timedelta, timezone

LAB   = os.environ["LAB_DIR"]
QDIR  = os.path.join(LAB, "questions")
QUEUE = os.path.join(QDIR, "queue.jsonl")
LOCK  = os.path.join(QDIR, ".queue.lock")
DDIR  = os.path.join(LAB, "decisions")
DLOG  = os.path.join(DDIR, "log.jsonl")
DLOCK = os.path.join(DDIR, ".log.lock")

TYPES    = ("BLOCKER", "DECISION", "CLARIFY", "FYI")
STATUSES = ("open", "answered", "auto-resolved", "answered-by-default", "noted")

def die(msg):
    print("lab-emit: error: %s" % msg, file=sys.stderr)
    sys.exit(1)

def iso_utc(dt=None):
    dt = dt or datetime.now(timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def qhash(task, question):
    norm = re.sub(r"\s+", " ", question.strip().lower())
    return hashlib.sha256(("%s|%s" % (task or "", norm)).encode()).hexdigest()[:10]

class DirLock:
    """mkdir-based exclusive lock (portable; macOS ships no flock(1)). Steals stale (>30s) locks."""
    def __init__(self, path=LOCK):
        self.path = path
    def __enter__(self):
        for _ in range(200):
            try:
                os.makedirs(os.path.dirname(self.path), exist_ok=True)
                os.mkdir(self.path)
                return self
            except FileExistsError:
                try:
                    if time.time() - os.stat(self.path).st_mtime > 30:
                        os.rmdir(self.path)
                        continue
                except FileNotFoundError:
                    continue
                time.sleep(0.05)
        die("could not acquire lock (%s)" % self.path)
    def __exit__(self, *a):
        try:
            os.rmdir(self.path)
        except FileNotFoundError:
            pass

QueueLock = DirLock

def read_jsonl(path):
    if not os.path.exists(path):
        return []
    recs = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                recs.append(json.loads(line))
            except ValueError:
                print("lab-emit: warn: skipping corrupt line %d" % n, file=sys.stderr)
    return recs

def fold(records):
    """Merge base records + patch records into current per-id state. Later patches win."""
    state = {}
    for r in records:
        if "id" in r:
            m = dict(r)
            m.setdefault("seen_by", [m.get("from", "?")])
            state[r["id"]] = m
        elif "re" in r and r["re"] in state:
            s = state[r["re"]]
            if r.get("seen_by") and r["seen_by"] not in s["seen_by"]:
                s["seen_by"].append(r["seen_by"])
            if r.get("status"):
                s["status"] = r["status"]
            for k in ("answer", "answered_by", "channel", "applied"):
                if k in r:
                    s[k] = r[k]
    return state

def append_jsonl(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")

def read_records():
    return read_jsonl(QUEUE)

def append_record(obj):
    append_jsonl(QUEUE, obj)

def qshape(question):
    """Task-agnostic question SHAPE for the learning loop: numbers/keys/paths collapsed."""
    s = question.strip().lower()
    s = re.sub(r"[a-z]+-\d+", "<key>", s)          # GSL-45, tlm-8 ...
    s = re.sub(r"#\d+", "<ref>", s)                # #52
    s = re.sub(r"\S*/\S+", "<path>", s)            # paths/urls
    s = re.sub(r"\d+", "<n>", s)
    s = re.sub(r"\s+", " ", s)
    return hashlib.sha256(s.encode()).hexdigest()[:10]

def parse_flags(argv, spec, multi=()):
    """spec: {'--flag': 'key'}; multi flags accumulate into lists; bare flags in spec map to True."""
    out = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a not in spec:
            die("unknown flag %r" % a)
        key = spec[a]
        if key.startswith("!"):          # boolean flag
            out[key[1:]] = True
            i += 1
            continue
        if i + 1 >= len(argv):
            die("flag %s needs a value" % a)
        val = argv[i + 1]
        if a in multi:
            out.setdefault(key, []).append(val)
        else:
            out[key] = val
        i += 2
    return out

def default_deadline():
    """Manifest §2 defaults: posed in the night window (00:00–08:30 local) -> today 10:00 local; day -> +2h."""
    loc = datetime.now().astimezone()
    if loc.hour < 8 or (loc.hour == 8 and loc.minute < 30):
        d = loc.replace(hour=10, minute=0, second=0, microsecond=0)
    else:
        d = loc + timedelta(hours=2)
    return iso_utc(d)

def next_id(records):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pat = re.compile(r"^q-%s-(\d{3})$" % re.escape(today))
    n = 0
    for r in records:
        m = pat.match(r.get("id", ""))
        if m:
            n = max(n, int(m.group(1)))
    return "q-%s-%03d" % (today, n + 1)

def cmd_question(argv):
    a = parse_flags(argv, {
        "--type": "type", "--question": "question", "--from": "from", "--task": "task",
        "--default": "default", "--default-rationale": "default_rationale",
        "--reversibility": "reversibility", "--impact": "impact_if_wrong",
        "--auto-apply-at": "auto_apply_at", "--link": "links", "--option": "options",
        "--high-impact": "!high_impact",
    }, multi=("--link", "--option"))
    typ = a.get("type") or die("--type is required")
    if typ not in TYPES:
        die("--type must be one of %s" % "|".join(TYPES))
    question = a.get("question") or die("--question is required")
    if typ in ("DECISION", "CLARIFY") and not a.get("default"):
        die("%s requires --default (a %s without a default is a BLOCKER)" % (typ, typ))
    frm  = a.get("from", "orchestrator")
    task = a.get("task", "")
    links = {}
    for kv in a.get("links", []):
        if "=" not in kv:
            die("--link expects k=v, got %r" % kv)
        k, v = kv.split("=", 1)
        links[k] = v
    options = []
    for o in a.get("options", []):
        parts = (o.split("|") + ["", ""])[:3]
        options.append({"label": parts[0], "pros": parts[1], "cons": parts[2]})
    with QueueLock():
        records = read_records()
        h = qhash(task, question)
        for qid, m in fold(records).items():
            if m.get("status") == "open" and m.get("qhash") == h:
                append_record({"re": qid, "ts": iso_utc(), "seen_by": frm})
                print("DUPLICATE %s" % qid)
                return
        qid = next_id(records)
        status = {"BLOCKER": "open", "DECISION": "open",
                  "CLARIFY": "answered-by-default", "FYI": "noted"}[typ]
        rec = {"id": qid, "ts": iso_utc(), "type": typ, "from": frm, "task": task,
               "links": links, "question": question, "options": options,
               "default": a.get("default", ""),
               "default_rationale": a.get("default_rationale", ""),
               "reversibility": a.get("reversibility", ""),
               "impact_if_wrong": a.get("impact_if_wrong", ""),
               "auto_apply_at": (a.get("auto_apply_at") or default_deadline()) if typ == "DECISION" else a.get("auto_apply_at", ""),
               "status": status, "qhash": h}
        if a.get("high_impact"):
            rec["high_impact"] = True
        append_record(rec)
        print(qid)

def _patch(argv, spec, required, build, verb):
    a = parse_flags(argv, spec)
    for r in required:
        if not a.get(r):
            die("--%s is required" % r.replace("_", "-"))
    with QueueLock():
        state = fold(read_records())
        qid = a["re"]
        if qid not in state:
            die("no record with id %s" % qid)
        append_record(build(a))
        print("%s %s" % (verb, qid))

def cmd_answer(argv):
    _patch(argv,
           {"--re": "re", "--answer": "answer", "--by": "by", "--channel": "channel"},
           ("re", "answer"),
           lambda a: {"re": a["re"], "ts": iso_utc(), "status": "answered",
                      "answer": a["answer"], "answered_by": a.get("by", "owner"),
                      "channel": a.get("channel", "terminal")},
           "answered")

def cmd_resolve(argv):
    _patch(argv,
           {"--re": "re", "--applied": "applied"},
           ("re", "applied"),
           lambda a: {"re": a["re"], "ts": iso_utc(), "status": "auto-resolved",
                      "applied": a["applied"]},
           "auto-resolved")

def cmd_list(argv):
    a = parse_flags(argv, {"--status": "status", "--type": "type", "--task": "task",
                           "--due": "!due", "--json": "!json", "--count": "!count"})
    want = a.get("status", "open")
    if want != "all" and want not in STATUSES:
        die("--status must be all|%s" % "|".join(STATUSES))
    merged = sorted(fold(read_records()).values(), key=lambda m: m.get("ts", ""))
    if a.get("count"):
        opens = [m for m in merged if m.get("status") == "open"]
        by = {t: sum(1 for m in opens if m.get("type") == t) for t in TYPES}
        print("open=%d (%dB/%dD/%dC/%dF)" % (len(opens), by["BLOCKER"], by["DECISION"],
                                             by["CLARIFY"], by["FYI"]))
        return
    now = iso_utc()
    rows = []
    for m in merged:
        if want != "all" and m.get("status") != want:
            continue
        if a.get("type") and m.get("type") != a["type"]:
            continue
        if a.get("task") and m.get("task") != a["task"]:
            continue
        if a.get("due") and not (m.get("status") == "open" and m.get("type") == "DECISION"
                                 and m.get("auto_apply_at") and m["auto_apply_at"] <= now):
            continue
        rows.append(m)
    for m in rows:
        if a.get("json"):
            print(json.dumps(m, ensure_ascii=False))
        else:
            q = m.get("question", "")
            q = q[:80] + ("…" if len(q) > 80 else "")
            print("%s  %-8s %-8s %-19s due=%s seen_by=%d  %s" % (
                m.get("id"), m.get("type", "?"), m.get("task") or "-",
                m.get("status", "?"), m.get("auto_apply_at") or "-",
                len(m.get("seen_by", [])), q))

def cmd_decision(argv):
    a = parse_flags(argv, {"--re": "re", "--decision": "decision", "--question": "question",
                           "--task": "task", "--rule": "rule", "--by": "by",
                           "--channel": "channel"})
    if not a.get("decision"):
        die("--decision is required")
    by = a.get("by", "orchestrator")
    if by == "orchestrator" and not a.get("rule"):
        die("an orchestrator decision REQUIRES --rule \"manifest §N.bullet\" (provenance, F3-S3); "
            "no citable rule -> it is a DECISION record with a deadline, not an autonomous act")
    question, task, qtype = a.get("question", ""), a.get("task", ""), ""
    if a.get("re"):
        m = fold(read_records()).get(a["re"]) or die("no queue record with id %s" % a["re"])
        question = question or m.get("question", "")
        task = task or m.get("task", "")
        qtype = m.get("type", "")
    if not question:
        die("--question is required when --re is not given (the learning loop mines shapes)")
    with DirLock(DLOCK):
        recs = read_jsonl(DLOG)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        pat = re.compile(r"^d-%s-(\d{3})$" % re.escape(today))
        n = max([int(m.group(1)) for r in recs for m in [pat.match(r.get("id", ""))] if m] or [0])
        rec = {"id": "d-%s-%03d" % (today, n + 1), "ts": iso_utc(), "re": a.get("re", ""),
               "task": task, "type": qtype, "question": question, "qshape": qshape(question),
               "decision": a["decision"], "made_by": by, "rule": a.get("rule", ""),
               "channel": a.get("channel", "")}
        append_jsonl(DLOG, rec)
        print(rec["id"])

def cmd_candidates(argv):
    a = parse_flags(argv, {"--min": "min", "--json": "!json"})
    try:
        need = int(a.get("min", "3"))
    except ValueError:
        die("--min expects an integer")
    groups = {}
    for r in read_jsonl(DLOG):
        if not r.get("qshape") or not r.get("decision"):
            continue
        key = (r["qshape"], re.sub(r"\s+", " ", r["decision"].strip().lower()))
        g = groups.setdefault(key, {"count": 0, "sample": r.get("question", ""),
                                    "decision": r["decision"], "tasks": [], "rules": set(),
                                    "ids": []})
        g["count"] += 1
        g["ids"].append(r["id"])
        if r.get("task") and r["task"] not in g["tasks"]:
            g["tasks"].append(r["task"])
        if r.get("rule"):
            g["rules"].add(r["rule"])
    for (shape, _), g in sorted(groups.items(), key=lambda kv: -kv[1]["count"]):
        if g["count"] < need:
            continue
        if a.get("json"):
            g["rules"] = sorted(g["rules"])
            print(json.dumps({"qshape": shape, **g}, ensure_ascii=False))
        else:
            print('CANDIDATE ×%d: "%s" — for "%s" (tasks: %s%s) → promote to manifest §2?' % (
                g["count"], g["decision"], g["sample"][:70],
                ",".join(g["tasks"]) or "-",
                "; rules cited: " + ", ".join(sorted(g["rules"])) if g["rules"] else ""))

def main():
    if len(sys.argv) < 2:
        die("usage: lab-emit.sh question|answer|resolve|list|decision|candidates ...")
    cmd, argv = sys.argv[1], sys.argv[2:]
    fn = {"question": cmd_question, "answer": cmd_answer,
          "resolve": cmd_resolve, "list": cmd_list,
          "decision": cmd_decision, "candidates": cmd_candidates}.get(cmd)
    if not fn:
        die("unknown subcommand %r" % cmd)
    fn(argv)

main()
PY
