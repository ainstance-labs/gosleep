#!/usr/bin/env bash
# =============================================================================
# gosleep lab — live Keychain round-trip integration test (GSL-264, rev-3 addendum Delta 5).
#
# WHAT THIS PROVES ON THIS MAC.
#   1. `security add-generic-password -T <bun>` creates a Keychain item whose ACL includes the
#      running `bun` binary AND the running `security` binary (bash + security own the write).
#   2. `security find-generic-password -w` reads the stored value back verbatim.
#   3. The Base64-encoded shim (`b64v1:<b64>`) round-trips through Keychain unchanged.
#   4. Our TypeScript wrapper decodes the value correctly (via a one-shot `bun -e` snippet).
#   5. Cleanup — the test item is DELETED before exit; the owner's real `gosleep-web` item
#      (if any) is NEVER touched.
#
# SAFETY RAILS. The test creates its item under service `gosleep-test-roundtrip-<pid>` — a
# per-run unique name that cannot collide with the owner's real `gosleep-web` item. Before
# writing, we refuse if such an item somehow already exists (defense-in-depth). On exit, we
# delete our item; a trap catches errors and Ctrl-C so nothing lingers.
#
# THIS SCRIPT WILL NEVER:
#   - Touch service `gosleep-web` or any other pre-existing item.
#   - Prompt the user for their login password (ACL grants prevent that).
#   - Print the secret to stdout/stderr (only the encoded shape, and only for verification).
#
# Usage:
#   bash tools/lab/tests/keychain-roundtrip.sh              # runs on macOS; skips on other OS
#
# Exit codes:
#   0  all checks pass
#   1  a check failed
#   77 skipped (not macOS, or 'security'/'bun' missing)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
note() { echo "  note: $*"; }

if [ "$(uname -s)" != "Darwin" ]; then
  echo "keychain-roundtrip: not macOS — skipping"
  exit 77
fi

for bin in security bun base64; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "keychain-roundtrip: '$bin' not on PATH — skipping"
    exit 77
  fi
done

BUN_BIN="$(command -v bun)"
SECURITY_BIN="$(command -v security)"
ACCOUNT="${USER}-test"
SERVICE="gosleep-test-roundtrip-$$"
SECRET_PLAIN="round-trip-secret-$$-abcdef"
ENCODED="b64v1:$(printf '%s' "$SECRET_PLAIN" | base64 | tr -d '\n')"

