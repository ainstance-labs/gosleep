#!/usr/bin/env bash
# =============================================================================
# gosleep lab — the render step. STDIN: render_bundle.json. STDOUT: one JSON object, always.
#
#   {"ok":true,  "pages":{"index.html":"<!doctype html>…", …}, "screens":[…]}
#   {"ok":false, "reason":"no-node", "hint":"…"}
#
# THIS SCRIPT ALWAYS EXITS 0 AND ALWAYS PRINTS JSON. The chronicler is a bounded job that must
# survive every source being unavailable (that is the whole design of Phase 4: degraded, never
# fatal). A renderer that could kill it — by dying, by printing a bare stack trace, by exiting 2 —
# would hand the owner a 03:00 crash instead of an honest, stale page. So every failure below is
# DATA: a stable `reason` code the chronicler puts in status.json, in the event log, and in a banner
# across the top of every page it could not rebuild.
#
# `reason` is a CLOSED vocabulary. Add a code here and in chronicler.py's UI_REASONS together:
#   no-node      node is not on PATH               -> the pages on disk are whatever last built them
#   no-deps      node_modules is missing/incomplete-> run `npm install` in tools/lab/ui/
#   build-failed esbuild or the renderer threw     -> the error text is carried through verbatim
#   bad-bundle   stdin was not a render bundle     -> the DATA layer broke, not the view layer
#
# Deps are NOT installed automatically. `npm install` reaches the network, and a chronicler pass
# fires from a cycle boundary at 03:00 on a laptop that may be on a phone tether or offline: a
# nightly job that silently starts downloading is a nightly job that silently hangs. Bootstrapping is
# an explicit, human-run, once-per-clone act — and until it happens the pages say so, loudly.
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {   # fail <reason> <hint>
  # -Rs slurps stdin as ONE raw string, so an esbuild stack trace with quotes and newlines in it
  # cannot break out of the JSON. Without --arg-from-stdin discipline a build error becomes a parse
  # error two layers up, and the reason the owner needs is replaced by the noise of losing it.
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "${2:-}" | jq -Rs --arg reason "$1" '{ok:false, reason:$reason, hint:.}'
  else
    printf '{"ok":false,"reason":"%s","hint":"(jq unavailable to quote the hint safely)"}' "$1"
  fi
  exit 0
}

command -v node >/dev/null 2>&1 || fail "no-node" \
  "node is not on PATH. The laboratory's data layer (python3) is unaffected — status.json, the
event log and the morning digest are all still fresh. Only the HTML view layer needs node.
Install node 18+ (e.g. nvm install --lts), then: cd tools/lab/ui && npm install"

# A node_modules that exists but is missing a package is the nastier case (an interrupted install,
# a pruned cache): probe the two packages we actually import rather than the directory's existence.
for pkg in esbuild preact preact-render-to-string; do
  [[ -d "$HERE/node_modules/$pkg" ]] || fail "no-deps" \
    "tools/lab/ui/node_modules/$pkg is missing. Bootstrap the view layer once:
    cd tools/lab/ui && npm install
(This is never done automatically: a nightly job that reaches the network is a nightly job that
can hang on a bad connection at 03:00.)"
done

OUT="$(node "$HERE/build.mjs" 2>&1)"
RC=$?

if [[ $RC -ne 0 && -z "$OUT" ]]; then
  fail "build-failed" "node exited $RC without a word. Try: cd tools/lab/ui && node build.mjs < ../../../docs/lab/render_bundle.json"
fi

# build.mjs prints {"ok":false,"error":…} on a throw and exits 1. Pass its own diagnosis through
# rather than overwriting it: "schema mismatch" and "esbuild blew up" are different bugs, in
# different layers, owned by different people.
if [[ $RC -ne 0 ]]; then
  if command -v jq >/dev/null 2>&1 && printf '%s' "$OUT" | jq -e '.error' >/dev/null 2>&1; then
    ERR="$(printf '%s' "$OUT" | jq -r '.error')"
    case "$ERR" in
      *"schema mismatch"*|*"JSON"*|*"empty stdin"*) fail "bad-bundle" "$ERR" ;;
      *)                                            fail "build-failed" "$ERR" ;;
    esac
  fi
  fail "build-failed" "$OUT"
fi

printf '%s' "$OUT"
exit 0
