// @gosleep/web — Bearer discovery (GSL-265).
//
// The gosleep-core server accepts a Bearer at `Authorization: Bearer <secret>`. In dev we
// use the smoke override (GOSLEEP_BEARER_TOKEN — the CoreClient sees it via the URL that
// vite-proxy forwards). In prod the token comes from macOS Keychain via the setup flow
// (GSL-269) — the SPA never sees the secret directly; the /setup endpoint 302's with a
// short-lived cookie or drops it into sessionStorage under a one-time key.
//
// This helper implements ONLY the SPA-side pull: sessionStorage first; else the URL's
// `?token=<…>` (setup handshake) — if present, we lift it into sessionStorage and rewrite
// the URL to strip it, then return the value. Local storage is intentionally NOT used —
// sessionStorage dies with the tab, which is the correct blast radius for a Bearer.

const STORAGE_KEY = "gosleep.token";

/** Pull the Bearer, promoting the ?token= query param on first load. */
export function getBearer(): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.sessionStorage.getItem(STORAGE_KEY);
  if (stored !== null && stored.length > 0) return stored;

  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("token");
    if (q !== null && q.length > 0) {
      window.sessionStorage.setItem(STORAGE_KEY, q);
      url.searchParams.delete("token");
      window.history.replaceState(null, "", url.toString());
      return q;
    }
  } catch {
    // ignore malformed location
  }
  return null;
}

export function setBearer(token: string): void {
  window.sessionStorage.setItem(STORAGE_KEY, token);
}

export function clearBearer(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
}
