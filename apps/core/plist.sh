#!/usr/bin/env bash
# =============================================================================
# @gosleep/core — launchd install / uninstall / status (GSL-260, GSL-264 hardening).
#
# What this does:
#   install         — copy plist template to ~/Library/LaunchAgents with paths substituted,
#                     set Keychain Bearer secret (prompted; NOT echoed to disk), bootstrap agent
#                     with `launchctl bootstrap gui/$UID`, wait for /healthz to answer.
#   uninstall       — `launchctl bootout` the agent, remove the installed plist. The Keychain
#                     item is LEFT IN PLACE by default (owner may reuse it); pass --purge-secret
#                     to also delete it.
#   rotate-secret   — set/replace the Keychain item WITHOUT touching launchd. Owner-facing
#                     command for periodic rotation.
#   status          — one-line health summary: whether the plist is installed, whether launchd
#                     says the label is loaded, whether /healthz answers, and the current PID.
#
# WHY THIS IS SEPARATE FROM install-deps.sh. install-deps.sh installs the RUNTIME
# (bun, swiftc, builds bin/touchid-gate.app). plist.sh wires up the LAUNCH LIFECYCLE + writes
# the Keychain item with the Delta-5 ACL. Two nouns, two scripts.
#
# GSL-264 (rev-3 addendum Delta 5) — this script's SECURITY changes:
#   1. `-T` ACL binding replaces the dev-friendly `-A`. `security add-generic-password` is now
#      called with `-T <bun>` + `-T <plist.sh>` so ONLY those callers can retrieve the item
#      without a user consent prompt. Other processes under the same UID get an interactive
#      Apple prompt; agents in a pipe context cannot answer it.
#   2. The secret is Base64-encoded with the `b64v1:` prefix before storage. Reader
#      (src/security/tokenEncoding.ts) detects the prefix and decodes; on Tahoe 26.x this
#      keeps the on-disk shape ASCII-safe and avoids the `security -w` HEX regression.
#   3. Tahoe 26.x is detected via `sw_vers -productVersion` and, if present, an operator note
#      is printed so the owner sees the platform-specific behaviour in the install log.
#
# Usage:
#   apps/core/plist.sh install                # install + bootstrap + smoke (interactive prompt)
#   apps/core/plist.sh install --secret ENV   # take secret from $GOSLEEP_BEARER_TOKEN
#   apps/core/plist.sh rotate-secret          # replace the Keychain item; leave launchd alone
#   apps/core/plist.sh rotate-secret --secret ENV
#   apps/core/plist.sh uninstall              # bootout + remove plist
#   apps/core/plist.sh uninstall --purge-secret
#   apps/core/plist.sh status                 # print health line
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LABEL="com.gosleep.core"
TEMPLATE="$SCRIPT_DIR/plist/${LABEL}.plist"
INSTALLED="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOGS_DIR="$REPO_ROOT/data/logs"
KEYCHAIN_SERVICE="${GOSLEEP_KEYCHAIN_SERVICE:-gosleep-web}"
KEYCHAIN_ACCOUNT="${GOSLEEP_KEYCHAIN_ACCOUNT:-$USER}"
CORE_HOST="127.0.0.1"
CORE_PORT="${GOSLEEP_CORE_PORT:-7331}"

say() { echo "plist: $*"; }
die() { echo "plist: ERROR: $*" >&2; exit 1; }

need_bin() {
  command -v "$1" >/dev/null 2>&1 || die "missing binary '$1' on PATH"
}

secret_prompt() {
  # Read the secret WITHOUT echoing (bash 3.2 compatible: `read -s` works).
  # Two rounds so a typo does not silently install the wrong value.
  local s1 s2
  printf 'gosleep-core Bearer secret (input hidden): ' >&2
  read -rs s1
  echo >&2
  printf 'confirm: ' >&2
  read -rs s2
  echo >&2
  [ -n "$s1" ] || die "empty secret refused"
  [ "$s1" = "$s2" ] || die "secrets did not match"
  printf '%s' "$s1"
}

# ---------------------------------------------------------------------------------------------
# Delta-5 secret helpers: Base64 encoding + platform detection
# ---------------------------------------------------------------------------------------------

# Encode a UTF-8 secret as `b64v1:<base64>`. Matches decodeSecret() in tokenEncoding.ts.
encode_secret() {
  local plain="$1"
  local b64
  b64="$(printf '%s' "$plain" | base64 | tr -d '\n')"
  [ -n "$b64" ] || die "base64 encoding produced empty output"
  printf 'b64v1:%s' "$b64"
}

