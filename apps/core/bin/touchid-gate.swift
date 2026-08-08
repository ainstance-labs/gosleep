// gosleep-core — TouchID gate (Swift source; GSL-260).
//
// SCOPE FOR THIS TASK (GSL-260). Ship the Swift source only. Compilation of a working
// biometric-capable binary requires a SIGNED .app BUNDLE per rev-3 addendum Delta 4 (see
// docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md §Delta 4).
// GSL-264 owns the .app-bundle wrap + codesign + entitlements plist. Building this file with
// plain `swiftc -framework LocalAuthentication` yields a Mach-O that WILL run, but
// `LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, …)` returns false
// because bare executables do not get biometric entitlements — the whole point of the .app
// bundle is to attach the entitlement to a bundle identity.
//
// Exit codes (contract for apps/core/src/spawn/publish.ts, later task):
//   0 — biometric evaluation succeeded (owner tapped TouchID / Face ID).
//   1 — user cancelled or biometric failed (wrong finger, too many attempts).
//   2 — no biometric sensor available (fallback to TTY-confirm — target-architecture §7.3).
//   3 — Swift/framework error (unexpected; treat as denial).
//
// The prompt reason string is passed via argv[1]; a caller should always pass one so the owner
// sees WHICH action they are approving on the system prompt (target-architecture §7.5 socialeng
// mitigation).

import Foundation
import LocalAuthentication

let reason = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "gosleep-core requests owner approval"

let context = LAContext()
var error: NSError?

guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
    // No sensor, no policy support, or entitlement denied. Contract: exit 2 signals the caller
    // to fall back to TTY-confirm.
    if let err = error {
        FileHandle.standardError.write("touchid-gate: policy unavailable: \(err.localizedDescription)\n".data(using: .utf8)!)
    }
    exit(2)
}

let semaphore = DispatchSemaphore(value: 0)
var granted = false
context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, err in
    granted = ok
    if let e = err {
        FileHandle.standardError.write("touchid-gate: \(e.localizedDescription)\n".data(using: .utf8)!)
    }
    semaphore.signal()
}
semaphore.wait()

exit(granted ? 0 : 1)
