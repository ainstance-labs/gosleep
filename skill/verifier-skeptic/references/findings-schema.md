# Findings JSON schema — the `agentic-report-creator` handshake

`verifier-skeptic` prepares this JSON; `agentic-report-creator` renders it to an HTML dashboard. This
file is the coordination contract between the two skills. If `agentic-report-creator`'s own schema doc
has drifted from this, ITS version is authoritative — align to it and keep the fields it needs. Below is
the best-guess shape both skills should converge on.

## 1. Top-level object

```
{
  "meta":                <object>   // audit identity — required
  "verdict":             <object>   // headline score + counts — required
  "findings":            <array>    // the numbered findings — required, may be empty
  "architecture_notes":  <array>    // optional lane-1 narrative + diagrams
}
```

## 2. `meta` (required)

| Field           | Type   | Required | Notes                                                        |
|-----------------|--------|----------|-------------------------------------------------------------|
| `title`         | string | yes      | Human title, e.g. `"Suppliers V4 — pixel-perfect audit"`.   |
| `epic`          | string | yes      | Jira Epic key, e.g. `"TLM-360"`.                            |
| `date`          | string | yes      | ISO date `YYYY-MM-DD` (pass it in — do not fabricate).       |
| `auditor`       | string | yes      | `"verifier-skeptic"`.                                        |
| `shipped_at`    | string | no       | Commit SHA the audit ran against, e.g. `"6b680ff"`.         |
| `design_source` | string | no       | Prototype dir / Figma link / PRD path.                       |

## 3. `verdict` (required)

| Field    | Type   | Required | Notes                                                                       |
|----------|--------|----------|-----------------------------------------------------------------------------|
| `score`  | number | yes      | 0-100 overall fidelity score.                                               |
| `level`  | string | yes      | One of `SHIP-AS-IS`, `MINOR-POLISH`, `NEEDS-WORK`, `BLOCK`.                  |
| `counts` | object | yes      | `{ "critical": N, "major": N, "minor": N }` — must match the findings array.|

Scoring guidance (calibrate, do not over-engineer): start at 100, subtract per finding by severity
(CRITICAL ~10-15, MAJOR ~3-5, MINOR ~1), floor at 0. Two real reference points from live audits:
Print epic verdict `SHIP-AS-IS` at 91 (3 verified PRD traps + 5 minor); Suppliers V4 verdict
`MINOR-POLISH` at 73 (2 critical + 11 major + 7 minor). Map `level` to score bands:
`SHIP-AS-IS` ≥ 90, `MINOR-POLISH` 70-89, `NEEDS-WORK` 40-69, `BLOCK` < 40 or any unresolved CRITICAL.

## 4. `findings[]` (required array; each element)

| Field         | Type    | Required | Notes                                                                     |
|---------------|---------|----------|---------------------------------------------------------------------------|
| `number`      | integer | yes      | 1-based ordering index. NUMBERS ONLY — never a letter.                     |
| `jira`        | string  | yes      | The filed Jira Task key, e.g. `"TLM-432"`.                                |
| `severity`    | string  | yes      | `CRITICAL` \| `MAJOR` \| `MINOR`.                                          |
| `lane`        | string  | yes      | Primary lane: `architecture` \| `functionality` \| `design`.              |
| `area`        | string  | yes      | Feature area, e.g. `"Plan navigation"`.                                    |
| `labels`      | array   | yes      | Jira labels applied; MUST include `"verifier"`.                           |
| `title`       | string  | yes      | One-line summary (matches the Jira summary sans tags).                     |
| `description` | string  | yes      | Full deviation write-up (markdown ok).                                     |
| `design_ref`  | string  | yes      | Design source of truth: file:line or Figma frame.                         |
| `shipped_ref` | string  | yes      | Shipped code: file:line.                                                   |
| `technique`   | string  | no       | How the finding was produced: `pixelmatch` \| `playwright + manual` \| `manual`. |
| `repro`       | array   | no       | Ordered reproduction steps (functional findings).                         |
| `expected`    | string  | no       | Expected behaviour per design (functional findings).                       |
| `actual`      | string  | no       | Observed behaviour (functional findings).                                  |
| `screenshots` | array   | no*      | `{ "caption": string, "src": string }[]`. *Required for visual findings.  |
| `intentional` | boolean | no       | `true` if the deviation is documented in code — record but do NOT file a ticket. |

## 5. `architecture_notes[]` (optional)

