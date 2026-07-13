#!/usr/bin/env bash
# =============================================================================
# gosleep lab — lab-log: THE writer of the T1 event layer.
# (GSL-83; PRD Phase 4 R4.1 — hooks -> docs/lab/events/YYYY-MM-DD.jsonl, 0 tokens.)
#
# Two modes, one writer (single seq allocator, single lock, single envelope):
#
#   HOOK MODE (default; no args) — Claude Code pipes the hook JSON on stdin:
#       .claude/settings.json -> {"type":"command","command":".../lab-log.sh"}
#     The script normalizes the hook payload into the envelope and appends ONE line.
#     Mechanical: fires whether or not the model cooperates. That is the whole point (F4-S1).
#
#   DIRECT MODE (flags) — for the semantic layer (lab-emit, GSL-84) and poll-fill (GSL-87):
#       lab-log.sh --type cycle.started --actor impl-lab-1 --data k=v --data-json '{"a":1}'
#                  [--src emit|poll-fill] [--task GSL-83] [--quiet]
#                  [--ts <ISO>] [--supersedes <seq>|<YYYY-MM-DD>:<seq>]      <- GSL-89: backfill
#     Prints the allocated seq (unless --quiet).
#
# Envelope (docs/design/event-schema.md + 05 §3.2 — attribution fields from the hook input):
#   {ts, logged_at?, run_id, seq, actor, type, data, src, supersedes?,
#    session_id?, agent_id?, agent_type?, cwd?, task?}
#   src  = "hook:<HookEventName>" | "emit" | "poll-fill"  <- PROVENANCE. Lets any consumer prove
#          F4-S1 by filtering src=hook:* : those lines cost 0 tokens and needed no model cooperation.
#   run_id = $GOSLEEP_RUN_ID, else the UTC date (one orchestration run = one night = one daily file).
#
# Discipline (R4.3):
#   * append-only — one O_APPEND single-write() line per event; the file is NEVER rewritten.
#     Corrections are new records carrying {"supersedes": …}. No temp+rename here: temp+rename
#     is for the NON-append artifacts (status.json), an append log must not be rewritten at all.
#   * --ts back-dates the EVENT, never the FILE. The line still lands in TODAY's daily file — the one
#     the writer is currently appending to — and carries ts = when it HAPPENED, plus logged_at = when
#     we LEARNED it. Consumers sort the timeline by ts across every day file (the chronicler globs
#     events/*.jsonl), so a back-dated line takes its true place without anyone reopening a past day.
#     Appending into a past day's file would mutate a day that is already committed, and that
#     retention may already have pruned. The filename is a rotation unit; `ts` is the semantics.
#   * --supersedes names a (file, seq) coordinate, because seq is unique per FILE, not globally:
#     `42` = seq 42 in this event's OWN day file; `2026-07-12:42` = seq 42 in THAT day's file. A
#     cross-day correction written as a bare `42` would retire whichever innocent line happens to
#     hold seq 42 today. poll-fill reconciles last night's log this morning, so cross-day is the
#     normal case, not the exotic one — qualify it.
#   * daily rotation (UTC) keeps any consumer read cheap.
#   * bounded — GOSLEEP_LAB_MAX_LINES (default 50000) guards a runaway hook loop. At the cap the
#     script appends ONE lab.capped marker and then drops, counting drops in scratch/ — a lying
#     event log is worse than a missing one, so the drop is always visible, never silent.
#
# FAIL-OPEN, ALWAYS: a hook must never break a session. Every failure path exits 0 and leaves a
# line in $GOSLEEP_LAB_ERRLOG (default .artifacts/lab/lab-log.err, gitignored).
#
# Env: GOSLEEP_LAB_DIR (default <repo>/docs/lab) · GOSLEEP_RUN_ID · GOSLEEP_ACTOR
#      GOSLEEP_LAB_MAX_LINES · GOSLEEP_LAB_ERRLOG
#      GOSLEEP_HEAD_MAX_AGE_S (default 15) — how fresh HEAD must be for a quiet commit to claim it
#      (see git_head: the hook fires on the command, not on its success). Widen it only if a slow
#      post-commit step delays the hook; a sha withheld is a gap poll-fill fills, a sha guessed is a lie.
# 0 LLM calls (C1). python3 stdlib only (JSON safety). macOS/BSD userland.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export LAB_DIR="${GOSLEEP_LAB_DIR:-$REPO_ROOT/docs/lab}"
export ERRLOG="${GOSLEEP_LAB_ERRLOG:-$REPO_ROOT/.artifacts/lab/lab-log.err}"

