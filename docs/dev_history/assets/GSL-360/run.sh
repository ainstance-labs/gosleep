#!/usr/bin/env bash
# GSL-373 live-leg: boots @gosleep/core on port 7347 against a scratch fake HOME and DB,
# waits for the sessions/tmux collectors to tick, then captures /healthz + /fleet +
# /observed/collectors as evidence. Kills the process on exit.
#
# Evidence: docs/dev_history/assets/GSL-359/ (fleet attribution) and
#           docs/dev_history/assets/GSL-360/ (chunked tick timing).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${GOSLEEP_CORE_PORT:-7347}"
TOKEN="live-leg-token-DO-NOT-USE"
WORK="$REPO_ROOT/.artifacts/live-leg"

# Guard: port must be free before we start.
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "ERROR: port $PORT is already in use — refusing to run the live-leg." >&2
  exit 1
fi

# Scratch fake $HOME with a small fake ~/.claude/projects tree.
FAKE_HOME="$WORK/home"
CLAUDE_HOME="$FAKE_HOME/.claude/projects"
rm -rf "$FAKE_HOME"; mkdir -p "$CLAUDE_HOME"

# Two warm transcripts (native gosleep-like + observed scratch) — fresh mtime.
mk_transcript() {
  local slug="$1" cwd="$2" mtime_epoch="$3"
  local dir_name
  dir_name="-${cwd//\//-}"
  local dir_path="$CLAUDE_HOME/$dir_name"
  mkdir -p "$dir_path"
  local p="$dir_path/sess-$slug.jsonl"
  cat > "$p" <<EOF
{"type":"header","cwd":"$cwd","model":"claude-opus-4-7-20260201"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"warm-live test for $slug"}]}}
{"type":"last-prompt","lastPrompt":"live-leg fixture for $slug"}
EOF
  touch -t "$(date -r "$mtime_epoch" +%Y%m%d%H%M.%S)" "$p"
}

# gosleep-native (cwd matches GOSLEEP_REPO_ROOT below).
NATIVE_CWD="$REPO_ROOT"
OBSERVED_CWD_1="/tmp/live-leg-observed-warm-1"
OBSERVED_CWD_2="/tmp/live-leg-observed-warm-2"
mkdir -p "$OBSERVED_CWD_1" "$OBSERVED_CWD_2" 2>/dev/null || true

NOW="$(date +%s)"
mk_transcript "native-1"      "$NATIVE_CWD"      "$NOW"
mk_transcript "observed-warm" "$OBSERVED_CWD_1"  "$NOW"
mk_transcript "observed-warm2" "$OBSERVED_CWD_2" "$((NOW - 30))"

# Six cold transcripts (mtime ≥ 48 h old) so the chunked cold rotation has work to do.
COLD_TS="$((NOW - 48 * 3600))"
for i in 1 2 3 4 5 6; do
  cwd="/tmp/live-leg-cold-$i"
  mkdir -p "$cwd" 2>/dev/null || true
  mk_transcript "cold-$i" "$cwd" "$COLD_TS"
done

# Scratch DB, migrated from scratch.
SCRATCH_DB="$WORK/gosleep.db"
rm -f "$SCRATCH_DB" "$SCRATCH_DB-wal" "$SCRATCH_DB-shm"
GOSLEEP_DB_PATH="$SCRATCH_DB" bun run "$REPO_ROOT/apps/core/scripts/migrate.ts" \
  > "$WORK/migrate.log" 2>&1 || {
  echo "ERROR: migrate failed — see $WORK/migrate.log" >&2
  cat "$WORK/migrate.log" >&2
  exit 1
}

# Boot core. HOME redirect so the sessions collector reads our fake tree.
# COLD_CHUNK=2 makes the cold rotation take 3 ticks so we can see the hold in action.
echo "== booting @gosleep/core on 127.0.0.1:$PORT with fake HOME=$FAKE_HOME =="
HOME="$FAKE_HOME" \
GOSLEEP_BEARER_TOKEN="$TOKEN" \
GOSLEEP_DB_PATH="$SCRATCH_DB" \
GOSLEEP_REPO_ROOT="$NATIVE_CWD" \
GOSLEEP_ORIGIN_ALLOWLIST="http://127.0.0.1:$PORT" \
GOSLEEP_DISABLE_INDEXER=1 \
GOSLEEP_DISABLE_FLEET_POLL=1 \
GOSLEEP_OBSERVED_SESSIONS_MS=1000 \
GOSLEEP_OBSERVED_TMUX_MS=1000 \
GOSLEEP_OBSERVER_COLD_CHUNK=2 \
GOSLEEP_OBSERVER_WARM_WINDOW_MS=$((24 * 3600 * 1000)) \
GOSLEEP_CORE_PORT="$PORT" \
bun run "$REPO_ROOT/apps/core/src/serve.ts" \
  > "$WORK/core.out.log" 2> "$WORK/core.err.log" &
