#!/usr/bin/env bash
# =============================================================================
# @gosleep/core — launchd install / uninstall / status (GSL-260).
#
# What this does:
#   install   — copy plist template to ~/Library/LaunchAgents with paths substituted,
#               set Keychain Bearer secret (prompted; NOT echoed to disk), bootstrap agent
#               with `launchctl bootstrap gui/$UID`, wait for /healthz to answer.
#   uninstall — `launchctl bootout` the agent, remove the installed plist. The Keychain
#               item is LEFT IN PLACE by default (owner may reuse it); pass --purge-secret
#               to also delete it.
#   status    — one-line health summary: whether the plist is installed, whether launchd
#               says the label is loaded, whether /healthz answers, and the current PID.
#
# WHY THIS IS SEPARATE FROM install-deps.sh. install-deps.sh installs the RUNTIME
# (bun, swiftc availability check, .app bundle wiring). plist.sh wires up the LAUNCH
# LIFECYCLE. Two nouns, two scripts. `install-deps.sh` runs once, `plist.sh install`
# runs when the owner wants launchd to actually take over.
#
# DEFERRED to GSL-264 per rev-3 addendum Delta 5:
#   - The `-T <trusted-app>` ACL flags on `security add-generic-password` — the wrapper
#     currently uses `-A` (allow all callers), which is a dev-friendly stopgap; production
#     hardening ties the ACL to the built binary path. The `-A` is annotated below.
#   - Tahoe 26.x HEX-encoding workaround for `security -w` reads.
#
# Usage:
#   apps/core/plist.sh install                # install + bootstrap + smoke
#   apps/core/plist.sh install --secret ENV   # take secret from $GOSLEEP_BEARER_TOKEN
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

install_secret() {
  local secret="$1"
  # `security add-generic-password -U` updates in place if the item already exists.
  # `-A` (allow all callers) is a dev-friendly stopgap; GSL-264 replaces this with
  # per-binary `-T` trusted-app ACLs (see rev-3 addendum Delta 5).
  security add-generic-password \
    -U -A \
    -s "$KEYCHAIN_SERVICE" \
    -a "$KEYCHAIN_ACCOUNT" \
    -w "$secret" \
    || die "security add-generic-password failed"
  say "Keychain item installed (service=$KEYCHAIN_SERVICE, account=$KEYCHAIN_ACCOUNT)"
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

cmd_install() {
  need_bin security
  need_bin launchctl
  need_bin curl
  [ -f "$TEMPLATE" ] || die "template not found: $TEMPLATE"

  local secret=""
  if [ "${1:-}" = "--secret" ] && [ "${2:-}" = "ENV" ]; then
    secret="${GOSLEEP_BEARER_TOKEN:-}"
    [ -n "$secret" ] || die "--secret ENV but GOSLEEP_BEARER_TOKEN is empty"
  else
    secret="$(secret_prompt)"
  fi

  install_secret "$secret"
  render_plist

  # `launchctl bootout` first in case a stale copy is around; ignore its exit.
  launchctl bootout "gui/$UID/${LABEL}" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$INSTALLED" || die "launchctl bootstrap failed"
  say "agent bootstrapped (gui/$UID/${LABEL})"
  wait_healthz
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

case "${1:-}" in
  install)   shift; cmd_install "$@" ;;
  uninstall) shift; cmd_uninstall "$@" ;;
  status)    cmd_status ;;
  *) echo "usage: $0 {install [--secret ENV] | uninstall [--purge-secret] | status}" >&2; exit 2 ;;
esac
