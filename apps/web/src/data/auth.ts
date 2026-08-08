// @gosleep/web — Bearer discovery (GSL-265; GSL-291 setup-meta lane).
//
// The gosleep-core server accepts a Bearer at `Authorization: Bearer <secret>`. In dev we
// use the smoke override (GOSLEEP_BEARER_TOKEN — the CoreClient sees it via the URL that
// vite-proxy forwards). In prod the Bearer arrives via one of three lanes, tried in this
// order on first load:
//
//   1. `sessionStorage['gosleep.token']` — already stashed by an earlier load; the happy
//      path once /setup has run once in this tab.
//   2. `<meta name="gosleep-token" content="…">` — the /setup landing lane (GSL-291). The
//      core route serves the SPA shell with this meta tag ONLY after validating a one-shot
//      OTP; the tag never appears on any other route. We lift the value into sessionStorage
//      and REMOVE the tag from the DOM so a later inspection cannot read it.
//   3. `?token=<…>` — legacy URL-parameter lane. Same lift-and-strip discipline; kept for
//      backward compat with any bookmark that predates the meta lane.
//
// Local storage is intentionally NOT used — sessionStorage dies with the tab, which is the
// correct blast radius for a Bearer.

const STORAGE_KEY = "gosleep.token";
const META_NAME = "gosleep-token";

/** Pull the Bearer, promoting the /setup meta tag or the ?token= query on first load. */
export function getBearer(): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.sessionStorage.getItem(STORAGE_KEY);
  if (stored !== null && stored.length > 0) return stored;

  // GSL-291 — /setup meta lane. Consume EXACTLY once, then remove the tag from the DOM so
  // it does not linger for a later devtools "Elements" inspection to read.
  try {
    const meta = document.querySelector<HTMLMetaElement>(`meta[name="${META_NAME}"]`);
    if (meta !== null) {
      const val = meta.getAttribute("content") ?? "";
      if (val.length > 0) {
        window.sessionStorage.setItem(STORAGE_KEY, val);
        meta.remove();
        return val;
      }
      // Present but empty — treat as absent, still remove.
      meta.remove();
    }
  } catch {
    // ignore DOM inconsistencies (SSR, jsdom edge cases)
  }

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
