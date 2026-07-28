#!/usr/bin/env bash
# =============================================================================
# gosleep — tick-preflight-report: the morning-after verdict table (GSL-201).
#
# Reads docs/lab/supervision/tick-ledger.jsonl and answers, PER CARRIER, the three questions the
# owner's question 5 needs answered after the preflight night (d-2026-07-28-003: preflight BOTH
# carriers on one real night; the primary becomes whichever actually ticked):
#
#   1. did it tick at all, and how often (count, first, last, cadence)?
#   2. did it tick DURING THE NIGHT WINDOW (default 03:00-06:00 local — the interval the whole
#      system is named after, and the hours the audit found empty: 18 events in 7 days)?
#   3. what happened after the machine woke: the longest silence and the first tick that ended
#      it (launchd promises nothing here; Desktop promises a catch-up run — this row is the test)?
#
# The table is addressed to the owner (d-2026-07-28-006: Russian for owner-facing output).
# Reading is all this does: no writes, no locks, no LLM. Usage:
#   tools/lab/tick-preflight-report.sh [--hours 24] [--night 03-06] [--ledger PATH] [--json]
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export PFR_LEDGER="${GOSLEEP_TICK_LEDGER:-$ROOT/docs/lab/supervision/tick-ledger.jsonl}"

exec python3 - "$@" <<'PY'
import json, os, sys
from datetime import datetime, timedelta, timezone

hours, night, as_json = 24.0, "03-06", False
ledger = os.environ["PFR_LEDGER"]
argv = sys.argv[1:]
i = 0
while i < len(argv):
    f = argv[i]
    if f == "--hours":  i += 1; hours = float(argv[i])
    elif f == "--night": i += 1; night = argv[i]
    elif f == "--ledger": i += 1; ledger = argv[i]
    elif f == "--json": as_json = True
    else: sys.exit("tick-preflight-report: unknown flag %r" % f)
    i += 1

try:
    n0, n1 = [int(x) for x in night.split("-", 1)]
except ValueError:
    sys.exit("--night expects HH-HH, e.g. 03-06")

if not os.path.exists(ledger):
    print("Леджер не найден: %s — тик ещё ни разу не бегал." % ledger)
    sys.exit(0)

now = datetime.now(timezone.utc)
since = now - timedelta(hours=hours)
rows = []
with open(ledger, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
            ts = datetime.strptime(r["ts"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if ts >= since:
            rows.append((ts, r))

by = {}
for ts, r in rows:
    by.setdefault(r.get("carrier", "?"), []).append((ts, r))

def local(ts):
    return ts.astimezone()  # the machine's local zone — the owner's night, not UTC's

def fmt(ts):
    return local(ts).strftime("%H:%M")

out = []
for carrier in sorted(by):
    seq = sorted(by[carrier])
    tss = [t for t, _ in seq]
    night_ticks = [t for t in tss if n0 <= local(t).hour < n1]
    gaps = [(tss[k + 1] - tss[k]).total_seconds() for k in range(len(tss) - 1)]
    max_gap = max(gaps) if gaps else 0.0
    if gaps:
        k = gaps.index(max_gap)
        wake_first = tss[k + 1]
    else:
        wake_first = None
    idle = sum(1 for _, r in seq if r.get("result") == "idle")
    errors = sum(1 for _, r in seq if str(r.get("result", "")).startswith("error"))
    out.append({
        "carrier": carrier,
        "ticks": len(seq),
        "first": seq[0][0].strftime("%Y-%m-%dT%H:%M:%SZ"),
        "last": seq[-1][0].strftime("%Y-%m-%dT%H:%M:%SZ"),
        "night_ticks": len(night_ticks),
        "ticked_at_night": bool(night_ticks),
        "max_gap_min": round(max_gap / 60, 1),
        "first_tick_after_longest_gap": wake_first.strftime("%Y-%m-%dT%H:%M:%SZ") if wake_first else None,
        "idle_runs": idle, "errors": errors,
    })

if as_json:
    print(json.dumps({"window_hours": hours, "night_local": night, "carriers": out},
                     ensure_ascii=False, indent=2))
    sys.exit(0)

print("Преflight носителей тика — окно: последние %g ч, ночь: %02d:00–%02d:00 локального"
      % (hours, n0, n1))
if not out:
    print("  (в окне нет ни одной строки леджера — ни один носитель не тикал)")
    sys.exit(0)
hdr = "%-22s %6s %13s %11s %11s %9s %7s %7s" % (
    "носитель", "тиков", "ночью(%02d–%02d)" % (n0, n1), "первый", "последний",
    "макс.пауза", "idle", "ошибок")
print(hdr)
print("-" * len(hdr))
for r in out:
    print("%-22s %6d %13s %11s %11s %8.0fм %7d %7d" % (
        r["carrier"], r["ticks"],
        ("ДА ×%d" % r["night_ticks"]) if r["ticked_at_night"] else "НЕТ",
        fmt(datetime.strptime(r["first"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)),
        fmt(datetime.strptime(r["last"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)),
        r["max_gap_min"], r["idle_runs"], r["errors"]))
    if r["first_tick_after_longest_gap"] and r["max_gap_min"] > 10:
        w = datetime.strptime(r["first_tick_after_longest_gap"],
                              "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        print("%-22s        после самой долгой паузы (%.0f мин) первый тик: %s"
              % ("", r["max_gap_min"], fmt(w)))
print()
print("Чтение вердикта (вопрос 5): основной носитель — тот, у кого «ночью: ДА» и паузы ~интервала;")
print("launchd остаётся страховкой в любом исходе (d-2026-07-28-003).")
PY
