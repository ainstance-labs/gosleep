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
#            DECISION/CLARIFY REQUIRE --default AND --reversibility high|med (low ⇒ BLOCKER,
#            reclassify); BLOCKER takes NO --default (manifest §3: no default, ever).
#   answer   --re q-ID --answer "..." [--by owner|orchestrator] [--channel CH]
#   resolve  --re q-ID --applied "..." [--early]   # deadline hit -> default applied (GSL-200:
#            refuses pre-deadline closes — those are `--early` => answered-by-default — refuses
#            double-closes, refuses BLOCKERs)
#   apply-due [--dry-run] [--json]              # GSL-200: apply every overdue open DECISION's
#            default; idempotent; the tick's executor for deadlines nobody attended
#   list     [--status open|all|answered|auto-resolved|answered-by-default|noted]
#            [--type T] [--task KEY] [--due] [--json] [--count]
#            --count -> "open=N (xB/yD/zC/wF) lines=L" (the LIVE-STATUS questions: field verbatim)
#   decision --decision "..." (--re q-ID | --question "...") [--task KEY]
#            [--rule "manifest §N.bullet"] [--by orchestrator|owner] [--channel CH]
#            -> appends to decisions/log.jsonl (GSL-77); an ORCHESTRATOR decision
#               REQUIRES --rule (provenance, F3-S3); --re pulls question/task/type
#               context from the queue record automatically
#   candidates [--min N] [--json]               # learning-loop scan (GSL-77):
#            same question-shape decided the same way >= N (default 3) times
#            -> manifest-candidate lines for the morning digest
#   event    --type <semantic-type> [--actor A] [--task KEY] [--data k=v ...] [--data-json '{…}']
#            (GSL-84) explicit SEMANTIC event -> docs/lab/events/YYYY-MM-DD.jsonl, src="emit".
#            The hooks (GSL-83) see mechanics — a commit, a Jira call, a session dying. They cannot
#            see MEANING: that a cycle started, that a verdict was reached, that the breaker opened.
#            That is what a worker states here. Type is validated against SEMANTIC_TYPES: a typo'd
#            event is an event no consumer will ever read, so it is an error, not a new type.
#   help     list subcommands
#
# GSL-84 also makes the Phase-3 queue self-documenting: question/answer/resolve/decision now MIRROR
# themselves into the timeline (question.posed / question.answered / question.auto_resolved /
# question.deduped / decision.made) with NO change at any call site. Writes go through lab-log.sh —
# one writer, one seq allocator, one envelope. Mirroring is fail-open: the queue is load-bearing,
# the timeline is derived, so a broken event layer must never cost us a question record.
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
export LAB_LOG="$SCRIPT_DIR/lab-log.sh"      # GSL-84: the single writer of events/*.jsonl

exec python3 - "$@" <<'PY'
import sys, os, json, hashlib, time, re, subprocess
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
REVERSIBILITY = ("high", "med", "low")

# The semantic vocabulary (GSL-84). Hooks (GSL-83) capture what a machine can SEE — a commit, a Jira
# call, a session ending. These are what only an agent KNOWS. Grouped by the producer that emits them:
SEMANTIC_TYPES = (
    "run.started", "run.finished",                       # orchestrator: a night begins/ends
    "cycle.started", "cycle.ended",                      # orchestrator: a delivery cycle (PRD R4.2)
    "question.posed", "question.answered",               # question buffer (Phase 3) — auto-mirrored
    "question.auto_resolved", "question.deduped",
    "decision.made",                                     # decision log (Phase 3) — auto-mirrored
    "verify.verdict",                                    # reviewer/verifier: PASS/FAIL + why (R4.2)
    "handoff.written",                                   # handoff skill (GSL-88) — cycle + resume point
    "agent.message",                                     # report/nudge/shutdown between agents
    "mode.entered",                                      # night/day mode (Phase 2, GSL-68)
    "quota.wait_started", "quota.wait_ended",            # quota auto-wait (Phase 2, GSL-69)
    "breaker.opened", "breaker.closed",                  # circuit breaker (Phase 2, GSL-70)
    "restart.recorded",                                  # watchdog restart (Phase 1)
)

def die(msg):
    print("lab-emit: error: %s" % msg, file=sys.stderr)
    sys.exit(1)


