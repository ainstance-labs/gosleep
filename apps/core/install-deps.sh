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

# ── swiftc (Xcode Command Line Tools) — checked, not compiled here ────────────
if have swiftc; then
  say "swiftc present ($(swiftc --version 2>&1 | head -1))"
  say "NOTE: bin/touchid-gate.swift is SOURCE ONLY. GSL-264 handles the .app-bundle build."
else
  say "WARN: swiftc not on PATH. Install Xcode Command Line Tools with 'xcode-select --install'."
  say "      GSL-264 (Security) will need it to build bin/touchid-gate.app."
fi

say "done."
