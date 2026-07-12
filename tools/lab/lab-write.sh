#!/usr/bin/env bash
# =============================================================================
# gosleep lab — lab-write: the atomic writer for NON-append artifacts.
# (GSL-85; PRD Phase 4 R4.3 — "atomic temp+rename для не-append".)
#
# The laboratory has exactly two write disciplines, and each has exactly one tool:
#   * APPEND-ONLY  (events.jsonl, queue.jsonl, log.jsonl)  -> tools/lab/lab-log.sh / lab-emit.sh
#   * WHOLE-FILE   (status.json, site/*.html, digest/*.md) -> THIS script
# Anything else — a bare `>` redirect, a python open(…,"w") — is a torn file waiting to happen.
#
# Why it matters here specifically: the chronicler (GSL-86) rewrites status.json and the dashboard
# on every pass, and it runs under a hard budget cap, which means it CAN be killed mid-write. A
# reader that lands on a half-written status.json sees a dashboard that is not stale but CORRUPT —
# and per F4-S3 a dead laboratory must merely look dead, never take delivery down with it.
#
# Guarantee: readers see either the ENTIRE old file or the ENTIRE new one. Never a prefix.
#   same-dir hidden temp -> write -> flush -> fsync -> atomic rename(2) over the target.
# (Same-dir matters: rename(2) is only atomic within one filesystem.)
#
# Usage:
#   … | lab-write.sh docs/lab/status.json          # content on stdin
#   lab-write.sh --json docs/lab/status.json       # …and validate it parses before it lands
#
# Env: GOSLEEP_LAB_ERRLOG (default .artifacts/lab/lab-log.err)
# 0 LLM calls (C1). python3 stdlib only.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export ERRLOG="${GOSLEEP_LAB_ERRLOG:-$REPO_ROOT/.artifacts/lab/lab-log.err}"

LAB_WRITE_SRC=$(cat <<'PY'
import sys, os, json, time, tempfile

argv = sys.argv[1:]
want_json = "--json" in argv
argv = [a for a in argv if a != "--json"]
if len(argv) != 1:
    sys.exit("lab-write: usage: <content on stdin> | lab-write.sh [--json] <target-path>")

target = os.path.abspath(argv[0])
data = sys.stdin.read()

if want_json:
    try:
        json.loads(data)
    except ValueError as e:
        # Refuse to publish garbage. A corrupt status.json is worse than a stale one: stale is
        # honest (it carries generated_at), corrupt just breaks every consumer downstream.
        sys.exit("lab-write: refusing to write invalid JSON to %s: %s" % (target, e))

d = os.path.dirname(target) or "."
os.makedirs(d, exist_ok=True)

# Sweep the previous crash's litter. `kill -9` gives the writer no chance to clean up, so a killed
# chronicler leaves a hidden temp beside its target — and only scratch/ is gitignored, so that junk
# would show up in `git status` forever. The chronicler runs on every cycle boundary, so each run
# clears the last one's. The 60s age guard means a live concurrent write is never touched.
prefix = ".%s." % os.path.basename(target)
for name in os.listdir(d):
    if name.startswith(prefix) and name.endswith(".tmp"):
        stale = os.path.join(d, name)
        try:
            if time.time() - os.path.getmtime(stale) > 60:
                os.unlink(stale)
        except OSError:
            pass

fd, tmp = tempfile.mkstemp(dir=d, prefix=prefix, suffix=".tmp")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())          # durable BEFORE it is visible — a rename of unflushed bytes
                                      # can survive a crash as an empty file on some filesystems
    os.replace(tmp, target)           # atomic within the filesystem; readers never see a prefix
except Exception:
    try:
        os.unlink(tmp)                # never leave a half-written temp behind
    except OSError:
        pass
    raise
PY
)
exec python3 -c "$LAB_WRITE_SRC" "$@"