# NOTE — why `python3 -c "$SRC"` and not lab-emit's `exec python3 - <<'PY'` idiom:
# `python3 -` reads the PROGRAM from stdin, so a heredoc there IS stdin — and the hook payload,
# which Claude Code pipes in on stdin, would be gone before the program ever ran. The failure is
# silent (empty stdin -> clean exit 0 -> no error, no event, forever). lab-emit gets away with the
# heredoc because it only ever reads argv. Here the heredoc is captured in a subshell instead, so
# the real stdin reaches python untouched. Do not "simplify" this back.
LAB_LOG_SRC=$(cat <<'PY'
import sys, os, json, time, re, shlex, subprocess
from datetime import datetime, timezone

LAB     = os.environ["LAB_DIR"]
ERRLOG  = os.environ["ERRLOG"]
EVDIR   = os.path.join(LAB, "events")
LOCK    = os.path.join(EVDIR, ".events.lock")
SCRATCH = os.path.join(LAB, "scratch")
MAXLINES = int(os.environ.get("GOSLEEP_LAB_MAX_LINES", "50000") or 50000)
MAX_STR  = 500          # per-field clamp: one event line stays small (append atomicity + cheap reads)


def iso_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def utc_date():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def note_err(msg):
    """Fail-open: never raise out of a hook. Leave a trace instead of dying."""
    try:
        os.makedirs(os.path.dirname(ERRLOG), exist_ok=True)
        with open(ERRLOG, "a", encoding="utf-8") as f:
            f.write("%s lab-log: %s\n" % (iso_utc(), msg))
    except Exception:
        pass


class DirLock:
    """mkdir-based exclusive lock (portable; macOS ships no flock(1)). Steals stale (>30s) locks.

    Held only around read-last-seq + append: hooks are latency-sensitive, so the critical
    section is two syscalls wide.
    """
    def __enter__(self):
        for _ in range(100):
            try:
                os.makedirs(EVDIR, exist_ok=True)
                os.mkdir(LOCK)
                return self
            except FileExistsError:
                try:
                    if time.time() - os.stat(LOCK).st_mtime > 30:
                        os.rmdir(LOCK)
                        continue
                except FileNotFoundError:
                    continue
                time.sleep(0.02)
        raise RuntimeError("could not acquire lock %s" % LOCK)

    def __exit__(self, *a):
        try:
            os.rmdir(LOCK)
        except FileNotFoundError:
            pass


def clamp(v):
    """Keep one event line small and JSON-safe. Long tool output is a summary, not an archive."""
    if isinstance(v, str):
        v = " ".join(v.split())
        return v[:MAX_STR] + ("…" if len(v) > MAX_STR else "")
    if isinstance(v, dict):
        return {k: clamp(x) for k, x in list(v.items())[:20]}
    if isinstance(v, list):
        return [clamp(x) for x in v[:10]]
    return v


# ── backfill: saying WHEN it happened, and WHICH line it retires (GSL-89) ───────────────────
#
# Both flags exist for one reader: poll-fill. It reconciles last night's log this morning, so it
# always speaks about the past — about facts nobody was watching. Until now it could only stamp
# ts = now and bury the real time in data.occurred_at, which put every recovered commit on TODAY's
# timeline. These two flags let a correction say the two things it actually knows: when the fact
# happened, and which earlier line it replaces.

ISO_OFFSET = re.compile(r"([+-]\d{2})(\d{2})$")      # +0300 -> +03:00 (py3.9 fromisoformat is strict)
SUPERSEDES = re.compile(r"^(\d{4}-\d{2}-\d{2}):(\d+)$")


def parse_ts(s):
    """--ts: the event happened THEN, not now.

    Accepts what the real sources actually emit — `…Z` (git, gh), `…+03:00` / `…+0300` (Jira),
    fractional seconds — and normalizes to UTC at second resolution. Normalizing is not tidiness:
    consumers sort the timeline LEXICALLY on ts, so a single line left carrying a +03:00 offset would
    sort three hours away from where it belongs. A backfill that lands in the wrong place is exactly
    the bug this flag exists to fix.
    """
    t = (s or "").strip()
    if t[-1:] in ("Z", "z"):
        t = t[:-1] + "+00:00"
    t = ISO_OFFSET.sub(r"\1:\2", t)
    try:
        dt = datetime.fromisoformat(t)
    except ValueError:
        raise SystemExit("lab-log: --ts %r is not ISO-8601 (want e.g. 2026-07-12T18:20:18Z)" % s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)         # naive means UTC: this whole layer is UTC
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_supersedes(s):
    """--supersedes: this line RETIRES an earlier one. Append-only means a correction is a new
    record naming the record it replaces — never an edit of it (R4.3, C8).

    `seq` is unique per FILE, so a reference must carry the file when it crosses a day:
        42             seq 42 in this event's own day file (same-day correction)
        2026-07-12:42  seq 42 in that day's file (the cross-day case — poll-fill's normal case)
    """
    t = (s or "").strip()
    m = SUPERSEDES.match(t)
    if m:
        return "%s:%d" % (m.group(1), int(m.group(2)))
    if t.isdigit():
        return int(t)
    raise SystemExit("lab-log: --supersedes %r must be <seq> or <YYYY-MM-DD>:<seq>" % s)


def last_seq(path):
    """O(1)-ish: read the tail, take the last complete line, trust its seq. Self-healing —
    no sidecar counter to drift out of sync with the file."""
    try:
        size = os.path.getsize(path)
    except OSError:
        return 0
    if not size:
        return 0
    with open(path, "rb") as f:
        f.seek(max(0, size - 8192))
        tail = f.read().decode("utf-8", "replace").strip().split("\n")
    for line in reversed(tail):
        line = line.strip()
        if not line:
            continue
        try:
            s = json.loads(line).get("seq")
            if isinstance(s, int):
                return s
        except ValueError:
            continue
    # Tail unparsable (truncated/corrupt): fall back to a line count — seq stays monotonic.
    try:
        with open(path, encoding="utf-8") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def bump_dropped(day):
    """Cap reached: count the drop where it cannot lie — a gitignored scratch counter the
    chronicler surfaces. Silent loss is the one failure mode this layer must not have."""
    try:
        os.makedirs(SCRATCH, exist_ok=True)
        p = os.path.join(SCRATCH, "events-dropped-%s.count" % day)
        n = 0
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                n = int((f.read().strip() or "0"))
        with open(p, "w", encoding="utf-8") as f:
            f.write("%d\n" % (n + 1))
    except Exception:
        pass


def emit(ev):
    """Allocate seq + append exactly one line. The ONLY place that writes events/*.jsonl."""
    day = utc_date()
    path = os.path.join(EVDIR, "%s.jsonl" % day)
    with DirLock():
        n = last_seq(path)
        if n >= MAXLINES:
            bump_dropped(day)
            return None
        if n == MAXLINES - 1:                      # last usable line -> spend it on the truth
            ev = {"type": "lab.capped", "actor": "lab-log", "src": "lab-log",
                  "data": {"cap": MAXLINES, "note": "cap reached; further events dropped, "
                                                    "counted in scratch/events-dropped-%s.count" % day}}
        ev["seq"] = n + 1
        line = json.dumps(ev, ensure_ascii=False, sort_keys=False) + "\n"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
        try:
            os.write(fd, line.encode("utf-8"))     # single write() under O_APPEND == atomic append
        finally:
            os.close(fd)
        return ev["seq"]


def envelope(typ, actor, data, src, task="", extra=None, ts="", supersedes=None):
    now = iso_utc()
    ev = {"ts": ts or now}
    if ts and ts != now:
        # --ts moved `ts` to WHEN IT HAPPENED, so keep WHEN WE LEARNED IT here. The gap between the
        # two IS the measurement of how blind the hooks were that night, and this is the only place
        # it survives — collapse them and the log can no longer tell observation from hindsight.
        ev["logged_at"] = now
    ev.update({"run_id": os.environ.get("GOSLEEP_RUN_ID") or utc_date(),
               "seq": 0,                            # replaced under the lock in emit()
               "actor": actor or "unknown",
               "type": typ,
               "src": src,
               "data": clamp(data or {})})
    if supersedes is not None:
        ev["supersedes"] = supersedes
    if task:
        ev["task"] = task
    for k, v in (extra or {}).items():             # attribution: session_id/agent_id/agent_type/cwd
        if v:
            ev[k] = clamp(v)
    return ev


# ── HOOK MODE — the map from Claude Code hook events to the event schema ────────────────────
#
# The script knows the FULL map (05 §3.2). `.claude/settings.json` wires only the hooks this
# Claude Code version actually fires — verified by a real run, never by trusting the docs.
# A hook that lands here but is not wired simply never arrives; a hook that arrives and is not
# in the map is logged as hook.unmapped rather than dropped, so a new CC event shows up as a
# visible unknown instead of vanishing.

VERBS = (
    ("git commit",        "vcs.commit"),
    ("git push",          "vcs.push"),
    ("gh pr create",      "vcs.pr.opened"),
    ("gh pr merge",       "vcs.pr.merged"),
    ("gh issue create",   "tracker.issue.created"),
)


GIT_GLOBAL_WITH_VALUE = ("-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path")
OPERATORS = ("&&", "||", ";", "|", "&")
HEREDOC = re.compile(r"<<-?\s*[\"']?(\w+)[\"']?")


def strip_heredocs(cmd):
    """Delete heredoc BODIES before looking for commands.

    A heredoc body is DATA, not script. This mattered on day one: a Bash call carrying a python
    payload that merely contained the text `cd /repo && git commit -m ...` was logged as a real
    commit. The words were in a string inside a heredoc; nothing was committed. The event was a lie.
    """
    out, lines, i = [], cmd.split("\n"), 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = HEREDOC.search(line)
        i += 1
        if m:                                       # skip to the closing delimiter
            delim = m.group(1)
            while i < len(lines) and lines[i].strip() != delim:
                i += 1
            i += 1                                  # drop the delimiter line too
    return "\n".join(out)


def sub_commands(cmd):
    """Split a Bash command into real sub-commands: heredoc bodies removed, then per line, then on
    UNQUOTED operators only. shlex is what makes `echo "a && git commit b"` stay one harmless token
    instead of becoming a phantom commit."""
    segs = []
    for line in strip_heredocs(cmd).split("\n"):
        line = line.split("#", 1)[0] if line.strip().startswith("#") else line
        if not line.strip():
            continue
        try:
            toks = shlex.split(line, comments=False, posix=True)
        except ValueError:
            continue                                # unbalanced quotes: we cannot know -> log nothing
        cur = []
        for t in toks:
            if t in OPERATORS:
                if cur:
                    segs.append(cur)
                cur = []
            else:
                cur.append(t)
        if cur:
            segs.append(cur)
    return segs


def verb_of(toks):
    """Reduce one sub-command to its canonical verb: 'git -C /x --no-pager commit -m y' -> 'git commit'.

    Real Claude Code writes `git -C <path> commit`, not `git commit` (found by a live headless run,
    2026-07-12 — the naive prefix match missed a commit that had actually happened). Global options
    sit BETWEEN the binary and the subcommand, so they must be stepped over, not merely tolerated.
    (Prose here deliberately avoids the literal headless-invocation flag: tools/lab/smoke.sh greps
    this file for it to enforce C1 — the 0-token layer must never call a model, even in a comment.)
    """
    toks = [t.lower() for t in toks]
    while toks and (toks[0] == "sudo" or ("=" in toks[0] and not toks[0].startswith("="))):
        toks = toks[1:]                             # FOO=bar / sudo prefixes sit before the binary
    if not toks:
        return ""
    if toks[0] == "git":
        i = 1
        while i < len(toks) and toks[i].startswith("-"):
            if toks[i] in GIT_GLOBAL_WITH_VALUE:        # takes a separate value token
                i += 2
            else:                                       # --no-pager, --git-dir=/x, -P ...
                i += 1
        return "git %s" % toks[i] if i < len(toks) else "git"
    if toks[0] == "gh":
        words = [t for t in toks[1:] if not t.startswith("-")][:2]   # gh pr create / gh issue create
        return ("gh %s" % " ".join(words)).strip()
    return ""


def bash_event(cmd, resp, cwd):
    """Argument-level routing lives HERE, not in settings.json: a `matcher` filters on the tool NAME
    only, so "a commit, not just any Bash" is this script's call to make.

    Route on the VERB of each SUB-command, never on a substring of the whole line. Learned from a
    real event (2026-07-12): a Bash call whose body merely *contained* the words `gh pr create` —
    inside a quoted python payload in a heredoc — got logged as a PR being opened. A timeline with
    phantom commits in it is worse than no timeline: the command must BE the verb, not mention it.
    """
    for seg in sub_commands(cmd):
        v = verb_of(seg)
        for verb, typ in VERBS:
            if v == verb:
                data = {"cmd": " ".join(cmd.split())[:MAX_STR]}
                if typ == "vcs.commit":
                    data["sha"] = commit_sha(resp) or git_head(seg, cwd)
                else:
                    data["out"] = str(resp)
                return typ, data
    return None, None                              # every other Bash call: NOT an event (volume)


COMMIT_ECHO = re.compile(r"\[[^\]\n]*[ \t]([0-9a-f]{7,40})\]")   # `[<branch> <sha>] subject`
SHORT_M     = re.compile(r"^-[a-zA-Z]*?m(.*)$")                  # -m / -am / -mMSG / -amMSG
HEAD_MAX_AGE_S = int(os.environ.get("GOSLEEP_HEAD_MAX_AGE_S", "15") or 15)


def commit_sha(resp):
    """`[branch 1a2b3c4] subject` — git's own echo of the commit it just made.

    Anchored on the BRACKET, not on "the first token that looks hex": a branch name can be all-hex
    too, and it is printed FIRST. `[deadbee 1a2b3c4] subject` used to return `deadbee` — the branch.
    The sha is the LAST token inside the brackets, after the branch and after any `(root-commit)`.
    """
    m = COMMIT_ECHO.search(str(resp))
    return m.group(1) if m else ""


def commit_subject(toks):
    """The subject this command ASKED git for: `-m x`, `-mx`, `-am x`, `--message x`, `--message=x`.
    Empty when the message comes from anywhere else (editor, `-F`, `--amend --no-edit`)."""
    for i, t in enumerate(toks):
        if t.startswith("--message="):
            val = t.split("=", 1)[1]
        elif t == "--message":
            val = toks[i + 1] if i + 1 < len(toks) else ""
        else:
            m = SHORT_M.match(t)
            if not m:
                continue
            val = m.group(1) or (toks[i + 1] if i + 1 < len(toks) else "")
        return val.strip().split("\n")[0].strip()   # git's SUBJECT is the first line of the message
    return ""


def git_head(toks, cwd):
    """Fallback for a QUIET commit: `git commit -q` prints nothing, so there is no echo to parse and
    the event would carry an empty sha — a commit line in the timeline that points nowhere. Ask git.

    (Found by dogfooding: the very commit that introduced this file was made with -q and logged
    itself with sha="". The layer's first real event about its own birth was already half a lie.)

    But the hook fires on the COMMAND, not on its SUCCESS — and a `git commit` that FAILS (nothing
    staged, rejected by a hook, empty message) is routine in a fleet. HEAD has not moved, so a naive
    fallback hands the event the PREVIOUS commit's sha: a real, reachable sha bound to a commit that
    never happened. That is the worst line this layer can write, because every downstream guard then
    believes it — poll-fill's sha-less refusal never sees it, its dedup key collides with the real
    commit's, and an append-only log can only supersede such a line, never take it back.

    So HEAD must earn the sha twice (REVIEW-gsl81 C1):
      * FRESH  — its committer time is seconds old, not this morning's;
      * ITS OWN — its subject is the `-m` message this very command asked for.
    Fail either and we return "" — an inert sha-less line, which poll-fill already refuses to bind
    and backfills correctly under its own key. On doubt say nothing: a gap is repairable, a lie is not.
    """
    d = cwd or "."
    for i, t in enumerate(toks):                    # honour `git -C <path>` (NOT -c, that is config)
        if t == "-C" and i + 1 < len(toks):
            d = toks[i + 1]
            break
    try:                                            # NUL-separated: a subject may contain anything
        out = subprocess.run(["git", "-C", d, "log", "-1", "--format=%h%x00%ct%x00%s"],
                             capture_output=True, timeout=3)
        sha, ct, subject = out.stdout.decode("utf-8", "replace").strip().split("\0", 2)
        if not sha or time.time() - int(ct) > HEAD_MAX_AGE_S:
            return ""                               # HEAD predates the command -> it committed nothing
        asked = commit_subject(toks)
        if asked and subject.strip() != asked:
            return ""                               # HEAD is some other commit, not the one asked for
        return sha
    except Exception:                               # no commits yet / not a repo / git absent
        return ""


def file_event(path):
    p = path.replace("\\", "/")
    if "/docs/handoff/" in p and p.endswith(".md") and not os.path.basename(p).startswith("."):
        return "handoff.written", {"path": p}
    if "/docs/dev_history/" in p and p.endswith(".md"):
        return "dev_history.written", {"path": p}
    return None, None


def map_hook(h):
    """-> (type, data) or (None, None) to drop."""
    name = h.get("hook_event_name", "")
    ti   = h.get("tool_input") or {}
    tr   = h.get("tool_response")

    if name == "PostToolUse":
        tool = h.get("tool_name", "")
        if tool == "Bash":
            return bash_event(ti.get("command", ""), tr, h.get("cwd", ""))
        if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
            return file_event(ti.get("file_path", ""))
        if tool.startswith("mcp__atlassian__"):
            if "transitionJiraIssue" in tool:
                return "tracker.issue.transitioned", {"tool": tool, "key": ti.get("issueIdOrKey", ""),
                                                      "transition": ti.get("transitionId", "")}
            if "createJiraIssue" in tool:
                return "tracker.issue.created", {"tool": tool, "summary": ti.get("summary", ""),
                                                 "type": ti.get("issueTypeName", ""),
                                                 "parent": ti.get("parentKey", ""), "tracker": "jira"}
            if "editJiraIssue" in tool or "addCommentToJiraIssue" in tool:
                return "tracker.issue.updated", {"tool": tool, "key": ti.get("issueIdOrKey", "")}
            return None, None
        return None, None

    # Lifecycle / health / failure hooks.
    # Field names: the docs pin `source` (SessionStart), `stop_hook_active` (Stop), `error_type`
    # (StopFailure), `notification_type` (Notification), `agent_id`/`agent_type` (Subagent*) — but are
    # SILENT on the exact key for SessionEnd's reason and PreCompact's trigger, and on the TaskCreated/
    # TaskCompleted payload entirely. So for those we `pick()` across the plausible aliases and, when
    # none hit, keep the whole payload under `raw`: an event with an unexpected shape must still carry
    # its evidence, not shrug. `hook-trace.jsonl` (GOSLEEP_LAB_TRACE=1) is how you learn the real shape.
    def pick(*keys):
        for k in keys:
            if h.get(k):
                return h[k]
        return ""

    def rest():
        skip = ("session_id", "transcript_path", "cwd", "hook_event_name", "permission_mode",
                "prompt_id", "effort", "agent_id", "agent_type")
        return {k: v for k, v in h.items() if k not in skip}

    return {
        "SessionStart":      lambda: ("pane.started",   {"source": pick("source")}),
        "SessionEnd":        lambda: ("pane.ended",     {"reason": pick("reason", "source"),
                                                         "raw": rest()}),
        "SubagentStart":     lambda: ("agent.spawned",  {"agent_type": h.get("agent_type", ""),
                                                         "description": pick("description", "prompt")}),
        "SubagentStop":      lambda: ("agent.terminated", {"agent_type": h.get("agent_type", "")}),
        "TeammateIdle":      lambda: ("agent.idle",     {"agent_type": h.get("agent_type", "")}),
        "Stop":              lambda: ("agent.turn_ended", {"stop_hook_active": h.get("stop_hook_active", False)}),
        # StopFailure is the quota-window detector Phase 2 wants for free (05 §3.2): error_type is
        # rate_limit|overloaded|server_error|billing_error|... — the model never has to notice it.
        "StopFailure":       lambda: ("api.failure",    {"error_type": pick("error_type", "reason", "error"),
                                                         "raw": rest()}),
        "PreCompact":        lambda: ("context.pre_compact",  {"trigger": pick("trigger", "reason", "matcher")}),
        "PostCompact":       lambda: ("context.post_compact", {"trigger": pick("trigger", "reason", "matcher")}),
        "Notification":      lambda: ("notification.raised",  {"notification_type": pick("notification_type"),
                                                               "message": pick("message")}),
        "PermissionRequest": lambda: ("permission.requested", {"tool": h.get("tool_name", "")}),
        "PermissionDenied":  lambda: ("permission.denied",    {"tool": h.get("tool_name", "")}),
        "TaskCreated":       lambda: ("task.created",   {"task": pick("task", "description", "subject"),
                                                         "raw": rest()}),
        "TaskCompleted":     lambda: ("task.completed", {"task": pick("task", "description", "subject"),
                                                         "raw": rest()}),
    }.get(name, lambda: ("hook.unmapped", {"hook": name, "raw": rest()}))()


def trace(h):
    """GOSLEEP_LAB_TRACE=1 -> dump the RAW hook payload to scratch/ before mapping.

    This is the answer to the one question a hook layer cannot afford to guess: *did it fire at all?*
    A dropped event and a hook that never ran look identical in events.jsonl — they differ here.
    It is also how you learn the undocumented stdin shapes (SessionEnd, TaskCreated, PreCompact).
    """
    try:
        os.makedirs(SCRATCH, exist_ok=True)
        with open(os.path.join(SCRATCH, "hook-trace.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": iso_utc(), "hook": h.get("hook_event_name", "?"), "raw": h},
                               ensure_ascii=False) + "\n")
    except Exception:
        pass


