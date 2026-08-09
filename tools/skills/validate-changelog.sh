#!/usr/bin/env bash
# =============================================================================
# tools/skills/validate-changelog.sh — CHANGELOG.jsonl schema validator (T1, GSL-252).
#
# Walks `docs/skills/CHANGELOG.jsonl` line by line and validates each row against
# `tools/skills/schema/changelog.schema.json`. Prints one PASS/FAIL line per row
# scanned; exits 0 on all-pass (or empty file), non-zero on any failure.
#
# WHY BASH + PYTHON3. Python 3's `json` + a compact hand-rolled check is enough — we
# do not want an npm/pip dependency for a pre-publish gate that must run on a
# fresh clone. `jsonschema` would be a nicer library but is not on the standard
# path; the check here mirrors the schema semantics exactly and stays in sync
# with `changelog.schema.json` (patch the two together when the shape evolves).
#
# EXIT CODES:
#   0 — all rows valid (or file empty / missing) — silent for the empty case
#   1 — at least one row failed schema validation
#   2 — file exists but is unreadable, or python3 missing, or schema missing
#
# ENV:
#   CHANGELOG_PATH   override the JSONL path (default: repo-relative)
#   SCHEMA_PATH      override the schema path
#   VERBOSE=1        also print PASS lines (default: only FAIL lines print)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CHANGELOG_PATH="${CHANGELOG_PATH:-$REPO_ROOT/docs/skills/CHANGELOG.jsonl}"
SCHEMA_PATH="${SCHEMA_PATH:-$REPO_ROOT/tools/skills/schema/changelog.schema.json}"
VERBOSE="${VERBOSE:-0}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "validate-changelog: python3 not on PATH" >&2
  exit 2
fi

if [ ! -f "$SCHEMA_PATH" ]; then
  echo "validate-changelog: schema missing: $SCHEMA_PATH" >&2
  exit 2
fi

# Absent file is a valid empty registry — return 0 silently. This keeps the
# smoke wire-up happy on a fresh clone that hasn't populated the file yet.
if [ ! -f "$CHANGELOG_PATH" ]; then
  exit 0
fi

if [ ! -r "$CHANGELOG_PATH" ]; then
  echo "validate-changelog: cannot read $CHANGELOG_PATH" >&2
  exit 2
fi

# The row check is in Python — cleaner regex/enum semantics + one process for the
# whole file. `stdin` gets the JSONL contents; the script exits non-zero on any
# invalid row and prints a diagnostic per bad line.
python3 - "$CHANGELOG_PATH" "$SCHEMA_PATH" "$VERBOSE" <<'PY'
import json
import re
import sys
from pathlib import Path

changelog_path = Path(sys.argv[1])
schema_path = Path(sys.argv[2])
verbose = sys.argv[3] == "1"

try:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as e:
    print(f"validate-changelog: schema unreadable: {e}", file=sys.stderr)
    sys.exit(2)

required = set(schema.get("required", []))
props = schema.get("properties", {})
additional_properties = schema.get("additionalProperties", True)

skill_enum = set(props.get("skill", {}).get("enum", []))
status_enum = set(props.get("status", {}).get("enum", []))

ts_pattern = re.compile(props.get("ts", {}).get("pattern", ".*"))
task_pattern = re.compile(props.get("task", {}).get("pattern", ".*"))
commit_pattern = re.compile(props.get("commit", {}).get("pattern", ".*"))
intent_pattern = re.compile(r"^[\x21-\x7e]+$")

lesson_max = props.get("lesson", {}).get("maxLength", 10_000)

failures: list[str] = []
passed = 0
scanned = 0

with changelog_path.open("r", encoding="utf-8") as f:
    for idx, raw in enumerate(f, start=1):
        line = raw.strip()
        if not line:
            # Empty lines are tolerated; JSONL readers commonly skip them.
            continue
        scanned += 1
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            failures.append(f"row {idx}: invalid JSON — {e}")
            continue
        if not isinstance(row, dict):
            failures.append(f"row {idx}: top-level value must be an object, got {type(row).__name__}")
            continue

        # required fields
        missing = required - row.keys()
        if missing:
            failures.append(f"row {idx}: missing required field(s): {sorted(missing)}")
            continue

        # additionalProperties
        if additional_properties is False:
            extra = set(row.keys()) - set(props.keys())
            if extra:
                failures.append(f"row {idx}: unknown field(s): {sorted(extra)}")
                continue

        # per-field checks
        ts = row["ts"]
        if not isinstance(ts, str) or not ts_pattern.match(ts):
            failures.append(f"row {idx}: 'ts' must match ISO-8601 UTC (got {ts!r})")
            continue

        skill = row["skill"]
        if not isinstance(skill, str) or skill not in skill_enum:
            failures.append(
                f"row {idx}: 'skill' must be one of {sorted(skill_enum)} (got {skill!r})"
            )
            continue

        task = row["task"]
        if not isinstance(task, str) or not task_pattern.match(task):
            failures.append(f"row {idx}: 'task' must match /^GSL-\\d+$/ (got {task!r})")
            continue

        commit = row["commit"]
        if not isinstance(commit, str) or not commit_pattern.match(commit):
            failures.append(f"row {idx}: 'commit' must be a 40-char lowercase git SHA (got {commit!r})")
            continue

        lesson = row["lesson"]
        if not isinstance(lesson, str) or len(lesson) > lesson_max:
            failures.append(
                f"row {idx}: 'lesson' must be a string <= {lesson_max} chars (got {type(lesson).__name__} len={len(lesson) if isinstance(lesson, str) else '-'})"
            )
            continue

        status = row["status"]
        if not isinstance(status, str) or status not in status_enum:
            failures.append(
                f"row {idx}: 'status' must be one of {sorted(status_enum)} (got {status!r})"
            )
            continue

        # intent_id is optional; if present must be null or a printable ASCII string
        if "intent_id" in row:
            iid = row["intent_id"]
            if iid is None:
                pass
            elif isinstance(iid, str) and 1 <= len(iid) <= 128 and intent_pattern.match(iid):
                pass
            else:
                failures.append(
                    f"row {idx}: 'intent_id' must be null or a 1..128-char printable-ASCII string (got {iid!r})"
                )
                continue

        passed += 1
        if verbose:
            print(f"  PASS row {idx}: skill={skill} task={task} status={status}")

if failures:
    for msg in failures:
        print(f"  FAIL {msg}", file=sys.stderr)
    print(
        f"validate-changelog: {len(failures)} invalid row(s) in {changelog_path} (scanned {scanned}, passed {passed})",
        file=sys.stderr,
    )
    sys.exit(1)

if verbose:
    print(f"validate-changelog: OK — scanned {scanned}, passed {passed}")
sys.exit(0)
PY
