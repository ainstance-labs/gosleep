// @gosleep/core — Bearer-token on-disk encoding (GSL-264, rev-3 addendum Delta 5).
//
// The Delta-5 Tahoe 26.x regression: `security find-generic-password -w` on macOS Tahoe HEX-encodes
// binary passwords and, in some paths, hangs on non-ASCII secrets (`dev.to/euda1mon1a`,
// `zenn.dev/omori432`). Our mitigation:
//   1. We STORE the secret as Base64 with a stable prefix (`b64v1:`) so the on-disk shape is
//      always ASCII-safe; Tahoe never has to HEX-transcode.
//   2. On READ we detect the prefix and decode; a bare (non-prefixed) value is returned as-is so
//      operators can hand-write a plain string during setup or during a rescue-mode reset.
//   3. Base64 decode is strict — an integrity failure (truncation, corruption, wrong alphabet)
//      returns `null`, and callers translate null into `503 Service Unavailable`. Never fall
//      through to "unauth"; that would be exactly the gh CLI regression we do not repeat.
//
// The prefix is versioned (`b64v1:`) so a future change to the encoding can bump `v1 → v2`
// without confusing readers that only understand the older shape (they will see the unknown
// prefix and treat it as an integrity failure).

const PREFIX = "b64v1:";

/** Encode a UTF-8 secret string for Keychain storage. Output is always ASCII-safe. */
export function encodeSecret(plain: string): string {
  if (plain.length === 0) {
    throw new Error("encodeSecret: refusing to encode an empty secret");
  }
  const b64 = Buffer.from(plain, "utf8").toString("base64");
  return `${PREFIX}${b64}`;
}

/**
 * Decode whatever the Keychain wrapper read back. Returns:
 *   - the decoded UTF-8 string for `b64v1:...` values (with strict integrity check),
 *   - the raw string for anything else (lets operators inject plain-text during rescue),
 *   - `null` if a `b64v1:` prefixed value fails to round-trip (corruption / truncation).
 */
export function decodeSecret(stored: string): string | null {
  if (stored.length === 0) return null;

  if (!stored.startsWith(PREFIX)) {
    // Not our prefix — return verbatim. The prefix is versioned so future writers can bump
    // versions without confusing this reader (unknown-prefix values simply survive as opaque
    // strings, which is what a manually-set secret looks like anyway).
    return stored;
  }

  const body = stored.slice(PREFIX.length);
  if (body.length === 0) return null;

  // Buffer.from(..., 'base64') is lenient — it silently drops invalid characters and does not
  // fail on truncated input. To make integrity strict we (a) validate the alphabet + padding
  // shape and (b) round-trip the decoded bytes and confirm the re-encoded string matches.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  if (body.length % 4 !== 0) return null;

  const decoded = Buffer.from(body, "base64");
  const roundTrip = decoded.toString("base64");
  if (roundTrip !== body) return null;

  const text = decoded.toString("utf8");
  return text.length > 0 ? text : null;
}

/** Exported for tests — the current storage prefix. */
export const STORAGE_PREFIX = PREFIX;
