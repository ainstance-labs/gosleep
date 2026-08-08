#!/usr/bin/env bash
# =============================================================================
# @gosleep/core — one-shot dependency installer (GSL-260).
#
# Installs the RUNTIME the core needs to run: Bun, Node-optional headers via bun,
# `security` (ships with macOS), `swiftc` (ships with Xcode CLTs). Then does a workspaces
# `bun install` at the repo root so @gosleep/core's node_modules are wired up.
#
# THIS SCRIPT DOES NOT COMPILE `bin/touchid-gate`. Per rev-3 addendum Delta 4, the TouchID
# gate needs to be shipped as a SIGNED .app BUNDLE (bare `swiftc -framework
# LocalAuthentication` builds do not receive biometric entitlements — the LAContext prompt
# silently fails). GSL-264 owns the .app-bundle build + codesign step. For GSL-260 we ship
# the .swift SOURCE and check that `swiftc` is available so GSL-264 can proceed without
# re-installing Xcode CLTs.
#
# Usage:
#   apps/core/install-deps.sh                # full install: bun + workspace deps + swiftc check
#   apps/core/install-deps.sh --check-only   # verify without installing
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECK_ONLY=0
[ "${1:-}" = "--check-only" ] && CHECK_ONLY=1

say() { echo "install-deps: $*"; }
die() { echo "install-deps: ERROR: $*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ── Bun ────────────────────────────────────────────────────────────────────────
if have bun; then
  say "bun present ($(bun --version))"
else
  [ "$CHECK_ONLY" = "1" ] && die "bun not on PATH (run without --check-only to install)"
  say "installing Bun (curl bun.sh)"
  curl -fsSL https://bun.sh/install | bash \
    || die "bun installer failed — see https://bun.sh/docs/installation"
  # Bun installer typically writes into ~/.bun/bin; add to current PATH for the rest of this run.
  export PATH="$HOME/.bun/bin:$PATH"
  have bun || die "bun installed but not on PATH after install"
  say "bun installed ($(bun --version))"
fi

# ── Workspace dependencies ─────────────────────────────────────────────────────
if [ "$CHECK_ONLY" = "0" ]; then
  say "bun install at repo root"
  (cd "$REPO_ROOT" && bun install) || die "bun install failed"
fi

# ── security (macOS Keychain CLI; ships with the OS) ──────────────────────────
if have security; then
  say "security CLI present"
else
  die "'security' CLI missing — this must run on macOS"
fi

# ── swiftc (Xcode Command Line Tools) — checked, and used to build touchid-gate.app ────
if have swiftc && have codesign; then
  say "swiftc present ($(swiftc --version 2>&1 | head -1))"
  if [ "$CHECK_ONLY" = "0" ]; then
    say "building bin/touchid-gate.app (GSL-264 rev-3 addendum Delta 4)"
    if bash "$SCRIPT_DIR/scripts/build-touchid-gate.sh"; then
      say "touchid-gate.app built + signed"
    else
      # Non-fatal here: the build can be re-attempted by hand; a missing bundle degrades
      # the high-blast gate to TTY-confirm only (still safe, just weaker biometrics).
      say "WARN: touchid-gate.app build failed — high-blast writes will fall back to TTY-confirm"
    fi
  else
    say "NOTE: --check-only mode — skipping touchid-gate.app build"
  fi
else
  say "WARN: swiftc/codesign not on PATH. Install Xcode Command Line Tools with 'xcode-select --install'."
  say "      Without them, apps/core/scripts/build-touchid-gate.sh cannot produce bin/touchid-gate.app."
  say "      Only the TTY-confirm fallback path will be available for high-blast writes."
fi

say "done."