PID=$!
trap 'kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true' EXIT

# Wait for healthz to answer.
for _ in $(seq 1 40); do
  if curl -s "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl -s "http://127.0.0.1:$PORT/healthz" > "$WORK/healthz.json"
echo "healthz: $(cat "$WORK/healthz.json")"

# Give the collectors a few ticks (5 s ≈ 5 sessions ticks at 1 s cadence — enough to visit
# all 6 cold transcripts under chunk=2).
sleep 6

# GSL-359 evidence: seed the tmux_panes table by hand with two rows — one whose
# pane_current_path is UNDER the observed warm-1 cwd (heuristic must fire, attribution flips
# to 'heuristic'), and one whose pane_pid matches the observed warm-2 session's pid but
# whose pane_current_path is somewhere else (pidtree opt-in check — attribution stays null
# unless the opt-in is on; it is not here, so the session's pid is null and pidtree cannot
# fire regardless — this row simply won't match).
sqlite3 "$SCRATCH_DB" <<SQL
INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                        pane_current_path, pane_current_command, pane_title,
                        first_seen, last_seen, misses)
VALUES ('%1', '\$0', 'live-leg', '@0', 8888,
        '$OBSERVED_CWD_1/deep/nested', 'claude', 'live-leg-heur',
        '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z', 0),
       ('%2', '\$0', 'live-leg', '@0', 9999,
        '/somewhere/else', 'claude', 'live-leg-nomatch',
        '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z', 0);
SQL

# /fleet — GSL-359 evidence: attribution should be "heuristic" for the observed rows.
curl -s -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:$PORT/fleet" | jq . > "$WORK/fleet.json"
echo "fleet rows:"
jq '.sessions | map({session_id, project_slug, tmux_pane_ref, attribution, observed_only})' \
  "$WORK/fleet.json"

# /observed/collectors — GSL-360 evidence: sessions collector's last_tick_ms should stay
# small even after multiple chunked ticks; events_today reflects the boot-flood emissions.
curl -s -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:$PORT/observed/collectors" | jq . > "$WORK/collectors.json"
echo "collectors:"
cat "$WORK/collectors.json"

# GSL-360: dump the observed_events table so we can prove backfill flag semantics under the
# chunked rotation (all boot-flood rows should carry backfill=true).
sqlite3 "$SCRATCH_DB" \
  "SELECT project_slug, kind, json_extract(payload_json, '\$.backfill') AS backfill, ts \
   FROM observed_events ORDER BY seq;" > "$WORK/events.tsv"
echo "events:"
cat "$WORK/events.tsv"

# GSL-360: bench the raw enumerator + full snapshot build against the fake home. The bench
# reports the cheap listing time (should be single-digit ms even at 500 transcripts) and
# the total buildSnapshot time (the dominant work — chunking amortizes this across ticks).
cat > "$WORK/bench.ts" <<'BENCH'
import { listCandidateTranscripts, buildSnapshot, gosleepProjectRoot } from "../../apps/core/src/observed/sessions.ts";
const CLAUDE_HOME = process.env["FAKE_CLAUDE_HOME"]!;
const t0 = performance.now();
const cands = listCandidateTranscripts(CLAUDE_HOME);
const t1 = performance.now();
const gosleepRoot = gosleepProjectRoot();
const now = Date.now();
for (const c of cands) buildSnapshot(c, undefined, gosleepRoot, now);
const t2 = performance.now();
console.log(JSON.stringify({
  event: "bench.enumerate",
  candidates: cands.length,
  list_ms: +(t1 - t0).toFixed(2),
  build_total_ms: +(t2 - t1).toFixed(2),
  build_per_ms: cands.length > 0 ? +((t2 - t1) / cands.length).toFixed(3) : null,
}));
BENCH
FAKE_CLAUDE_HOME="$FAKE_HOME/.claude" bun run "$WORK/bench.ts" > "$WORK/bench.json"
echo "bench:"
cat "$WORK/bench.json"

# Teardown handled by trap.
sleep 0.5
echo "== live-leg complete =="
