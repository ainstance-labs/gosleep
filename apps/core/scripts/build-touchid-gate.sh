#!/usr/bin/env bash
# =============================================================================
# @gosleep/core — build the TouchID gate .app bundle (GSL-264, rev-3 addendum Delta 4).
#
# WHY THIS EXISTS. `swiftc` produces a Mach-O executable. That Mach-O will run, but
# `LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, …)` returns false —
# bare executables do not receive `LocalAuthentication` biometric entitlements. The entitlement
# is gated on a bundle IDENTITY, which requires a `.app` bundle with `Contents/Info.plist`
# declaring a `CFBundleIdentifier`, and a codesign signature (ad-hoc is fine on this contour)
# that matches that identifier. This script does exactly that in place, with zero Xcode
# dependency — the macOS toolchain ships everything needed.
#
# WHAT THIS PRODUCES.
#   apps/core/bin/touchid-gate.app/
#     Contents/Info.plist                <- CFBundleIdentifier=com.gosleep.touchid-gate, LSUIElement=true
#     Contents/MacOS/touchid-gate        <- swiftc-built Mach-O
#     Contents/_CodeSignature/           <- ad-hoc signature from `codesign -s -`
#
# HOW IT IS INVOKED.
#   apps/core/scripts/build-touchid-gate.sh           # build + sign in place
#   apps/core/scripts/build-touchid-gate.sh --check   # verify already-built bundle
#   apps/core/scripts/build-touchid-gate.sh --clean   # remove the built bundle
#
# CONTRACT WITH THE CALLER.
#   0 — bundle built and signed (or --check confirmed a signed bundle);
#   1 — build/sign/verify failed; see stderr.
#   2 — swiftc or codesign not on PATH; caller should ask for `xcode-select --install`.
#
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$CORE_DIR/bin"
BUNDLE="$BIN_DIR/touchid-gate.app"
INFO_TMPL="$BIN_DIR/touchid-gate.Info.plist.tmpl"
ENTITLEMENTS="$BIN_DIR/touchid-gate.entitlements.plist"
SRC="$BIN_DIR/touchid-gate.swift"
IDENTIFIER="com.gosleep.touchid-gate"

say()  { echo "build-touchid-gate: $*"; }
warn() { echo "build-touchid-gate: WARN: $*" >&2; }
die()  { echo "build-touchid-gate: ERROR: $*" >&2; exit 1; }

need() {
  # Returns 0 if binary is on PATH, 2 (not 1) otherwise so the caller can tell "missing
  # toolchain" from "build failed".
  command -v "$1" >/dev/null 2>&1 || { echo "build-touchid-gate: MISSING: $1 not on PATH" >&2; exit 2; }
}

check_bundle() {
  [ -x "$BUNDLE/Contents/MacOS/touchid-gate" ] || die "no executable at $BUNDLE/Contents/MacOS/touchid-gate"
  [ -f "$BUNDLE/Contents/Info.plist" ]         || die "no Info.plist at $BUNDLE/Contents/Info.plist"
  codesign --verify --strict "$BUNDLE"         || die "codesign --verify failed on $BUNDLE"
  # Print the signing identity + identifier so the operator can confirm.
  codesign -dv "$BUNDLE" 2>&1 | grep -E '(Identifier|Signature|Format)' || true
  say "bundle verified: $BUNDLE"
}

clean_bundle() {
  rm -rf "$BUNDLE"
  say "removed $BUNDLE"
}

build_bundle() {
  need swiftc
  need codesign
  [ -f "$SRC" ]          || die "source not found: $SRC"
  [ -f "$INFO_TMPL" ]    || die "Info.plist template not found: $INFO_TMPL"
  [ -f "$ENTITLEMENTS" ] || die "entitlements plist not found: $ENTITLEMENTS"

  # Start from a clean bundle — a stale Info.plist can silently make the signature disagree
  # with the identifier.
  rm -rf "$BUNDLE"
  mkdir -p "$BUNDLE/Contents/MacOS"

  # 1. Info.plist — copy verbatim; no substitutions needed (template already has the identifier).
  cp "$INFO_TMPL" "$BUNDLE/Contents/Info.plist"

  # 2. Compile the Swift source. `-O` because this is a one-shot helper, no debug info needed
  #    in production; `-target arm64-apple-macos13` keeps the binary portable back to the
  #    LSMinimumSystemVersion we declared.
  say "compiling $SRC → $BUNDLE/Contents/MacOS/touchid-gate"
  local target=""
  local arch
  arch="$(uname -m)"
  if [ "$arch" = "arm64" ]; then
    target="-target arm64-apple-macos13"
  elif [ "$arch" = "x86_64" ]; then
    target="-target x86_64-apple-macos13"
  fi
  # shellcheck disable=SC2086
  swiftc -O $target -framework LocalAuthentication \
    -o "$BUNDLE/Contents/MacOS/touchid-gate" "$SRC" \
    || die "swiftc failed"

  # 3. Ad-hoc codesign with the entitlements plist. `-s -` = ad-hoc identity (no dev-cert
  #    required), `--identifier` locks the bundle identity to what Info.plist declares.
  say "codesign (ad-hoc) with identifier=$IDENTIFIER"
  codesign --sign - \
           --identifier "$IDENTIFIER" \
           --entitlements "$ENTITLEMENTS" \
           --options runtime \
           --deep --force \
           "$BUNDLE" \
    || die "codesign failed"

  # 4. Verify — refuse to leave a malformed bundle around.
  codesign --verify --strict "$BUNDLE" || die "codesign --verify failed post-build"
  say "built + signed: $BUNDLE"
  codesign -dv "$BUNDLE" 2>&1 | grep -E '(Identifier|Signature|Format)' || true
}

case "${1:-}" in
  ""|--build) build_bundle ;;
  --check)    check_bundle ;;
  --clean)    clean_bundle ;;
  *) echo "usage: $0 [--build|--check|--clean]" >&2; exit 2 ;;
esac
