// @gosleep/web — question-option normalization helpers (GSL-371).
//
// The AskUserQuestion shim serialises a question's `options` field as
// unknown-typed JSON on the wire; the panel used to just render it into a
// display block (`QuestionOptions`) with no way to CLICK a variant. GSL-371
// makes those variants clickable — clicking a variant either prefills the
// Answer dialog or (in a dedicated button row inside the dialog) submits the
// chosen label straight through the answer path.
//
// This helper lives outside the React tree so it can be covered by a plain
// `bun test` unit test — the exact input shapes that arrive from the wire
// vary (some senders ship `[{label, description}]`, some ship
// `[{label, pros, cons}]`, some ship the raw string), and the coercion rules
// deserve their own tests independent of the DOM.

export interface NormalizedOption {
  label: string;
  description: string | null;
  pros: string[];
  cons: string[];
}

interface RawOption {
  label?: unknown;
  description?: unknown;
  pros?: unknown;
  cons?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function coerceStringList(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) out.push(item);
  }
  return out;
}

/**
 * Coerce an incoming `options` payload into a normalized `NormalizedOption[]`
 * array. Returns `null` when the payload cannot be represented as a clickable
 * variant list — callers should fall back to the free-text answer path.
 *
 * The rule set is intentionally forgiving: as long as every item has a
 * non-empty `label` string, we accept the payload. Missing pros/cons/
 * description → empty defaults. A bare string (`"pick this"`) or a
 * non-array payload → null (not clickable; the display component still shows
 * a JSON dump for observability).
 */
export function normalizeOptions(value: unknown): NormalizedOption[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return null;
  const out: NormalizedOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const raw = item as RawOption;
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (label.length === 0) return null;
    const description =
      typeof raw.description === "string" && raw.description.length > 0
        ? raw.description
        : null;
    out.push({
      label,
      description,
      pros: coerceStringList(raw.pros),
      cons: coerceStringList(raw.cons),
    });
  }
  return out;
}

/** True when the payload can be rendered as clickable variant buttons. */
export function hasClickableOptions(value: unknown): boolean {
  return normalizeOptions(value) !== null;
}