def emit_event(typ, actor, data, task="", loud=False):
    """Append ONE semantic event by delegating to lab-log.sh — the single writer (one seq allocator,
    one lock, one envelope). src="emit" marks provenance: this line needed a model to cooperate,
    unlike the src="hook:*" lines, which did not.

    MIRRORING IS FAIL-OPEN. The queue and the decision log are load-bearing — a question that goes
    unrecorded can strand the owner. The timeline is derived. So when mirroring an existing act we
    swallow failures (loud=False); only an explicit `event` call reports them (loud=True).
    """
    args = ["bash", os.environ.get("LAB_LOG", ""), "--type", typ, "--src", "emit",
            "--actor", actor or os.environ.get("GOSLEEP_ACTOR") or "orchestrator",
            "--data-json", json.dumps(data, ensure_ascii=False)]
    if task:
        args += ["--task", task]
    if not loud:
        args += ["--quiet"]
    try:
        r = subprocess.run(args, capture_output=True, timeout=10)
        if loud and r.returncode != 0:
            die("lab-log failed: %s" % r.stderr.decode().strip())
        return r.stdout.decode().strip()
    except Exception as e:
        if loud:
            die("lab-log failed: %s" % e)
        return ""

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
            for k in ("answer", "answered_by", "channel", "applied", "applied_by"):
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
    """Manifest §2 default: +2h, clamped so no default ever applies before 10:00 LOCAL.

    The deadline is a moment the owner can plausibly SEE the question (morning digest at
    activeHours start + an hour of veto cushion) — so we clamp where the deadline LANDS, not
    when the question was posed. A DECISION raised at 23:30 would otherwise auto-apply at 01:30,
    inside the night window, hours before the digest that was supposed to show it.
    """
    d = datetime.now().astimezone() + timedelta(hours=2)
    if d.hour < 10:                       # lands in the night / pre-digest window
        d = d.replace(hour=10, minute=0, second=0, microsecond=0)
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
    # Typology guard (skill "Question buffer", classification rule 1; manifest §3): buffer-and-default
    # is LICENSED BY REVERSIBILITY. An irreversible fork is never decided by default — it is a BLOCKER.
    # This is the only mechanical backstop between a mis-typed question and an unattended irreversible act.
    if typ in ("DECISION", "CLARIFY"):
        if not a.get("default"):
            die("%s requires --default (a %s without a default is a BLOCKER)" % (typ, typ))
        rev = (a.get("reversibility") or "").strip().lower()
        if not rev:
            die("%s requires --reversibility high|med (typology, skill \"Question buffer\"); "
                "an irreversible fork is a BLOCKER" % typ)
        if rev not in REVERSIBILITY:
            die("--reversibility must be one of %s" % "|".join(REVERSIBILITY))
        if rev == "low":
            die("reversibility=low forces BLOCKER — an irreversible fork is never decided by default "
                "(skill \"Question buffer\" rule 1; manifest §3): reclassify as --type BLOCKER")
        a["reversibility"] = rev
    if typ == "BLOCKER" and a.get("default"):
        die("BLOCKER takes no --default (manifest §3: no default, ever); "
            "a fork WITH a defensible reversible default is a DECISION, reclassify it")
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
    dup, rec = None, None
    with QueueLock():
        records = read_records()
        h = qhash(task, question)
        for qid, m in fold(records).items():
            if m.get("status") == "open" and m.get("qhash") == h:
                append_record({"re": qid, "ts": iso_utc(), "seen_by": frm})
                print("DUPLICATE %s" % qid)
                dup = qid
                break
        if not dup:
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
    # Mirror into the timeline OUTSIDE the queue lock: lab-log takes its own lock, and holding two
    # is how a fast path becomes a deadlock. GSL-84 — a question is now an event, for free.
    if dup:
        emit_event("question.deduped", frm, {"id": dup, "qtype": typ}, task)
    else:
        emit_event("question.posed", frm,
                   {"id": rec["id"], "qtype": typ, "question": question,
                    "default": rec["default"], "reversibility": rec["reversibility"],
                    "auto_apply_at": rec["auto_apply_at"], "status": rec["status"]}, task)

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
    return a, state[qid]                 # for the caller's timeline mirror (outside the lock)

def cmd_answer(argv):
    a, m = _patch(argv,
                  {"--re": "re", "--answer": "answer", "--by": "by", "--channel": "channel"},
                  ("re", "answer"),
                  lambda a: {"re": a["re"], "ts": iso_utc(), "status": "answered",
                             "answer": a["answer"], "answered_by": a.get("by", "owner"),
                             "channel": a.get("channel", "terminal")},
                  "answered")
    emit_event("question.answered", a.get("by", "owner"),
               {"id": a["re"], "qtype": m.get("type", ""), "answer": a["answer"],
                "channel": a.get("channel", "terminal")}, m.get("task", ""))