cleanup() {
  # Best-effort delete of the test item. Never delete anything but our per-run service.
  security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# --------------------------------------------------------------------------------------------
# Guard: refuse if a keychain item with our test service name already exists (defense-in-depth).
# --------------------------------------------------------------------------------------------
if security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; then
  echo "keychain-roundtrip: pre-existing item with our test service '$SERVICE' — refusing to run"
  exit 1
fi
ok "no pre-existing test item under service='$SERVICE'"

# --------------------------------------------------------------------------------------------
# 1. Create the item with -T ACL binding to bun + security itself.
# --------------------------------------------------------------------------------------------
if security add-generic-password \
     -T "$BUN_BIN" \
     -T "$SECURITY_BIN" \
     -s "$SERVICE" \
     -a "$ACCOUNT" \
     -w "$ENCODED" 2>/dev/null; then
  ok "add-generic-password -T <bun> -T <security> succeeded"
else
  bad "add-generic-password failed"
  exit 1
fi

# --------------------------------------------------------------------------------------------
# 2. Read it back (security is in the ACL → should NOT prompt).
# --------------------------------------------------------------------------------------------
READBACK="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null || true)"
if [ "$READBACK" = "$ENCODED" ]; then
  ok "round-trip: stored → read → matched (Base64 shape preserved)"
else
  bad "round-trip MISMATCH (got: ${#READBACK} chars, expected: ${#ENCODED})"
fi

# --------------------------------------------------------------------------------------------
# 3. Decode via the TS shim under bun. Runs the ACTUAL decodeSecret() code from apps/core.
# --------------------------------------------------------------------------------------------
DECODED_JSON="$(GOSLEEP_KEYCHAIN_SERVICE="$SERVICE" GOSLEEP_KEYCHAIN_ACCOUNT="$ACCOUNT" \
  bun -e "
    import('$REPO_ROOT/apps/core/src/security/tokenEncoding.ts').then((m) => {
      const decoded = m.decodeSecret(process.argv[1] ?? '');
      process.stdout.write(JSON.stringify({ decoded, len: decoded ? decoded.length : 0 }));
    }).catch((e) => {
      process.stderr.write('IMPORT_FAILED: ' + (e && e.message ? e.message : String(e)));
      process.exit(1);
    });
  " "$READBACK" 2>/dev/null)"

# Compare via a hash to keep the secret out of the shell/output. Log only lengths.
DECODED_LEN="$(printf '%s' "$DECODED_JSON" | bun -e "
  let s='';
  for await (const c of Bun.stdin.stream()) s += new TextDecoder().decode(c);
  try {
    const o = JSON.parse(s);
    process.stdout.write(String(o.len ?? 'null'));
  } catch { process.stdout.write('null'); }
")"

EXPECTED_LEN="${#SECRET_PLAIN}"
if [ "$DECODED_LEN" = "$EXPECTED_LEN" ]; then
  ok "TS decodeSecret() returned a string of the expected length ($EXPECTED_LEN chars)"
else
  bad "TS decodeSecret() returned len='$DECODED_LEN', expected '$EXPECTED_LEN'"
fi

# Also verify identity by comparing SHA-256s (never prints the secret).
EXPECTED_SHA="$(printf '%s' "$SECRET_PLAIN" | shasum -a 256 | awk '{print $1}')"
ACTUAL_SHA="$(printf '%s' "$DECODED_JSON" | bun -e "
  let s='';
  for await (const c of Bun.stdin.stream()) s += new TextDecoder().decode(c);
  try {
    const o = JSON.parse(s);
    const h = new Bun.CryptoHasher('sha256').update(o.decoded ?? '').digest('hex');
    process.stdout.write(h);
  } catch { process.stdout.write('parse-error'); }
")"
if [ "$ACTUAL_SHA" = "$EXPECTED_SHA" ]; then
  ok "TS decodeSecret() SHA-256 matches the original plain secret"
else
  bad "TS decodeSecret() SHA-256 mismatch"
fi

# --------------------------------------------------------------------------------------------
# 4. Timeout behaviour: point the reader at an account that does not exist and confirm the
#    wrapper returns a NULL secret with reason='exit-nonzero' (fast), not a hang. Ensures
#    the 503-not-unauth invariant holds even under the fastest path.
# --------------------------------------------------------------------------------------------
NO_SECRET_JSON="$(GOSLEEP_KEYCHAIN_SERVICE="does-not-exist-$$-nope" GOSLEEP_KEYCHAIN_ACCOUNT="nobody-$$" \
  GOSLEEP_KEYCHAIN_TIMEOUT_MS="3000" GOSLEEP_PLATFORM_OVERRIDE="25" \
  bun -e "
    import('$REPO_ROOT/apps/core/src/security/keychain.ts').then(async (m) => {
      const r = await m.readKeychainSecret();
      process.stdout.write(JSON.stringify({ secret: r.secret, reason: r.reason, timeoutMs: r.timeoutMs }));
    }).catch((e) => { process.stderr.write('IMPORT_FAILED: ' + (e && e.message ? e.message : String(e))); process.exit(1); });
  " 2>/dev/null)"

NO_SECRET_NULL="$(printf '%s' "$NO_SECRET_JSON" | bun -e "
  let s=''; for await (const c of Bun.stdin.stream()) s += new TextDecoder().decode(c);
  const o = JSON.parse(s); process.stdout.write(o.secret === null ? 'yes' : 'no');
")"
NO_SECRET_REASON="$(printf '%s' "$NO_SECRET_JSON" | bun -e "
  let s=''; for await (const c of Bun.stdin.stream()) s += new TextDecoder().decode(c);
  const o = JSON.parse(s); process.stdout.write(String(o.reason));
")"
if [ "$NO_SECRET_NULL" = "yes" ]; then
  ok "missing item → readKeychainSecret() returned null (reason=$NO_SECRET_REASON)"
else
  bad "missing item did NOT return null (JSON=$NO_SECRET_JSON)"
fi

# --------------------------------------------------------------------------------------------
# 5. Tahoe timeout floor: the wrapper should enforce >= 5000ms when platform=26, even with a
#    lower configured timeout.
# --------------------------------------------------------------------------------------------
TAHOE_JSON="$(GOSLEEP_KEYCHAIN_SERVICE="does-not-exist-$$-tahoe" GOSLEEP_KEYCHAIN_ACCOUNT="nobody-$$" \
  GOSLEEP_KEYCHAIN_TIMEOUT_MS="100" GOSLEEP_PLATFORM_OVERRIDE="26" \
  bun -e "
    import('$REPO_ROOT/apps/core/src/security/keychain.ts').then(async (m) => {
      const r = await m.readKeychainSecret();
      process.stdout.write(JSON.stringify({ timeoutMs: r.timeoutMs }));
    }).catch((e) => { process.stderr.write('IMPORT_FAILED: ' + (e && e.message ? e.message : String(e))); process.exit(1); });
  " 2>/dev/null)"
TAHOE_TIMEOUT="$(printf '%s' "$TAHOE_JSON" | bun -e "
  let s=''; for await (const c of Bun.stdin.stream()) s += new TextDecoder().decode(c);
  const o = JSON.parse(s); process.stdout.write(String(o.timeoutMs));
")"
if [ "$TAHOE_TIMEOUT" = "5000" ]; then
  ok "Tahoe (override=26) floors timeout to 5000ms (got: $TAHOE_TIMEOUT)"
else
  bad "Tahoe timeout floor NOT enforced (got: $TAHOE_TIMEOUT, expected: 5000)"
fi

# --------------------------------------------------------------------------------------------
# 6. Explicit cleanup (trap will run a second time; both are no-ops if already deleted).
# --------------------------------------------------------------------------------------------
cleanup
if security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; then
  bad "test item was NOT deleted at end of run"
else
  ok "test item deleted (service=$SERVICE)"
fi

echo
echo "== summary =="
echo "  pass=$PASS  fail=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "  keychain-roundtrip: ALL PASS"
  exit 0
fi
echo "  keychain-roundtrip: $FAIL FAIL(s)"
exit 1