def hook_mode():
    raw = sys.stdin.read()
    if not raw.strip():
        return
    h = json.loads(raw)
    if os.environ.get("GOSLEEP_LAB_TRACE"):
        trace(h)
    typ, data = map_hook(h)
    if not typ:
        return                                      # deliberately not an event (e.g. a plain `ls`)
    actor = (os.environ.get("GOSLEEP_ACTOR")
             or h.get("agent_id") or h.get("agent_type") or (h.get("session_id") or "")[:8] or "session")
    emit(envelope(typ, actor, data, "hook:%s" % h.get("hook_event_name", "?"),
                  extra={"session_id": h.get("session_id", ""),
                         "agent_id": h.get("agent_id", ""),
                         "agent_type": h.get("agent_type", ""),
                         "cwd": h.get("cwd", "")}))


def direct_mode(argv):
    spec = {"--type": "type", "--actor": "actor", "--data": "data", "--data-json": "data_json",
            "--src": "src", "--task": "task", "--ts": "ts", "--supersedes": "supersedes",
            "--quiet": "!quiet"}
    a, i = {}, 0
    while i < len(argv):
        f = argv[i]
        if f not in spec:
            raise SystemExit("lab-log: unknown flag %r" % f)
        k = spec[f]
        if k.startswith("!"):
            a[k[1:]] = True
            i += 1
            continue
        if i + 1 >= len(argv):
            raise SystemExit("lab-log: %s needs a value" % f)
        if f == "--data":
            a.setdefault("data", []).append(argv[i + 1])
        else:
            a[k] = argv[i + 1]
        i += 2
    typ = a.get("type") or sys.exit("lab-log: --type is required")
    data = {}
    if a.get("data_json"):
        data.update(json.loads(a["data_json"]))
    for kv in a.get("data", []):
        if "=" not in kv:
            raise SystemExit("lab-log: --data expects k=v, got %r" % kv)
        k, v = kv.split("=", 1)
        data[k] = v
    seq = emit(envelope(typ, a.get("actor") or os.environ.get("GOSLEEP_ACTOR", ""), data,
                        a.get("src", "emit"), a.get("task", ""),
                        ts=parse_ts(a["ts"]) if a.get("ts") else "",
                        supersedes=parse_supersedes(a["supersedes"]) if a.get("supersedes") else None))
    if not a.get("quiet"):
        print("dropped (cap)" if seq is None else seq)


try:
    if len(sys.argv) > 1:
        direct_mode(sys.argv[1:])
    else:
        hook_mode()
except SystemExit:
    raise                                           # direct-mode usage errors are real errors
except Exception as e:
    note_err("%s: %s" % (type(e).__name__, e))      # hook mode never breaks the session
sys.exit(0)
PY
)
exec python3 -c "$LAB_LOG_SRC" "$@"