def cmd_resolve(argv):
    # GSL-200 (audit finding 7, MAJOR): "auto-resolved" is RESERVED for a deadline nobody attended.
    # The audit measured 10 of 20 defaults applied BEFORE their deadline yet recorded as if the
    # timer had fired — a status that lies about whether the owner ever had a chance to veto.
    # So resolve now refuses two things it used to swallow:
    #   * closing before auto_apply_at  -> that act is an EARLY pick of the default; it is honest
    #     as `resolve --early` (status answered-by-default), never as auto-resolved;
    #   * closing an already-closed record -> a second closure rewrites history; corrections append
    #     via `answer`, closures happen once.
    a = parse_flags(argv, {"--re": "re", "--applied": "applied", "--early": "!early"})
    for r in ("re", "applied"):
        if not a.get(r):
            die("--%s is required" % r)
    now = iso_utc()
    with QueueLock():
        state = fold(read_records())
        qid = a["re"]
        m = state.get(qid)
        if not m:
            die("no record with id %s" % qid)
        if m.get("status") != "open":
            die("%s is already closed (status=%s) — a closed record is never closed again "
                "(append-only, C8); a correction is a new `answer` patch, not a second closure"
                % (qid, m.get("status")))
        if m.get("type") == "BLOCKER":
            die("%s is a BLOCKER — it has no default to apply (manifest section 3) and no timer; "
                "only the owner closes it, via `answer`" % qid)
        due = m.get("auto_apply_at") or ""
        if a.get("early"):
            if due and due <= now:
                die("deadline %s has already passed — drop --early and run plain resolve" % due)
            status = "answered-by-default"
        else:
            if due and due > now:
                die("deadline not reached (auto_apply_at=%s, now=%s) — auto-resolve is reserved "
                    "for a deadline that fired unattended;\n  an early pick of the default is "
                    "`resolve --early` (status answered-by-default),\n  the owner's own word is "
                    "`answer --re %s --answer ...`" % (due, now, qid))
            status = "auto-resolved"
        append_record({"re": qid, "ts": now, "status": status, "applied": a["applied"]})
        print("%s %s" % (status, qid))
    if status == "auto-resolved":
        # The deadline passed and the default was applied with nobody watching. If any event belongs
        # on the morning timeline, it is this one — the system having decided FOR the owner.
        emit_event("question.auto_resolved", "orchestrator",
                   {"id": qid, "qtype": m.get("type", ""), "applied": a["applied"],
                    "question": m.get("question", "")}, m.get("task", ""))
    else:
        emit_event("question.answered", "orchestrator",
                   {"id": qid, "qtype": m.get("type", ""), "answer": a["applied"],
                    "channel": "early-default"}, m.get("task", ""))

def cmd_apply_due(argv):
    # GSL-200: the executor of expired deadlines (audit finding 49: nothing ever applied them).
    # Idempotent by construction: a candidate is an OPEN DECISION whose auto_apply_at has passed;
    # applying it closes it, so the second run over the same queue finds zero candidates and
    # appends zero lines. This is the exact subcommand tick.sh (GSL-199) calls every tick — it must
    # be safe to run any number of times, from any carrier, with nobody watching.
    a = parse_flags(argv, {"--dry-run": "!dry_run", "--json": "!json"})
    now = iso_utc()
    applied = []
    with QueueLock():
        state = fold(read_records())
        for qid in sorted(state):
            m = state[qid]
            if m.get("status") != "open" or m.get("type") != "DECISION":
                continue
            due = m.get("auto_apply_at") or ""
            if not due or due > now:
                continue
            if not m.get("default"):
                # A DECISION without a default cannot exist through `question` validation, but the
                # queue is append-only history — guard against a legacy/hand-written record.
                print("lab-emit: warn: %s is due but carries no default — skipping" % qid,
                      file=sys.stderr)
                continue
            if not a.get("dry_run"):
                append_record({"re": qid, "ts": now, "status": "auto-resolved",
                               "applied": m["default"], "applied_by": "apply-due"})
            applied.append(m)
    verb = "WOULD-APPLY" if a.get("dry_run") else "APPLIED"
    for m in applied:
        if a.get("json"):
            print(json.dumps({"id": m["id"], "task": m.get("task", ""),
                              "default": m.get("default", ""),
                              "auto_apply_at": m.get("auto_apply_at", "")}, ensure_ascii=False))
        else:
            print("%s %s due=%s -> %s" % (verb, m["id"], m.get("auto_apply_at", ""),
                                          m.get("default", "")))
    if not a.get("dry_run"):
        for m in applied:
            emit_event("question.auto_resolved", "apply-due",
                       {"id": m["id"], "qtype": "DECISION", "applied": m.get("default", ""),
                        "question": m.get("question", "")}, m.get("task", ""))
    print("applied=%d" % len(applied))

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
        # lines= is the raw append-only line count: the HEARTBEAT_OK check-5 census (growth = new
        # records/patches to triage) and a cheap tamper/rollback check on an append-only file.
        lines = sum(1 for _ in open(QUEUE, encoding="utf-8")) if os.path.exists(QUEUE) else 0
        print("open=%d (%dB/%dD/%dC/%dF) lines=%d" % (len(opens), by["BLOCKER"], by["DECISION"],
                                                      by["CLARIFY"], by["FYI"], lines))
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
    emit_event("decision.made", by,
               {"id": rec["id"], "decision": rec["decision"], "question": question,
                "rule": rec["rule"], "re": rec["re"]}, task)

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