# One-shot platform probe. Prints "tahoe" (macOS 26.x) or "prior".
detect_platform() {
  if [ "$(uname -s)" != "Darwin" ]; then
    printf 'non-darwin'
    return
  fi
  local pv
  pv="$(sw_vers -productVersion 2>/dev/null || echo "")"
  case "$pv" in
    26.*) printf 'tahoe' ;;
    *)    printf 'prior' ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# Delta-5 Keychain install with `-T` ACL bindings
# ---------------------------------------------------------------------------------------------

install_secret() {
  local secret="$1"
  local platform
  platform="$(detect_platform)"
  say "platform: $platform"

  # Trusted-app list per Delta 5. The bun binary is the ONE that reads the secret at runtime
  # (via `security find-generic-password -w`); plist.sh is the ONE that writes it. Both must
  # be in the ACL or the process gets an interactive prompt at read time (fatal for launchd).
  local bun_bin
  bun_bin="$(command -v bun || true)"
  [ -x "$bun_bin" ] || die "no 'bun' on PATH — cannot bind Keychain ACL to it"

  # Resolve the plist.sh full path (readlink -f is GNU-only; use a portable shim).
  local self_bin
  self_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

  # Delta-5 encoding: wrap the raw secret as `b64v1:<base64>` before storing. Reader
  # (src/security/tokenEncoding.ts) transparently decodes.
  local encoded
  encoded="$(encode_secret "$secret")"

  # `-U` updates in place if the item already exists. `-T <path>` grants that binary the
  # right to retrieve the item without a user consent prompt; we deliberately do NOT pass
  # `-A` (all-callers-allowed) — the ACL is the point.
  say "storing Keychain item with -T ACL bindings (bun=$bun_bin, self=$self_bin)"
  security add-generic-password \
    -U \
    -T "$bun_bin" \
    -T "$self_bin" \
    -s "$KEYCHAIN_SERVICE" \
    -a "$KEYCHAIN_ACCOUNT" \
    -w "$encoded" \
    || die "security add-generic-password failed"
  say "Keychain item installed (service=$KEYCHAIN_SERVICE, account=$KEYCHAIN_ACCOUNT, encoding=b64v1)"

  if [ "$platform" = "tahoe" ]; then
    say "NOTE: macOS Tahoe 26.x detected — the reader enforces a 5s timeout floor and Base64"
    say "      decoding (see rev-3 addendum Delta 5). The on-disk value is ASCII-safe."
  fi

  # Round-trip verify: read the item back through the SAME process this script runs from, so
  # we validate the ACL grant before handing off to launchd.
  local readback
  readback="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null || true)"
  if [ "$readback" != "$encoded" ]; then
    die "Keychain round-trip verify FAILED (stored value did not round-trip; see 'security list-keychains')"
  fi
  say "Keychain round-trip verified (stored → read → matched)"
}

render_plist() {
  local bun_bin
  bun_bin="$(command -v bun || true)"
  [ -x "$bun_bin" ] || die "no 'bun' on PATH — run apps/core/install-deps.sh first"
  mkdir -p "$(dirname "$INSTALLED")"
  mkdir -p "$LOGS_DIR"
  # Two @@markers, both mandatory. sed with a control character delimiter to survive '/' in paths.
  sed \
    -e "s|@@BUN_BIN@@|$bun_bin|g" \
    -e "s|@@REPO_ROOT@@|$REPO_ROOT|g" \
    "$TEMPLATE" > "$INSTALLED"
  say "plist rendered → $INSTALLED"
}

wait_healthz() {
  local i
  for i in 1 2 3 4 5 6 7 8; do
    if curl -sf "http://${CORE_HOST}:${CORE_PORT}/healthz" >/dev/null 2>&1; then
      say "/healthz responded ok after ${i}s"
      return 0
    fi
    sleep 1
  done
  die "/healthz did not answer within 8s — check $LOGS_DIR/core-stderr.log"
}

read_secret_from_env_or_prompt() {
  local secret=""
  if [ "${1:-}" = "--secret" ] && [ "${2:-}" = "ENV" ]; then
    secret="${GOSLEEP_BEARER_TOKEN:-}"
    [ -n "$secret" ] || die "--secret ENV but GOSLEEP_BEARER_TOKEN is empty"
  else
    secret="$(secret_prompt)"
  fi
  printf '%s' "$secret"
}

cmd_install() {
  need_bin security
  need_bin launchctl
  need_bin curl
  need_bin base64
  [ -f "$TEMPLATE" ] || die "template not found: $TEMPLATE"

  local secret
  secret="$(read_secret_from_env_or_prompt "$@")"

  install_secret "$secret"
  render_plist

  # `launchctl bootout` first in case a stale copy is around; ignore its exit.
  launchctl bootout "gui/$UID/${LABEL}" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$INSTALLED" || die "launchctl bootstrap failed"
  say "agent bootstrapped (gui/$UID/${LABEL})"
  wait_healthz
}

