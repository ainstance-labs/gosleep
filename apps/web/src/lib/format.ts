// @gosleep/web — small formatters (GSL-265).

const REL_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** e.g. "3 minutes ago", "in 2 hours" — always human-relative, no client tz math. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.round((t - now) / 1000);
  const abs = Math.abs(deltaSec);
  for (const [unit, secondsInUnit] of REL_UNITS) {
    if (abs >= secondsInUnit || unit === "second") {
      const value = Math.round(deltaSec / secondsInUnit);
      return RTF.format(value, unit);
    }
  }
  return RTF.format(deltaSec, "second");
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** "12:34:56" — local hour/min/sec, safe for repeating timestamps in a list. */
export function timeOfDay(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return TIME_FMT.format(new Date(t));
}

/** e.g. "GSL-265" -> stable palette color hash for pill backgrounds. Deterministic. */
export function hashToHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function shortJson(v: unknown, cap = 120): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > cap ? `${s.slice(0, cap - 1)}…` : s;
}