| Field             | Type   | Required | Notes                                            |
|-------------------|--------|----------|--------------------------------------------------|
| `title`           | string | yes      | Short heading for the note.                       |
| `body`            | string | no       | Narrative markdown.                               |
| `diagram_mermaid` | string | no       | Mermaid source; the report renders it inline.     |

## 6. Complete worked example

```json
{
  "meta": {
    "title": "Suppliers V4 — pixel-perfect audit",
    "epic": "TLM-360",
    "date": "2026-07-15",
    "auditor": "verifier-skeptic",
    "shipped_at": "6b680ff",
    "design_source": "reference/prototype_v3/"
  },
  "verdict": {
    "score": 73,
    "level": "MINOR-POLISH",
    "counts": { "critical": 2, "major": 11, "minor": 7 }
  },
  "findings": [
    {
      "number": 1,
      "jira": "TLM-432",
      "severity": "CRITICAL",
      "lane": "functionality",
      "area": "Plan navigation",
      "labels": ["verifier", "functionality"],
      "title": "Stage-nav shell absent from suppliers layout",
      "description": "The prototype's Plan view wraps content in a 01-04 stage-nav rail that lets the user jump between plan stages. The shipped layout renders the content region only — the rail never mounts, so stages 02-04 are unreachable from the UI.",
      "design_ref": "reference/prototype_v3/suppliers-v4.jsx (Sv4Plan, lines 120-168)",
      "shipped_ref": "src/app/(app)/suppliers/plan/page.tsx:55-78",
      "technique": "playwright + manual",
      "repro": [
        "Sign in via e2e helper and seed a suppliers plan",
        "Navigate to /suppliers/plan",
        "Observe the header: no 01-04 rail; no way to reach stage 02"
      ],
      "expected": "01-04 stage rail visible in the Plan header; clicking a stage navigates to it.",
      "actual": "No rail rendered; stages 02-04 unreachable.",
      "screenshots": [
        { "caption": "Shipped Plan header — no rail", "src": "assets/plan-shipped-light.png" },
        { "caption": "Prototype Plan header — 01-04 rail visible", "src": "assets/plan-prototype-light.png" }
      ]
    },
    {
      "number": 2,
      "jira": "TLM-433",
      "severity": "MAJOR",
      "lane": "design",
      "area": "Plan header",
      "labels": ["verifier", "pixel-perfect"],
      "title": "Plan tab uses pill instead of prototype's rectangular tab",
      "description": "Prototype uses a rectangular tab with an 8px radius and a 2px bottom border on the active state. Shipped renders a fully-rounded pill (radius 9999px) with no bottom border. Measured: shipped borderRadius 9999px vs prototype 8px; active-state border absent.",
      "design_ref": "reference/prototype_v3/suppliers-v4.jsx (Sv4Tabs)",
      "shipped_ref": "src/app/(app)/suppliers/plan/_components/tabs.tsx:22-40",
      "technique": "pixelmatch",
      "screenshots": [
        { "caption": "Shipped pill tab", "src": "assets/tab-shipped-light.png" },
        { "caption": "Prototype rectangular tab", "src": "assets/tab-prototype-light.png" },
        { "caption": "pixelmatch diff (ratio 0.021)", "src": "assets/tab-diff-light.png" }
      ]
    }
  ],
  "architecture_notes": [
    {
      "title": "Plan stage state is not lifted to the URL",
      "body": "The prototype models stage as a URL segment (/suppliers/plan/[stage]) so a stage is linkable and survives reload. The shipped code holds stage in component state, which is why finding 1's rail has nowhere to navigate to.",
      "diagram_mermaid": "graph LR; URL[/plan/:stage/] --> Rail[stage rail] --> Content[stage content]; Shipped[useState stage] -.missing.-> Rail"
    }
  ]
}
```

## 7. Rules the renderer depends on

1. `number` is a plain integer sequence starting at 1 — never a letter, never `F1`.
2. `counts` in `verdict` must equal the tally of `findings[].severity`.
3. Every `findings[].labels` array includes `"verifier"`.
4. `intentional: true` findings appear in the report as accepted deviations and get NO Jira ticket —
   set `jira` to an empty string or omit it for those, and do not count them in `verdict.counts`.
5. `screenshots[].src` paths are relative to the report's asset directory; copy the captured PNGs there
   when handing off to `agentic-report-creator`, or pass absolute paths it can resolve.