cmd_rotate_secret() {
  need_bin security
  need_bin base64

  local secret
  secret="$(read_secret_from_env_or_prompt "$@")"

  install_secret "$secret"
  say "Keychain secret rotated. Restart core to pick it up:"
  say "    launchctl kickstart -k gui/\$UID/${LABEL}"
}

cmd_uninstall() {
  need_bin launchctl
  launchctl bootout "gui/$UID/${LABEL}" 2>/dev/null || true
  rm -f "$INSTALLED"
  say "agent uninstalled + plist removed"
  if [ "${1:-}" = "--purge-secret" ]; then
    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" >/dev/null 2>&1 \
      || say "Keychain item was not present (nothing to purge)"
    say "Keychain item purged"
  else
    say "Keychain item LEFT IN PLACE (pass --purge-secret to remove)"
  fi
}

cmd_status() {
  local installed loaded healthz pid
  installed=0; loaded=0; healthz=0; pid=""
  [ -f "$INSTALLED" ] && installed=1
  if launchctl print "gui/$UID/${LABEL}" >/dev/null 2>&1; then
    loaded=1
    pid="$(launchctl print "gui/$UID/${LABEL}" 2>/dev/null | awk -F'= *' '/pid = /{print $2; exit}')"
  fi
  if curl -sf "http://${CORE_HOST}:${CORE_PORT}/healthz" >/dev/null 2>&1; then
    healthz=1
  fi
  printf '{"installed":%d,"loaded":%d,"healthz":%d,"pid":"%s","host":"%s:%s"}\n' \
    "$installed" "$loaded" "$healthz" "${pid:-}" "$CORE_HOST" "$CORE_PORT"
}

cmd_setup_url() {
  # GSL-291 — mint a one-shot OTP + print the setup URL the owner pastes into a browser.
  # Flow: POST /internal/setup/otp with GOSLEEP_INTERNAL_SECRET → core returns
  # {ok, otp, url, expires_at, ttl_s}. The Bearer never leaves the box; the OTP does.
  #
  # GOSLEEP_INTERNAL_SECRET must be exported (the same value the running core sees).
  # If unset, we print the pre-flight check that the owner needs to fix — no partial success.
  if [ -z "${GOSLEEP_INTERNAL_SECRET:-}" ]; then
    cat >&2 <<EOM
error: GOSLEEP_INTERNAL_SECRET is not set in this shell.

The /setup one-shot OTP endpoint sits behind the internal-secret guard (the same guard
the PreToolUse hook shims use for /internal/questions/*). Set it in this shell to the
SAME value the running core sees:

  export GOSLEEP_INTERNAL_SECRET='<same value as the core process>'
  bash apps/core/plist.sh setup-url

If the core does not have GOSLEEP_INTERNAL_SECRET set either, /internal/* returns 503 by
design (fail-safe). Add it to the plist env before enabling the /setup flow.
EOM
    exit 2
  fi
  local ttl="${GOSLEEP_SETUP_TTL_S:-300}"
  local resp
  resp="$(curl -sf -X POST \
    -H "Host: ${CORE_HOST}:${CORE_PORT}" \
    -H "Origin: http://${CORE_HOST}:${CORE_PORT}" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Secret: ${GOSLEEP_INTERNAL_SECRET}" \
    -d "{\"ttl_s\":${ttl}}" \
    "http://${CORE_HOST}:${CORE_PORT}/internal/setup/otp" 2>/dev/null)" || {
    echo "error: POST /internal/setup/otp failed (is the core up on ${CORE_HOST}:${CORE_PORT}?)" >&2
    exit 1
  }
  # Prefer jq if available; degrade to python3 otherwise.
  local url expires
  if command -v jq >/dev/null 2>&1; then
    url="$(echo "$resp" | jq -r '.url // empty')"
    expires="$(echo "$resp" | jq -r '.expires_at // empty')"
  else
    url="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("url",""))' <<<"$resp")"
    expires="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("expires_at",""))' <<<"$resp")"
  fi
  if [ -z "$url" ]; then
    echo "error: response missing 'url' — raw response follows:" >&2
    echo "$resp" >&2
    exit 1
  fi
  # Print the URL as the last line so shell substitutions work (`URL=$(plist.sh setup-url | tail -1)`).
  echo "# Setup URL — paste into your browser. Single-use, expires at ${expires}."
  echo "$url"
}

case "${1:-}" in
  install)        shift; cmd_install "$@" ;;
  rotate-secret)  shift; cmd_rotate_secret "$@" ;;
  uninstall)      shift; cmd_uninstall "$@" ;;
  status)         cmd_status ;;
  setup-url)      cmd_setup_url ;;
  *) echo "usage: $0 {install [--secret ENV] | rotate-secret [--secret ENV] | uninstall [--purge-secret] | status | setup-url}" >&2; exit 2 ;;
esac