def cmd_event(argv):
    a = parse_flags(argv, {"--type": "type", "--actor": "actor", "--task": "task",
                           "--data": "data", "--data-json": "data_json"}, multi=("--data",))
    typ = a.get("type") or die("--type is required (one of: %s)" % " ".join(SEMANTIC_TYPES))
    if typ not in SEMANTIC_TYPES:
        # A typo'd type is an event nothing will ever read — silently useless. Better a loud error.
        die("unknown semantic type %r; must be one of:\n  %s" % (typ, "\n  ".join(SEMANTIC_TYPES)))
    data = {}
    if a.get("data_json"):
        try:
            data.update(json.loads(a["data_json"]))
        except ValueError as e:
            die("--data-json is not valid JSON: %s" % e)
    for kv in a.get("data", []):
        if "=" not in kv:
            die("--data expects k=v, got %r" % kv)
        k, v = kv.split("=", 1)
        data[k] = v
    print(emit_event(typ, a.get("actor", ""), data, a.get("task", ""), loud=True))

def cmd_help(argv):
    print("""lab-emit — the question queue, the decision log, and the semantic event layer.

  question   --type BLOCKER|DECISION|CLARIFY|FYI --question "..." [--from A] [--task KEY]
             [--default "..."] [--reversibility high|med] [--option "label|pros|cons"] ...
  answer     --re q-ID --answer "..." [--by owner|orchestrator] [--channel CH]
  resolve    --re q-ID --applied "..." [--early]
             refuses: a record before its deadline (early pick => --early, recorded as
             answered-by-default), an already-closed record, a BLOCKER (owner-only)
  apply-due  [--dry-run] [--json]     # apply defaults of every OPEN DECISION past its deadline;
             idempotent (2nd run applies 0); the tick (GSL-199) calls this every pass
  list       [--status open|all|...] [--type T] [--task KEY] [--due] [--json] [--count]
  decision   --decision "..." (--re q-ID | --question "...") [--rule "manifest §N"] [--by WHO]
  candidates [--min N] [--json]
  event      --type <semantic-type> [--actor A] [--task KEY] [--data k=v ...] [--data-json '{…}']
  help

Semantic types (event):
  %s

question/answer/resolve/decision also MIRROR themselves into docs/lab/events/ automatically
(src="emit"); the hooks in .claude/settings.json write the mechanical half (src="hook:*").""" %
          "\n  ".join(SEMANTIC_TYPES))

def main():
    if len(sys.argv) < 2:
        die("usage: lab-emit.sh question|answer|resolve|apply-due|list|decision|candidates|event|help ...")
    cmd, argv = sys.argv[1], sys.argv[2:]
    if cmd in ("-h", "--help"):
        cmd = "help"
    fn = {"question": cmd_question, "answer": cmd_answer,
          "resolve": cmd_resolve, "apply-due": cmd_apply_due, "list": cmd_list,
          "decision": cmd_decision, "candidates": cmd_candidates,
          "event": cmd_event, "help": cmd_help}.get(cmd)
    if not fn:
        die("unknown subcommand %r" % cmd)
    fn(argv)

main()
PY
