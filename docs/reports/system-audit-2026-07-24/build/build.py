#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Renders the GoSleep global orchestration-system audit dashboard (2026-07-24)
into two self-contained HTML pages:

    docs/reports/system-audit-2026-07-24/index.html      (English, primary)
    docs/reports/system-audit-2026-07-24/ru/index.html   (Russian)

Inputs
    payload.json    machine-readable synthesis of the audit (Russian source text)
    i18n-en.json    English strings keyed by payload path; missing keys fall back
                    to the Russian original and are reported as a build warning.

The pages link ../assets/styles.css and ../assets/app.js by relative path only —
no CDN, no external font, no network request of any kind.

Usage
    python3 build/build.py [--payload PATH]
"""

import argparse
import html
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, os.pardir))
DEFAULT_PAYLOAD = os.path.abspath(
    os.path.join(OUT, os.pardir, os.pardir, "reviews", "system-audit-2026-07-24", "report-payload.json")
)

MISSING = []          # i18n keys that fell back to Russian in the English page
CFG = {}              # figures.json — numbers a figure needs that the payload does not carry
SEVERITIES = ["CRITICAL", "MAJOR", "MINOR", "INFO", "WITHDRAWN", "RESOLVED"]
CYR = re.compile(r"[Ѐ-ӿ]")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def e(s):
    """Escape a data string for HTML text/attribute context."""
    return html.escape("" if s is None else str(s), quote=True)


def rich(s):
    """Escape, then promote «…» quotes and `code` spans; keep it conservative."""
    out = e(s)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    return out


STALE = []            # keys whose Russian source changed after the English was written


def src_hash(s):
    import hashlib
    return hashlib.sha1(("" if s is None else str(s)).encode("utf-8")).hexdigest()[:10]


class Loc(object):
    """Locale resolver. English reads the overlay; Russian reads the payload.

    An overlay value is either a plain string, or {"en": "...", "src": "<hash>"}.
    The hash form pins the English to the exact Russian it was translated from, so
    a later payload edit surfaces as a STALE warning instead of a silent mismatch.
    """

    def __init__(self, lang, overlay, chrome):
        self.lang = lang
        self.overlay = overlay
        self.chrome = chrome

    def t(self, key, ru_default):
        if self.lang == "ru":
            return ru_default
        val = self.overlay.get(key)
        if isinstance(val, dict):
            if val.get("src") and ru_default and val["src"] != src_hash(ru_default):
                STALE.append(key)
            val = val.get("en")
        if val is None or val == "":
            if ru_default:
                MISSING.append(key)
            return ru_default
        return val

    def c(self, key):
        """UI chrome string (section titles, labels)."""
        return self.chrome[self.lang].get(key, self.chrome["en"].get(key, key))


def band(pct):
    if pct is None:
        return "frozen"
    if pct >= 65:
        return "good"
    if pct >= 40:
        return "warning"
    return "critical"


CLAIMED_RE = re.compile(r"\bс\s+(CRITICAL|MAJOR|MINOR)\s+(?:до|на)\s+(CRITICAL|MAJOR|MINOR)\b")
CLAIMED_RE_EN = re.compile(r"\bfrom\s+(CRITICAL|MAJOR|MINOR)\s+to\s+(CRITICAL|MAJOR|MINOR)\b", re.I)


def claimed_severity(f):
    """Severity as originally filed by the auditor, when calibration moved it."""
    if f.get("severity_claimed"):
        return f["severity_claimed"]
    cal = f.get("calibration") or ""
    m = CLAIMED_RE.search(cal) or CLAIMED_RE_EN.search(cal)
    if m and m.group(1).upper() != f.get("severity"):
        return m.group(1).upper()
    return None


# --------------------------------------------------------------------------- #
# SVG helpers — every diagram is inline, theme-aware via CSS classes only
# --------------------------------------------------------------------------- #
def wrap(text, width):
    """Greedy word wrap for SVG <tspan> lines."""
    words, lines, cur = str(text).split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if len(trial) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def svg_text(x, y, s, cls="d-text-2", size=12, anchor="start", weight="400", lh=14, width=None, extra=""):
    if width is None:
        return ('<text x="%s" y="%s" class="%s" font-size="%s" font-weight="%s" '
                'text-anchor="%s"%s>%s</text>' % (x, y, cls, size, weight, anchor, extra, e(s)))
    lines = wrap(s, width)
    spans = "".join(
        '<tspan x="%s" dy="%s">%s</tspan>' % (x, 0 if i == 0 else lh, e(ln))
        for i, ln in enumerate(lines)
    )
    return ('<text x="%s" y="%s" class="%s" font-size="%s" font-weight="%s" '
            'text-anchor="%s"%s>%s</text>' % (x, y, cls, size, weight, anchor, extra, spans))


def figure(svg, caption, fid):
    return ('<figure class="figure" id="%s"><div class="fig-frame">%s</div>'
            '<figcaption>%s</figcaption></figure>' % (fid, svg, caption))


def fig_pillars(P, loc):
    """Horizontal readiness bars for the ten mandate pillars + the extra one."""
    rows = P["pillars"]
    row_h, top, left, barx, w = 34, 46, 0, 330, 440
    h = top + row_h * len(rows) + 18
    parts = ['<svg viewBox="0 0 840 %d" width="840" role="img" aria-label="%s">'
             % (h, e(loc.c("fig_pillars_alt")))]
    # axis
    for gx, lab in ((0, "0"), (0.25, "25"), (0.5, "50"), (0.75, "75"), (1.0, "100%")):
        x = barx + w * gx
        parts.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" class="d-stroke-soft" stroke-width="1"/>'
                     % (x, top - 16, x, h - 16))
        parts.append(svg_text(x, top - 22, lab, "d-text-3", 10, "middle"))
    for i, p in enumerate(rows):
        y = top + i * row_h
        pct = p.get("readiness_pct")
        b = band(pct)
        n = p["n"]
        label = "%s. %s" % (n, loc.t("pillars[%s].name" % n, p["name"]))
        if len(label) > 46:
            label = label[:44] + "…"
        parts.append(svg_text(barx - 12, y + 13, label, "d-text-2", 12, "end"))
        parts.append('<rect x="%d" y="%d" width="%d" height="12" rx="6" class="d-surface-3"/>'
                     % (barx, y + 3, w))
        if pct is None:
            parts.append('<rect x="%d" y="%d" width="%d" height="12" rx="6" class="d-neutral" opacity="0.30"/>'
                         % (barx, y + 3, w))
            parts.append(svg_text(barx + 10, y + 13, loc.c("frozen"), "d-text-3", 10.5, "start", "600"))
        else:
            parts.append('<rect x="%d" y="%d" width="%.1f" height="12" rx="6" class="d-%s"/>'
                         % (barx, y + 3, max(w * pct / 100.0, 3), "good" if b == "good" else ("warning" if b == "warning" else "critical")))
            parts.append(svg_text(barx + w + 10, y + 13, "%d%%" % pct, "d-text", 12, "start", "700"))
    parts.append('</svg>')
    return "".join(parts)


def fig_causes(P, loc):
    """Six root causes fanning out into the findings they explain."""
    rcs = P["root_causes"]
    box_h, gap, top, left, bw = 74, 14, 58, 8, 250
    h = top + (box_h + gap) * len(rcs) + 24
    parts = ['<svg viewBox="0 0 860 %d" width="860" role="img" aria-label="%s">'
             % (h, e(loc.c("fig_causes_alt")))]
    parts.append(svg_text(left + bw / 2, 26, loc.c("fig_causes_col1"), "d-text-3", 11, "middle", "700"))
    parts.append(svg_text(470, 26, loc.c("fig_causes_col2"), "d-text-3", 11, "middle", "700"))
    parts.append(svg_text(730, 26, loc.c("fig_causes_col3"), "d-text-3", 11, "middle", "700"))
    total = sum(r["finding_count"] for r in rcs)
    for i, r in enumerate(rcs):
        y = top + i * (box_h + gap)
        cls = "d-critical" if r["finding_count"] >= 12 else ("d-warning" if r["finding_count"] >= 6 else "d-accent")
        scls = cls + "-s"
        parts.append('<rect x="%d" y="%d" width="%d" height="%d" rx="9" class="d-surface" stroke-width="1" '
                     'style="stroke:currentColor" opacity="1"/>' % (left, y, bw, box_h))
        parts.append('<rect x="%d" y="%d" width="4" height="%d" rx="2" class="%s"/>' % (left, y, box_h, cls))
        parts.append(svg_text(left + 16, y + 21, r["id"], "d-accent", 12, "start", "700", extra=' class="mono"'))
        parts.append(svg_text(left + 44, y + 21, loc.t("root_causes[%s].title" % r["id"], r["title"]),
                              "d-text", 12, "start", "650", 13, 26))
        # fan: bar proportional to the number of findings
        bx, bw2 = 300, 300
        wpx = bw2 * r["finding_count"] / float(max(x["finding_count"] for x in rcs))
        parts.append('<path d="M %d %d L %d %d" class="%s" stroke-width="1.5" opacity="0.5" fill="none"/>'
                     % (left + bw, y + box_h / 2, bx - 6, y + box_h / 2, scls))
        parts.append('<rect x="%d" y="%d" width="%.1f" height="20" rx="10" class="%s" opacity="0.85"/>'
                     % (bx, y + box_h / 2 - 10, wpx, cls))
        parts.append(svg_text(bx + wpx + 9, y + box_h / 2 + 5,
                              loc.c("n_findings") % r["finding_count"], "d-text-2", 11.5, "start", "620"))
        # epic
        parts.append('<path d="M %d %d L %d %d" class="d-stroke" stroke-width="1" stroke-dasharray="3 3" fill="none"/>'
                     % (bx + bw2 + 12, y + box_h / 2, 690, y + box_h / 2))
        parts.append('<rect x="694" y="%d" width="150" height="26" rx="13" class="d-surface-3"/>' % (y + box_h / 2 - 13))
        parts.append(svg_text(769, y + box_h / 2 + 5, loc.c("epic_n") % r["epic"], "d-text-2", 11.5, "middle", "620"))
    parts.append(svg_text(430, h - 6, loc.c("fig_causes_foot") % (total, len(rcs)), "d-text-3", 11, "middle"))
    parts.append('</svg>')
    return "".join(parts)


def fig_supervision(loc):
    """Two panels: how supervision works today vs what the plan proposes."""
    L = loc.c
    W, H = 860, 430
    p = ['<svg viewBox="0 0 %d %d" width="%d" role="img" aria-label="%s">' % (W, H, W, e(L("fig_sup_alt")))]

    def panel(x0, title, tone):
        p.append('<rect x="%d" y="34" width="400" height="378" rx="12" class="d-surface" />' % x0)
        p.append('<rect x="%d" y="34" width="400" height="378" rx="12" fill="none" class="d-stroke" stroke-width="1"/>' % x0)
        p.append(svg_text(x0 + 200, 22, title, "d-" + tone, 12.5, "middle", "700"))

    def box(x, y, w, h, label, sub=None, cls="d-surface-3", tcls="d-text", dashed=False, size=12):
        p.append('<rect x="%d" y="%d" width="%d" height="%d" rx="9" class="%s" %s/>'
                 % (x, y, w, h, cls, 'stroke-dasharray="4 4"' if dashed else ""))
        p.append('<rect x="%d" y="%d" width="%d" height="%d" rx="9" fill="none" class="d-stroke" stroke-width="1" %s/>'
                 % (x, y, w, h, 'stroke-dasharray="4 4"' if dashed else ""))
        p.append(svg_text(x + w / 2, y + (h / 2 + 1 if not sub else h / 2 - 5), label, tcls, size, "middle", "620"))
        if sub:
            p.append(svg_text(x + w / 2, y + h / 2 + 13, sub, "d-text-3", 10.5, "middle"))

    def arrow(x1, y1, x2, y2, cls="d-stroke", dash=False):
        p.append('<path d="M %s %s L %s %s" class="%s" stroke-width="1.6" fill="none" %s marker-end="url(#ah)"/>'
                 % (x1, y1, x2, y2, cls, 'stroke-dasharray="4 4"' if dash else ""))

    p.append('<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" '
             'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="d-neutral"/></marker></defs>')

    # ---- LEFT: today ----
    panel(0, L("fig_sup_today"), "critical")
    box(120, 56, 160, 40, L("sup_owner"), None, "d-surface-3")
    arrow(200, 96, 200, 120)
    box(70, 120, 260, 58, L("sup_orch"), L("sup_orch_sub"), "d-surface-3")
    arrow(200, 178, 200, 202)
    box(70, 202, 260, 46, L("sup_pulse"), None, "d-surface-3")
    p.append('<path d="M 330 225 C 372 225 372 149 336 149" fill="none" class="d-critical-s" stroke-width="1.6" marker-end="url(#ah)"/>')
    p.append(svg_text(356, 262, L("sup_selfloop"), "d-critical", 10, "middle", "600"))
    box(70, 268, 260, 44, L("sup_watchdog"), L("sup_watchdog_sub"), "d-surface-3", "d-text-3", dashed=True)
    box(70, 326, 260, 44, L("sup_platform"), L("sup_platform_sub"), "d-surface-3", "d-text-3", dashed=True)
    p.append(svg_text(200, 394, L("fig_sup_today_note"), "d-critical", 11, "middle", "620"))

    # ---- RIGHT: proposed ----
    panel(460, L("fig_sup_prop"), "good")
    box(580, 56, 160, 40, L("sup_owner"))
    arrow(660, 96, 660, 116)
    box(496, 116, 172, 52, L("sup_tick"), L("sup_tick_sub"), "d-surface-3")
    box(688, 116, 152, 52, L("sup_status"), L("sup_status_sub"), "d-surface-3")
    arrow(582, 168, 582, 196)
    arrow(764, 168, 764, 196)
    box(496, 196, 344, 50, L("sup_ledger"), L("sup_ledger_sub"), "d-surface-3")
    arrow(668, 246, 668, 272)
    box(496, 272, 344, 46, L("sup_orch2"), None, "d-surface-3")
    arrow(496 + 60, 318, 496 + 60, 344)
    arrow(668, 318, 668, 344)
    arrow(780, 318, 780, 344)
    box(496, 344, 108, 40, L("sup_web"), None, "d-surface-3", size=11)
    box(614, 344, 108, 40, L("sup_escalate"), None, "d-surface-3", size=11)
    box(732, 344, 108, 40, L("sup_breaker"), None, "d-surface-3", size=11)
    p.append(svg_text(668, 402, L("fig_sup_prop_note"), "d-good", 11, "middle", "620"))
    p.append('</svg>')
    return "".join(p)


def fig_plan(P, loc):
    """Epics laid out on a coarse time axis: today -> days -> weeks."""
    eps = P["epics"]
    lanes = {1: (0, 1.0), 2: (0.5, 2.2), 3: (1.0, 3.0), 4: (1.2, 5.6), 5: (3.0, 5.2),
             6: (2.0, 4.0), 7: (4.2, 6.0), 8: (2.6, 5.0)}
    W, left, right = 980, 300, 810
    row_h, top = 40, 62
    h = top + row_h * len(eps) + 34
    span = right - left
    p = ['<svg viewBox="0 0 %d %d" width="%d" role="img" aria-label="%s">' % (W, h, W, e(loc.c("fig_plan_alt")))]
    marks = [(0, loc.c("t_today")), (1.0, loc.c("t_days")), (3.0, loc.c("t_week")), (6.0, loc.c("t_weeks"))]
    for v, lab in marks:
        x = left + span * v / 6.0
        p.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" class="d-stroke-soft" stroke-width="1" stroke-dasharray="2 4"/>'
                 % (x, top - 14, x, h - 26))
        p.append(svg_text(x, top - 22, lab, "d-text-3", 10.5, "middle"))
    for i, ep in enumerate(eps):
        y = top + i * row_h
        n = ep["n"]
        a, b = lanes.get(n, (0, 2))
        x1 = left + span * a / 6.0
        x2 = left + span * b / 6.0
        prio = ep.get("priority")
        cls = "d-critical" if not isinstance(prio, int) else ("d-accent" if prio <= 3 else "d-neutral")
        title = loc.t("epics[%s].title" % n, ep["title"])
        if len(title) > 34:
            title = title[:32] + "…"
        p.append(svg_text(left - 14, y + 17, "%d. %s" % (n, title), "d-text-2", 11.5, "end"))
        p.append('<rect x="%.1f" y="%d" width="%.1f" height="20" rx="10" class="%s" opacity="0.9"/>'
                 % (x1, y + 3, max(x2 - x1, 14), cls))
        p.append(svg_text(x2 + 8, y + 17, "%s · %s" % (ep.get("size", "?"),
                                                       loc.c("n_findings") % len(ep.get("findings", []))),
                          "d-text-3", 10.5, "start"))
    p.append(svg_text(W / 2, h - 8, loc.c("fig_plan_foot"), "d-text-3", 11, "middle"))
    p.append('</svg>')
    return "".join(p)


def fig_calibration(P, loc, cfg):
    """How many CRITICAL labels were claimed, and how many survived review."""
    downgraded = [f for f in P["findings"] if claimed_severity(f) == "CRITICAL"]
    kept = [f for f in P["findings"] if f["severity"] == "CRITICAL"]
    claimed = cfg.get("critical_claimed") or (len(downgraded) + len(kept))
    W, H = 820, 216
    p = ['<svg viewBox="0 0 %d %d" width="%d" role="img" aria-label="%s">' % (W, H, W, e(loc.c("fig_cal_alt")))]
    # left block: claimed
    p.append('<rect x="20" y="52" width="200" height="120" rx="12" class="d-critical" opacity="0.16"/>')
    p.append('<rect x="20" y="52" width="200" height="120" rx="12" fill="none" class="d-critical-s" stroke-width="1.5"/>')
    p.append(svg_text(120, 44, loc.c("cal_claimed"), "d-text-3", 11, "middle", "700"))
    p.append(svg_text(120, 116, str(claimed), "d-critical", 46, "middle", "740"))
    p.append(svg_text(120, 146, "CRITICAL", "d-text-2", 12, "middle", "660"))
    # middle: three red teams
    for i, lab in enumerate([loc.c("cal_rt1"), loc.c("cal_rt2"), loc.c("cal_rt3")]):
        y = 56 + i * 40
        p.append('<rect x="270" y="%d" width="250" height="32" rx="8" class="d-surface-3"/>' % y)
        p.append('<rect x="270" y="%d" width="250" height="32" rx="8" fill="none" class="d-stroke" stroke-width="1"/>' % y)
        p.append(svg_text(395, y + 21, lab, "d-text-2", 11.5, "middle", "600"))
    p.append('<path d="M 224 112 L 264 112" class="d-neutral-s" stroke-width="1.6" marker-end="url(#ah2)"/>')
    p.append('<path d="M 524 112 L 566 112" class="d-neutral-s" stroke-width="1.6" marker-end="url(#ah2)"/>')
    p.append('<defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" '
             'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="d-neutral"/></marker></defs>')
    # right: survivors
    p.append('<rect x="572" y="52" width="228" height="120" rx="12" class="d-good" opacity="0.13"/>')
    p.append('<rect x="572" y="52" width="228" height="120" rx="12" fill="none" class="d-good-s" stroke-width="1.5"/>')
    p.append(svg_text(686, 44, loc.c("cal_kept"), "d-text-3", 11, "middle", "700"))
    p.append(svg_text(686, 116, str(len(kept)), "d-good", 46, "middle", "740"))
    p.append(svg_text(686, 146, "CRITICAL", "d-text-2", 12, "middle", "660"))
    p.append(svg_text(W / 2, 200, loc.c("fig_cal_foot") % (claimed - len(kept), claimed), "d-text-3", 11, "middle"))
    p.append('</svg>')
    return "".join(p)


# --------------------------------------------------------------------------- #
# chrome strings
# --------------------------------------------------------------------------- #
CHROME = {
    "en": {
        "doc_title": "GoSleep — global audit of the orchestration system",
        "nav_verdict": "Verdict", "nav_primer": "Primer", "nav_pillars": "Pillars",
        "nav_causes": "Root causes", "nav_supervision": "Supervision", "nav_findings": "Findings",
        "nav_plan": "Plan", "nav_questions": "Your decisions", "nav_redteam": "Red team",
        "nav_metrics": "Metrics", "nav_borrow": "Borrowings",
        "skip": "Skip to content", "theme": "Theme",
        "sec": "Section %d",
        "h_verdict": "Where the system actually stands",
        "l_verdict": "One screen: the honest state of the system, the number that matters most, and what to do first.",
        "h_primer": "How to read this report",
        "l_primer": "What was audited, how, and a plain-language primer on every technical term used below. Nothing further in this report assumes you remember any of it.",
        "h_pillars": "The ten pillars of the mandate",
        "l_pillars": "Your original brief asked for ten things. Each one is scored on a single question: does it work today, on this machine, without a human standing over it?",
        "h_causes": "Root causes — why so many findings, so few diseases",
        "l_causes": "Ninety-three findings are not ninety-three problems. Six causes explain most of them; fix a cause and its whole family of symptoms closes at once.",
        "h_supervision": "Who watches the orchestrator — today and as proposed",
        "l_supervision": "The gap your mandate opens with, drawn as a picture, plus what the platform now gives us for free and what it still refuses to give.",
        "h_findings": "Findings",
        "l_findings": "All findings, continuously numbered. Severity shown is the calibrated one; where a red team or the synthesiser moved it, the auditor's original label is shown struck through beside it.",
        "h_plan": "The plan",
        "l_plan": "Eight epics in priority order. Each says what it buys you, what it costs, and which findings it closes.",
        "h_questions": "Decisions waiting for you",
        "l_questions": "Eight forks the audit deliberately did not take on your behalf. Each has a recommended option and the reasoning behind it.",
        "h_redteam": "What the red teams withdrew",
        "l_redteam": "Three independent adversarial passes tried to break every finding. This is what did not survive — the part of the method that keeps the rest trustworthy.",
        "h_metrics": "Metrics to steer by",
        "l_metrics": "Today's value against the target, and the epic that moves it.",
        "h_borrow": "What to borrow, what to keep",
        "l_borrow": "Twelve concrete mechanisms worth taking from rival orchestrators, and five things we already do better than all of them.",
        "readiness_product": "As a product",
        "readiness_product_t": "“The owner goes to sleep, the system delivers”",
        "readiness_research": "As research",
        "readiness_research_t": "Investigation, documentation, reports",
        "hardest": "The hardest fact",
        "flagship": "Flagship metric",
        "counts_total": "Total",
        "do_first": "Do first",
        "sources_h": "What went into this audit",
        "caveats_h": "Honest limits of this audit",
        "src_file": "Report", "src_zone": "Zone", "src_findings": "Findings", "src_rt": "Red-teamed",
        "yes": "yes", "no": "no",
        "verdict_k": "Verdict", "evidence_k": "Evidence", "blocker_k": "What blocks it",
        "means_k": "What it means", "rec_k": "Recommendation", "calib_k": "Calibration",
        "epics_k": "Epics", "closes_k": "Closes findings", "cure_k": "Cure",
        "why_k": "Why", "tasks_k": "Tasks", "sees_k": "You will see", "done_k": "Done when",
        "size_k": "Size", "dep_k": "Depends on", "risk_k": "Risks", "source_k": "Source",
        "claimed_by_auditor": "auditor filed",
        "rank_k": "Why it ranks here",
        "already_done_h": "Already closed while the audit was still running",
        "raised_h": "What the red teams raised",
        "th_move": "Moved",
        "filter_sev": "Severity", "filter_zone": "Zone", "filter_more": "Epic",
        "search_ph": "Search findings…", "shown": "shown", "reset": "Reset",
        "no_results": "No finding matches these filters.",
        "frozen": "frozen",
        "n_findings": "%d findings",
        "epic_n": "Epic %s",
        "pillar_n": "Pillar %s",
        "not_in_plan_h": "Deliberately not in the plan",
        "platform_gives": "What the platform now gives us",
        "platform_denies": "What it still does not give",
        "platform_devalues": "What this devalues in our own code",
        "confirmed_h": "Confirmed by independent auditors",
        "withdrawn_h": "Claims withdrawn under adversarial review",
        "th_claim": "Claim as filed", "th_actual": "What is actually true",
        "th_fact": "Fact", "th_conf": "Confirmations", "th_src": "Sources",
        "th_metric": "Metric", "th_today": "Today", "th_target": "Target", "th_epic": "Epic",
        "th_what": "Mechanism", "th_from": "From", "th_why": "Why it is worth taking",
        "strengths_h": "Ours to preserve — nobody else has these",
        "footer_gen": "Generated by",
        "footer_src": "Source payload",
        "sub_fork": "Sub-decision",
        "channels_nuance": "A nuance worth separating",
        "why_rec": "Why this one",
        "recommended": "recommended",
        "step": "Step",
        "lang_switch_label": "Switch to Russian",
        "term_h": "Every technical term in this report, in one place",
        "term_note": "Each entry answers the same question: what is this thing, and why does it appear in an audit of a system that is supposed to work while you sleep.",
        "fig_pillars_alt": "Bar chart of readiness per mandate pillar",
        "fig_causes_alt": "Diagram linking each root cause to the findings it explains",
        "fig_causes_col1": "Root cause", "fig_causes_col2": "Findings it explains", "fig_causes_col3": "Cured by",
        "fig_causes_foot": "%d finding-links across %d causes — the same finding can belong to more than one cause",
        "fig_sup_alt": "Supervision architecture today versus proposed",
        "fig_sup_today": "TODAY", "fig_sup_prop": "PROPOSED",
        "sup_owner": "Owner (awake)", "sup_orch": "Orchestrator (LLM session)",
        "sup_orch_sub": "starts workers, writes state", "sup_pulse": "Self-pulse every 5–10 min",
        "sup_selfloop": "reports on itself", "sup_watchdog": "Watchdog (built, never armed)",
        "sup_watchdog_sub": "no launchd job, no cron entry", "sup_platform": "Platform supervisor",
        "sup_platform_sub": "on demand only, dies with last client",
        "fig_sup_today_note": "Nothing outside the LLM observes the LLM",
        "sup_tick": "Machine tick (launchd)", "sup_tick_sub": "idempotent, off-LLM",
        "sup_status": "claude agents --json", "sup_status_sub": "status from the harness",
        "sup_ledger": "One ledger + armed-check", "sup_ledger_sub": "single visible point of failure",
        "sup_orch2": "Orchestrator (LLM session)",
        "sup_web": "Live web console", "sup_escalate": "Escalate to owner", "sup_breaker": "Circuit breaker",
        "fig_sup_prop_note": "The source of truth about liveness sits outside the model",
        "fig_plan_alt": "Timeline of the eight plan epics",
        "t_today": "today", "t_days": "days", "t_week": "≈1 week", "t_weeks": "2–3 weeks",
        "fig_plan_foot": "Bars show sequencing, not committed dates — sizes are S/M/L estimates from the plan",
        "fig_cal_alt": "How many CRITICAL labels survived adversarial review",
        "cal_claimed": "FILED BY AUDITORS", "cal_kept": "SURVIVED CALIBRATION",
        "cal_rt1": "Red team 1 — supervision & delivery",
        "cal_rt2": "Red team 2 — web & platform",
        "cal_rt3": "Red team 3 — skills",
        "fig_cal_foot": "%d of %d CRITICAL labels were downgraded; each downgrade is named in the finding that carries it",
    },
    "ru": {
        "doc_title": "GoSleep — глобальный аудит системы оркестрации",
        "nav_verdict": "Итог", "nav_primer": "Введение", "nav_pillars": "Столпы",
        "nav_causes": "Корневые причины", "nav_supervision": "Супервизия", "nav_findings": "Находки",
        "nav_plan": "План", "nav_questions": "Ваши решения", "nav_redteam": "Красные команды",
        "nav_metrics": "Метрики", "nav_borrow": "Заимствования",
        "skip": "Перейти к содержанию", "theme": "Тема",
        "sec": "Раздел %d",
        "h_verdict": "В каком состоянии система на самом деле",
        "l_verdict": "Один экран: честное состояние системы, самая важная цифра и что делать первым.",
        "h_primer": "Как читать этот отчёт",
        "l_primer": "Что проверяли, как проверяли, и объяснение простыми словами каждого технического термина, который встретится ниже. Дальше отчёт нигде не рассчитывает, что вы это помните.",
        "h_pillars": "Десять столпов мандата",
        "l_pillars": "В исходном задании вы просили десять вещей. Каждая оценена по одному вопросу: работает ли это сегодня, на этой машине, без человека рядом.",
        "h_causes": "Корневые причины — почему находок много, а болезней мало",
        "l_causes": "Девяносто три находки — это не девяносто три проблемы. Шесть причин объясняют большую часть; вылечив причину, закрываешь сразу целое семейство симптомов.",
        "h_supervision": "Кто присматривает за оркестратором — сегодня и как предлагается",
        "l_supervision": "Дыра, с которой начинается ваш мандат, нарисованная картинкой, плюс то, что платформа теперь отдаёт бесплатно, и то, чего она по-прежнему не даёт.",
        "h_findings": "Находки",
        "l_findings": "Все находки со сквозной нумерацией. Показана откалиброванная серьёзность; там, где красная команда или синтезатор её изменили, рядом зачёркнута исходная метка аудитора.",
        "h_plan": "План",
        "l_plan": "Восемь эпиков в порядке приоритета. У каждого сказано, что он даёт, во что обойдётся и какие находки закрывает.",
        "h_questions": "Решения, которые ждут вас",
        "l_questions": "Восемь развилок, которые аудит сознательно не стал проходить за вас. У каждой есть рекомендованный вариант и обоснование.",
        "h_redteam": "Что опровергли красные команды",
        "l_redteam": "Три независимых адверсариальных прохода пытались сломать каждую находку. Здесь то, что не устояло, — та часть метода, которая делает остальное достойным доверия.",
        "h_metrics": "Метрики, по которым рулить",
        "l_metrics": "Сегодняшнее значение против целевого и эпик, который его двигает.",
        "h_borrow": "Что заимствовать, что беречь",
        "l_borrow": "Двенадцать конкретных механизмов, которые стоит взять у чужих оркестраторов, и пять вещей, которые мы уже делаем лучше всех четверых.",
        "readiness_product": "Как продукт",
        "readiness_product_t": "«Владелец уходит спать, система доставляет»",
        "readiness_research": "Как исследование",
        "readiness_research_t": "Разведка, документация, отчёты",
        "hardest": "Самый жёсткий факт",
        "flagship": "Флагманская метрика",
        "counts_total": "Всего",
        "do_first": "Делать первым",
        "sources_h": "Из чего собран этот аудит",
        "caveats_h": "Честные границы этого аудита",
        "src_file": "Отчёт", "src_zone": "Зона", "src_findings": "Находок", "src_rt": "Проверен красной командой",
        "yes": "да", "no": "нет",
        "verdict_k": "Вердикт", "evidence_k": "Доказательство", "blocker_k": "Что мешает",
        "means_k": "Что это значит", "rec_k": "Рекомендация", "calib_k": "Калибровка",
        "epics_k": "Эпики", "closes_k": "Закрывает находки", "cure_k": "Лечение",
        "why_k": "Зачем", "tasks_k": "Задачи", "sees_k": "Вы увидите", "done_k": "Готово, когда",
        "size_k": "Размер", "dep_k": "Зависит от", "risk_k": "Риски", "source_k": "Источник",
        "claimed_by_auditor": "аудитор заявил",
        "rank_k": "Почему такое место",
        "already_done_h": "Уже закрыто, пока аудит ещё шёл",
        "raised_h": "Что красные команды подняли",
        "th_move": "Сдвиг",
        "filter_sev": "Серьёзность", "filter_zone": "Зона", "filter_more": "Эпик",
        "search_ph": "Поиск по находкам…", "shown": "показано", "reset": "Сбросить",
        "no_results": "Ни одна находка не подходит под эти фильтры.",
        "frozen": "заморожено",
        "n_findings": "находок: %d",
        "epic_n": "Эпик %s",
        "pillar_n": "Столп %s",
        "not_in_plan_h": "Сознательно не вошло в план",
        "platform_gives": "Что платформа теперь даёт нам",
        "platform_denies": "Чего она по-прежнему не даёт",
        "platform_devalues": "Что это обесценивает в нашем собственном коде",
        "confirmed_h": "Подтверждено независимыми аудиторами",
        "withdrawn_h": "Утверждения, отозванные после адверсариальной проверки",
        "th_claim": "Как было заявлено", "th_actual": "Как на самом деле",
        "th_fact": "Факт", "th_conf": "Подтверждений", "th_src": "Источники",
        "th_metric": "Метрика", "th_today": "Сегодня", "th_target": "Цель", "th_epic": "Эпик",
        "th_what": "Механизм", "th_from": "Откуда", "th_why": "Почему стоит взять",
        "strengths_h": "Наше, что нужно сберечь, — этого нет ни у кого",
        "footer_gen": "Собрано",
        "footer_src": "Исходный payload",
        "sub_fork": "Под-развилка",
        "channels_nuance": "Нюанс, который надо разделить",
        "why_rec": "Почему этот вариант",
        "recommended": "рекомендуется",
        "step": "Шаг",
        "lang_switch_label": "Переключиться на английский",
        "term_h": "Все технические термины отчёта в одном месте",
        "term_note": "Каждая статья отвечает на один и тот же вопрос: что это такое и почему оно вообще всплывает в аудите системы, которая должна работать, пока вы спите.",
        "fig_pillars_alt": "Столбчатая диаграмма готовности по столпам мандата",
        "fig_causes_alt": "Схема связи каждой корневой причины с находками, которые она объясняет",
        "fig_causes_col1": "Корневая причина", "fig_causes_col2": "Сколько находок объясняет", "fig_causes_col3": "Чем лечится",
        "fig_causes_foot": "%d связей «причина — находка» на %d причин: одна находка может принадлежать нескольким причинам",
        "fig_sup_alt": "Устройство супервизии сегодня и как предлагается",
        "fig_sup_today": "СЕГОДНЯ", "fig_sup_prop": "ПРЕДЛАГАЕТСЯ",
        "sup_owner": "Владелец (бодрствует)", "sup_orch": "Оркестратор (сессия LLM)",
        "sup_orch_sub": "запускает воркеров, пишет состояние", "sup_pulse": "Самопульс каждые 5–10 минут",
        "sup_selfloop": "отчитывается сам о себе", "sup_watchdog": "Сторож (написан, не вооружён)",
        "sup_watchdog_sub": "нет задания launchd, нет записи в cron", "sup_platform": "Супервизор платформы",
        "sup_platform_sub": "только по требованию, умирает с последним клиентом",
        "fig_sup_today_note": "Ничто вне LLM не наблюдает за LLM",
        "sup_tick": "Машинный тик (launchd)", "sup_tick_sub": "идемпотентный, вне LLM",
        "sup_status": "claude agents --json", "sup_status_sub": "статус от харнесса",
        "sup_ledger": "Один леджер + armed-check", "sup_ledger_sub": "одна видимая точка отказа",
        "sup_orch2": "Оркестратор (сессия LLM)",
        "sup_web": "Живой веб-пульт", "sup_escalate": "Эскалация владельцу", "sup_breaker": "Circuit breaker",
        "fig_sup_prop_note": "Источник правды о жизни системы лежит вне модели",
        "fig_plan_alt": "Временная шкала восьми эпиков плана",
        "t_today": "сегодня", "t_days": "дни", "t_week": "≈1 неделя", "t_weeks": "2–3 недели",
        "fig_plan_foot": "Полосы показывают последовательность, а не обещанные даты; размеры S/M/L — оценки из плана",
        "fig_cal_alt": "Сколько меток CRITICAL пережило адверсариальную проверку",
        "cal_claimed": "ЗАЯВЛЕНО АУДИТОРАМИ", "cal_kept": "ПЕРЕЖИЛО КАЛИБРОВКУ",
        "cal_rt1": "Красная команда 1 — супервизия и доставка",
        "cal_rt2": "Красная команда 2 — веб и платформа",
        "cal_rt3": "Красная команда 3 — скиллы",
        "fig_cal_foot": "%d из %d меток CRITICAL понижены; каждое понижение названо в самой находке",
    },
}

# Pillar 'extra' and 'процесс' are group labels, not numbers — localise the visible chip.
PILLAR_LABELS = {
    "en": {"extra": "skills", "процесс": "process"},
    "ru": {"extra": "extra", "процесс": "процесс"},
}

# Source citations are semi-identifiers; the English page renders their Russian
# connective words in English. Applied longest-first so phrases win over words.
SOURCE_PHRASES = [
    ("синтез: все семь отчётов", "synthesis: all seven reports"),
    ("синтезатор", "synthesiser"),
    ("синтез: методология аудита", "synthesis: audit methodology"),
    ("синтез трёх калибровок", "synthesis of three calibrations"),
    ("слепая зона", "blind zone"),
    ("синтез", "synthesis"),
    ("разбор", "analysis"),
    ("раздел", "section"),
    ("класс", "class"),
]


def loc_source(src, lang):
    if lang != "en" or not src:
        return src
    for ru, en in SOURCE_PHRASES:
        src = src.replace(ru, en)
    return src


ZONE_LABELS = {
    "en": {"WEB": "Web console", "SKL": "Skills", "AUT": "Autonomy & lab", "DEL": "Delivery & PRD",
           "SUP": "Supervision", "SYN": "Synthesis", "RED": "Red team"},
    "ru": {"WEB": "Веб-версия", "SKL": "Скиллы", "AUT": "Автономность и лаборатория",
           "DEL": "Доставка и PRD", "SUP": "Супервизия", "SYN": "Синтез", "RED": "Красная команда"},
}


def load_terms():
    with open(os.path.join(HERE, "terms.json"), "r", encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------- #
# section renderers
# --------------------------------------------------------------------------- #
def sec_head(n, loc, hkey, lkey, anchor, tag="h2"):
    return ('<div class="section-head"><p class="section-title">'
            '<span class="sec-n">%s</span></p><%s id="%s-h">%s</%s>'
            '<p class="section-lede">%s</p></div>'
            % (e(loc.c("sec") % n), tag, anchor, e(loc.c(hkey)), tag, e(loc.c(lkey))))


def render_verdict(P, loc):
    hd = P["headline"]
    fm = P.get("flagship_metric", {})
    prod = hd["overall_readiness_pct"]
    research = P.get("research_readiness_pct", 72)
    counts = [("CRITICAL", hd["critical_count"]), ("MAJOR", hd["major_count"]),
              ("MINOR", hd["minor_count"]), ("INFO", hd["info_count"])]
    for key, lab in (("withdrawn_count", "WITHDRAWN"), ("resolved_count", "RESOLVED")):
        if hd.get(key):
            counts.append((lab, hd[key]))
    total = hd["total_findings"]

    def ring(pct, b):
        return ('<div class="ring"><svg viewBox="0 0 118 118" aria-hidden="true">'
                '<circle class="track" cx="59" cy="59" r="50"/>'
                '<circle class="value" cx="59" cy="59" r="50"/></svg>'
                '<span class="num"><b>%d</b><span>%%</span></span></div>' % pct)

    out = ['<div class="card hero">']
    out.append('<p class="hero-lede">%s</p>' % rich(loc.t("headline.one_liner", hd["one_liner"])))
    out.append('<div class="dual-gauge">')
    out.append('<div class="gauge" data-band="%s" style="--score:%d">%s'
               '<div class="g-body"><div class="g-k">%s</div><div class="g-t">%s</div>'
               '<div class="g-d">%s</div></div></div>'
               % (band(prod), prod, ring(prod, band(prod)), e(loc.c("readiness_product")),
                  e(loc.c("readiness_product_t")), e(loc.t("headline.product_gloss", P.get("product_gloss",
                     "Каждый механизм, который должен работать без человека, либо не включён, либо живёт внутри пульса LLM.")))))
    out.append('<div class="gauge" data-band="%s" style="--score:%d">%s'
               '<div class="g-body"><div class="g-k">%s</div><div class="g-t">%s</div>'
               '<div class="g-d">%s</div></div></div>'
               % (band(research), research, ring(research, band(research)), e(loc.c("readiness_research")),
                  e(loc.c("readiness_research_t")), e(loc.t("headline.research_gloss", P.get("research_gloss",
                     "Разведка глубокая и честная; отчёты самодостаточны. Слабое место — они не знают сегодняшнего дня.")))))
    out.append('</div>')

    out.append('<div class="callout"><div class="c-k">%s</div><p>%s</p></div>'
               % (e(loc.c("hardest")), rich(loc.t("headline.hardest_fact", hd["hardest_fact"]))))

    out.append('<div class="counts">')
    for k, v in counts:
        out.append('<div class="count-tile" data-severity="%s"><span class="n">%d</span>'
                   '<span class="k">%s</span></div>' % (k, v, k))
    out.append('<div class="count-tile"><span class="n">%d</span><span class="k">%s</span></div>'
               % (total, e(loc.c("counts_total"))))
    out.append('</div>')
    hue = {"CRITICAL": "critical", "MAJOR": "warning", "MINOR": "neutral",
           "INFO": "accent", "WITHDRAWN": "text-3", "RESOLVED": "good"}
    segs = "".join('<span style="width:%.2f%%;background:var(--%s)"></span>'
                   % (100.0 * v / total, hue.get(k, "neutral"))
                   for k, v in counts if v)
    out.append('<div class="dist">%s</div>' % segs)
    out.append('<div class="dist-legend">%s</div>' % "".join(
        '<span><i style="background:var(--%s)"></i>%s %d</span>' % (hue.get(k, "neutral"), k, v)
        for k, v in counts))
    out.append('<p class="tiny muted" style="margin:10px 0 0">%s</p>'
               % rich(loc.t("headline.note_on_counts", hd["note_on_counts"])))

    if fm:
        out.append('<div class="callout neutral" style="margin:22px 0 0"><div class="c-k">%s — %s: %s</div>'
                   '<p>%s</p></div>'
                   % (e(loc.c("flagship")), e(loc.t("flagship_metric.name", fm.get("name", ""))),
                      e(fm.get("today", "")), rich(loc.t("flagship_metric.rationale", fm.get("rationale", "")))))
    out.append('</div>')

    out.append('<div class="card card-pad" style="margin-top:16px">')
    out.append('<p class="section-title" style="margin-bottom:12px">%s</p>' % e(loc.c("do_first")))
    out.append('<ol class="actions">')
    for i, a in enumerate(hd["top_actions"]):
        out.append('<li>%s</li>' % rich(loc.t("headline.top_actions[%d]" % i, a)))
    out.append('</ol></div>')

    done = P.get("already_done") or []
    if done:
        out.append('<div class="card card-pad" style="margin-top:16px">')
        out.append('<p class="section-title" style="margin-bottom:12px">%s</p>' % e(loc.c("already_done_h")))
        out.append('<ul class="plainlist pos">')
        for i, d in enumerate(done):
            tail = ""
            if d.get("evidence"):
                tail = '<br><span class="tiny muted">%s</span>' % rich(
                    loc.t("already_done[%d].evidence" % i, d["evidence"]))
            out.append('<li><b>%s</b>%s</li>'
                       % (rich(loc.t("already_done[%d].what" % i, d["what"])), tail))
        out.append('</ul></div>')
    return "".join(out)


def render_primer(P, loc, terms):
    au = P["audit"]
    out = ['<div class="grid grid-2">']
    # what the audit was
    out.append('<div class="card card-pad"><p class="section-title">%s</p><div class="table-wrap" '
               'style="border:0;box-shadow:none"><table style="min-width:0"><thead><tr>'
               '<th>%s</th><th>%s</th><th class="num">%s</th><th class="num">%s</th></tr></thead><tbody>'
               % (e(loc.c("sources_h")), e(loc.c("src_file")), e(loc.c("src_zone")),
                  e(loc.c("src_findings")), e(loc.c("src_rt"))))
    for i, s in enumerate(au["sources"]):
        rt = s.get("calibrated_by_redteam")
        rtl = "—" if rt is None else (loc.c("yes") if rt else loc.c("no"))
        out.append('<tr><td class="mono">%s</td><td>%s</td><td class="num">%s</td>'
                   '<td class="num">%s</td></tr>'
                   % (e(s["file"]), e(loc.t("audit.sources[%d].zone" % i, s["zone"])),
                      e(s.get("findings", "—") or "—"), e(rtl)))
    out.append('</tbody></table></div></div>')
    # caveats
    out.append('<div class="card card-pad"><p class="section-title">%s</p><ul class="plainlist">'
               % e(loc.c("caveats_h")))
    for i, c in enumerate(au["caveats"]):
        out.append('<li>%s</li>' % rich(loc.t("audit.caveats[%d]" % i, c)))
    out.append('</ul></div></div>')

    # glossary
    out.append('<details class="disclosure" open style="margin-top:16px"><summary>%s</summary>'
               '<div class="disclosure-body"><p class="tiny muted" style="margin:0 0 14px">%s</p>'
               '<div class="terms">' % (e(loc.c("term_h")), e(loc.c("term_note"))))
    for t in terms:
        out.append('<dl class="term"><dt>%s</dt><dd>%s</dd></dl>'
                   % (rich(t["term_" + loc.lang]), rich(t["def_" + loc.lang])))
    out.append('</div></div></details>')
    return "".join(out)


def render_pillars(P, loc):
    out = [figure(fig_pillars(P, loc), e(loc.c("fig_pillars_alt")), "fig-pillars")]
    out.append('<div class="pillars">')
    for p in P["pillars"]:
        n = p["n"]
        pct = p.get("readiness_pct")
        b = band(pct)
        out.append('<article class="card pillar" id="pillar-%s">' % e(n))
        out.append('<div class="pillar-head"><span class="pillar-n">%s</span>'
                   '<span class="pillar-name">%s</span>'
                   % (e(PILLAR_LABELS[loc.lang].get(str(n), n)),
                      e(loc.t("pillars[%s].name" % n, p["name"]))))
        if pct is None:
            out.append('<span class="pillar-pct b-frozen">%s</span>'
                       % e(loc.t("pillars[%s].readiness_label" % n, p.get("readiness_label", loc.c("frozen")))))
        else:
            out.append('<span class="pillar-pct b-%s">%d%%</span>' % (b, pct))
        out.append('</div>')
        out.append('<div class="pillar-bar"><i class="b-%s" style="width:%s"></i></div>'
                   % (b, "100%" if pct is None else "%d%%" % pct))
        out.append('<div class="pillar-rows">')
        for key, ck, cls in (("verdict", "verdict_k", "verdict"), ("evidence", "evidence_k", ""),
                             ("blocker", "blocker_k", ""), ("means", "means_k", "means")):
            val = p.get(key)
            if not val:
                continue
            out.append('<div class="prow %s"><span class="pk">%s</span><span class="pv">%s</span></div>'
                       % (cls, e(loc.c(ck)), rich(loc.t("pillars[%s].%s" % (n, key), val))))
        out.append('</div></article>')
    out.append('</div>')
    return "".join(out)


def render_causes(P, loc):
    out = []
    if P.get("root_causes_note"):
        out.append('<div class="callout neutral"><div class="c-k">%s</div><p>%s</p></div>'
                   % (e(loc.c("calib_k")), rich(loc.t("root_causes_note", P["root_causes_note"]))))
    out.append(figure(fig_causes(P, loc), e(loc.c("fig_causes_alt")), "fig-causes"))
    out.append('<div class="stack">')
    for r in P["root_causes"]:
        rid = r["id"]
        out.append('<article class="card rc" id="cause-%s">' % e(rid))
        out.append('<div class="rc-head"><span class="rc-id">%s</span>'
                   '<span class="rc-title">%s</span>'
                   '<span class="rc-count">%s</span></div>'
                   % (e(rid), e(loc.t("root_causes[%s].title" % rid, r["title"])),
                      e(loc.c("n_findings") % r["finding_count"])))
        out.append('<p>%s</p>' % rich(loc.t("root_causes[%s].what" % rid, r["what"])))
        out.append('<div class="cure"><b>%s</b>%s</div>'
                   % (e(loc.c("cure_k")), rich(loc.t("root_causes[%s].cure" % rid, r["cure"]))))
        out.append('<div class="chiprow"><span class="cl">%s</span>%s</div>'
                   % (e(loc.c("closes_k")),
                      "".join('<a class="fchip" href="#finding-%d">%d</a>' % (x, x) for x in r["findings"])))
        out.append('<div class="chiprow" style="margin-top:8px"><span class="cl">%s</span>'
                   '<a class="echip" href="#epic-%s">%s</a></div>'
                   % (e(loc.c("cure_k")), e(r["epic"]), e(loc.c("epic_n") % r["epic"])))
        out.append('</article>')
    out.append('</div>')
    return "".join(out)


def render_supervision(P, loc):
    pl = P["platform"]
    out = [figure(fig_supervision(loc), e(loc.c("fig_sup_alt")), "fig-supervision")]
    out.append('<div class="grid grid-2">')
    out.append('<div class="card card-pad"><p class="section-title">%s</p><ul class="plainlist pos">%s</ul></div>'
               % (e(loc.c("platform_gives")),
                  "".join('<li>%s</li>' % rich(loc.t("platform.gives[%d]" % i, g))
                          for i, g in enumerate(pl["gives"]))))
    out.append('<div class="card card-pad"><p class="section-title">%s</p><ul class="plainlist neg">%s</ul></div>'
               % (e(loc.c("platform_denies")),
                  "".join('<li>%s</li>' % rich(loc.t("platform.does_not_give[%d]" % i, g))
                          for i, g in enumerate(pl["does_not_give"]))))
    out.append('</div>')
    out.append('<div class="card card-pad" style="margin-top:16px"><p class="section-title">%s</p>'
               '<div class="table-wrap" style="border:0;box-shadow:none"><table><thead><tr>'
               '<th style="width:30%%">%s</th><th>%s</th></tr></thead><tbody>'
               % (e(loc.c("platform_devalues")), e(loc.c("th_what")), e(loc.c("th_why"))))
    for i, d in enumerate(pl["devalues_our_code"]):
        out.append('<tr><td class="strong">%s</td><td>%s</td></tr>'
                   % (rich(loc.t("platform.devalues_our_code[%d].what" % i, d["what"])),
                      rich(loc.t("platform.devalues_our_code[%d].how" % i, d["how"]))))
    out.append('</tbody></table></div></div>')
    return "".join(out)


def render_findings(P, loc):
    fs = sorted(P["findings"], key=lambda f: f["n"])
    pillar_ids = {str(p["n"]) for p in P["pillars"]}
    zl = ZONE_LABELS[loc.lang]
    by_sev = {s: sum(1 for f in fs if f["severity"] == s) for s in SEVERITIES}
    zones = []
    for f in fs:
        if f["zone"] not in zones:
            zones.append(f["zone"])
    epics = sorted({str(x) for f in fs for x in (f.get("epic") or [])},
                   key=lambda s: (len(s), s))

    out = ['<div class="toolbar">']
    out.append('<div class="tb-row"><span class="tb-label">%s</span>' % e(loc.c("filter_sev")))
    for s in SEVERITIES:
        if by_sev.get(s):
            out.append('<button class="filter" type="button" data-facet="sev" data-value="%s" data-sev="%s" '
                       'aria-pressed="false">%s<span class="cnt">%d</span></button>'
                       % (s, s, s, by_sev[s]))
    out.append('<input class="search" id="finding-search" type="search" placeholder="%s" aria-label="%s">'
               % (e(loc.c("search_ph")), e(loc.c("search_ph"))))
    out.append('<span class="tb-status" id="filter-status"><b>%d</b> / %d %s</span>'
               % (len(fs), len(fs), e(loc.c("shown"))))
    out.append('</div>')
    out.append('<div class="tb-row"><span class="tb-label">%s</span>' % e(loc.c("filter_zone")))
    for z in zones:
        cnt = sum(1 for f in fs if f["zone"] == z)
        out.append('<button class="filter" type="button" data-facet="zone" data-value="%s" aria-pressed="false">'
                   '%s<span class="cnt">%d</span></button>' % (e(z), e(zl.get(z, z)), cnt))
    out.append('</div>')
    out.append('<div class="tb-row"><span class="tb-label">%s</span>' % e(loc.c("filter_more")))
    for ep in epics:
        cnt = sum(1 for f in fs if str(ep) in [str(x) for x in (f.get("epic") or [])])
        out.append('<button class="filter" type="button" data-facet="epic" data-value="%s" aria-pressed="false">'
                   '%s<span class="cnt">%d</span></button>' % (e(ep), e(loc.c("epic_n") % ep), cnt))
    out.append('<button class="filter" type="button" id="filter-reset" hidden>%s</button>' % e(loc.c("reset")))
    out.append('</div></div>')

    out.append('<div class="findings" id="findings-list">')
    for f in fs:
        n = f["n"]
        sev = f["severity"]
        claimed = claimed_severity(f)
        title = loc.t("findings[%d].title" % n, f["title"])
        ev = loc.t("findings[%d].evidence" % n, f.get("evidence", ""))
        means = loc.t("findings[%d].means" % n, f.get("means", ""))
        rec = loc.t("findings[%d].recommendation" % n, f.get("recommendation", ""))
        cal = loc.t("findings[%d].calibration" % n, f.get("calibration", ""))
        rank = loc.t("findings[%d].rank_note" % n, f.get("rank_note", ""))
        vd = f.get("verdict", "")
        if CYR.search(vd or ""):                       # free prose verdict -> translatable
            vd = loc.t("findings[%d].verdict" % n, vd)
        eps = [str(x) for x in (f.get("epic") or [])]
        blob = " ".join([str(n), title, ev, means, rec, f["zone"], sev, vd,
                         zl.get(f["zone"], "")]).lower()
        out.append('<article class="card finding" id="finding-%d" data-severity="%s" data-zone="%s" '
                   'data-pillar="%s" data-epic="%s" data-search="%s">'
                   % (n, e(sev), e(f["zone"]), e(f.get("pillar", "")), e(" ".join(eps)), e(blob)))
        out.append('<div class="finding-head">')
        out.append('<a class="finding-index" href="#finding-%d" aria-label="finding %d">%d</a>' % (n, n, n))
        out.append('<span class="badge" data-severity="%s">%s</span>' % (e(sev), e(sev)))
        if claimed:
            out.append('<span class="badge claimed" title="%s"><s>%s</s> · %s</span>'
                       % (e(loc.c("claimed_by_auditor")), e(claimed), e(loc.c("claimed_by_auditor"))))
        out.append('<span class="verdict-chip">%s</span>' % e(vd))
        out.append('<span class="zone-chip">%s</span>' % e(zl.get(f["zone"], f["zone"])))
        out.append('<span class="spacer"></span>')
        pv = str(f.get("pillar", ""))
        plab = PILLAR_LABELS[loc.lang].get(pv, pv)
        chip = loc.c("pillar_n") % plab
        if pv in pillar_ids:
            out.append('<a class="fchip" href="#pillar-%s" title="%s">%s</a>'
                       % (e(pv), e(chip), e(chip)))
        else:
            out.append('<span class="fchip" title="%s">%s</span>' % (e(chip), e(chip)))
        out.append('</div>')
        out.append('<h3>%s</h3>' % rich(title))
        if ev:
            out.append('<div class="frow evidence"><span class="fk">%s</span><span class="fv">%s</span></div>'
                       % (e(loc.c("evidence_k")), rich(ev)))
        if means:
            out.append('<div class="frow means"><span class="fk">%s</span><span class="fv">%s</span></div>'
                       % (e(loc.c("means_k")), rich(means)))
        if rec:
            out.append('<div class="frow"><span class="fk">%s</span><span class="fv">%s</span></div>'
                       % (e(loc.c("rec_k")), rich(rec)))
        if rank:
            out.append('<div class="frow"><span class="fk">%s</span><span class="fv">%s</span></div>'
                       % (e(loc.c("rank_k")), rich(rank)))
        if cal:
            out.append('<div class="frow calib"><span class="fk">%s</span><span class="fv">%s</span></div>'
                       % (e(loc.c("calib_k")), rich(cal)))
        out.append('<div class="finding-foot"><span class="cl tiny muted">%s</span>%s'
                   '<span class="cl tiny muted" style="margin-left:10px">%s</span>'
                   '<span class="zone-chip">%s</span></div>'
                   % (e(loc.c("epics_k")),
                      "".join('<a class="echip" href="#epic-%s">%s</a>' % (e(x), e(loc.c("epic_n") % x)) for x in eps) or "—",
                      e(loc.c("source_k")), e(loc_source(f.get("source", "—"), loc.lang))))
        out.append('</article>')
    out.append('</div>')
    out.append('<div class="no-results" id="no-results" hidden>%s</div>' % e(loc.c("no_results")))
    return "".join(out)


def render_plan(P, loc):
    out = [figure(fig_plan(P, loc), e(loc.c("fig_plan_alt")), "fig-plan")]
    out.append('<div class="stack">')
    for ep in P["epics"]:
        n = ep["n"]
        prio = ep.get("priority")
        prio_txt = loc.t("epics[%s].priority" % n, prio) if not isinstance(prio, int) else \
            (loc.c("epic_n") % n if False else ("#%d" % prio))
        prio_cls = "now" if not isinstance(prio, int) else ""
        out.append('<article class="card epic" id="epic-%s">' % e(n))
        out.append('<div class="epic-head"><span class="epic-n">%s</span>'
                   '<span class="epic-title">%s</span>'
                   '<span class="prio-chip %s">%s</span><span class="size-chip">%s</span></div>'
                   % (e(n), e(loc.t("epics[%s].title" % n, ep["title"])), prio_cls,
                      e(prio_txt), e(ep.get("size", "?"))))
        if ep.get("priority_note"):
            out.append('<p class="tiny muted" style="margin:-2px 0 10px">%s</p>'
                       % rich(loc.t("epics[%s].priority_note" % n, ep["priority_note"])))
        out.append('<p class="why">%s</p>' % rich(loc.t("epics[%s].why" % n, ep["why"])))
        out.append('<ul class="tasklist">')
        if ep.get("tasks"):
            for i, t in enumerate(ep["tasks"]):
                out.append('<li>%s</li>' % rich(loc.t("epics[%s].tasks[%d]" % (n, i), t)))
        for si, st in enumerate(ep.get("steps", []) or []):
            out.append('</ul><p class="step-label">%s %s — %s</p><ul class="tasklist">'
                       % (e(loc.c("step")), e(st.get("step", si + 1)),
                          e(loc.t("epics[%s].steps[%d].label" % (n, si), st.get("label", "")))))
            for i, t in enumerate(st.get("tasks", [])):
                out.append('<li>%s</li>' % rich(loc.t("epics[%s].steps[%d].tasks[%d]" % (n, si, i), t)))
        out.append('</ul>')
        for key, ck, cls in (("owner_sees", "sees_k", "sees"), ("done_when", "done_k", ""),
                             ("risks", "risk_k", "")):
            if ep.get(key):
                out.append('<div class="kv %s"><span class="kk">%s</span><span class="kv-v">%s</span></div>'
                           % (cls, e(loc.c(ck)), rich(loc.t("epics[%s].%s" % (n, key), ep[key]))))
        dep = ep.get("depends_on") or []
        if dep:
            deps = ", ".join(
                (loc.c("epic_n") % d) if isinstance(d, int) else loc.t("epics[%s].depends_on[%d]" % (n, i), d)
                for i, d in enumerate(dep))
            out.append('<div class="kv"><span class="kk">%s</span><span class="kv-v">%s</span></div>'
                       % (e(loc.c("dep_k")), rich(deps)))
        out.append('<div class="chiprow" style="margin-top:12px"><span class="cl">%s</span>%s</div>'
                   % (e(loc.c("closes_k")),
                      "".join('<a class="fchip" href="#finding-%d">%d</a>' % (x, x)
                              for x in ep.get("findings", []))))
        out.append('</article>')
    out.append('</div>')

    nip = P.get("not_in_plan") or []
    if nip:
        out.append('<div class="card card-pad" style="margin-top:16px"><p class="section-title">%s</p>'
                   '<div class="table-wrap" style="border:0;box-shadow:none"><table><thead><tr>'
                   '<th style="width:32%%">%s</th><th>%s</th></tr></thead><tbody>'
                   % (e(loc.c("not_in_plan_h")), e(loc.c("th_what")), e(loc.c("th_why"))))
        for i, x in enumerate(nip):
            out.append('<tr><td class="strong">%s</td><td>%s</td></tr>'
                       % (rich(loc.t("not_in_plan[%d].item" % i, x["item"])),
                          rich(loc.t("not_in_plan[%d].why" % i, x["why"]))))
        out.append('</tbody></table></div></div>')
    return "".join(out)


def render_questions(P, loc):
    out = ['<div class="stack">']
    for q in P["owner_questions"]:
        n = q["n"]
        out.append('<article class="card qcard" id="question-%d">' % n)
        out.append('<div class="q-head"><span class="q-n">%d</span><span class="q-title">%s</span></div>'
                   % (n, e(loc.t("owner_questions[%d].title" % n, q["title"]))))
        out.append('<p class="q-context">%s</p>'
                   % rich(loc.t("owner_questions[%d].context" % n, q.get("context", ""))))
        if q.get("channels_nuance"):
            out.append('<div class="callout neutral"><div class="c-k">%s</div><p>%s</p></div>'
                       % (e(loc.c("channels_nuance")),
                          rich(loc.t("owner_questions[%d].channels_nuance" % n, q["channels_nuance"]))))
        out.append('<ul class="opts">')
        for i, o in enumerate(q.get("options", [])):
            rec = o.get("recommended")
            out.append('<li class="%s">%s%s</li>'
                       % ("rec" if rec else "",
                          rich(loc.t("owner_questions[%d].options[%d].label" % (n, i), o["label"])),
                          '<span class="rec-tag">%s</span>' % e(loc.c("recommended")) if rec else ""))
        out.append('</ul>')
        if q.get("why_recommended"):
            out.append('<div class="kv"><span class="kk">%s</span><span class="kv-v">%s</span></div>'
                       % (e(loc.c("why_rec")),
                          rich(loc.t("owner_questions[%d].why_recommended" % n, q["why_recommended"]))))
        if q.get("sub_fork"):
            out.append('<div class="kv"><span class="kk">%s</span><span class="kv-v">%s</span></div>'
                       % (e(loc.c("sub_fork")),
                          rich(loc.t("owner_questions[%d].sub_fork" % n, q["sub_fork"]))))
        out.append('</article>')
    out.append('</div>')
    return "".join(out)


def render_redteam(P, loc):
    out = [figure(fig_calibration(P, loc, CFG), e(loc.c("fig_cal_alt")), "fig-calibration")]
    raised = P.get("raised_by_redteam") or []
    if raised:
        out.append('<div class="card card-pad" style="margin-bottom:16px"><p class="section-title">%s</p>'
                   '<div class="table-wrap" style="border:0;box-shadow:none"><table><thead><tr>'
                   '<th style="width:26%%">%s</th><th class="num">%s</th><th>%s</th></tr></thead><tbody>'
                   % (e(loc.c("raised_h")), e(loc.c("th_fact")), e(loc.c("th_move")), e(loc.c("th_why"))))
        for i, r in enumerate(raised):
            out.append('<tr><td class="strong">%s</td><td class="num"><span class="was">%s</span> → '
                       '<span class="now">%s</span></td><td>%s</td></tr>'
                       % (rich(loc.t("raised_by_redteam[%d].finding" % i, r["finding"])),
                          e(r.get("from", "")), rich(loc.t("raised_by_redteam[%d].to" % i, r.get("to", ""))),
                          rich(loc.t("raised_by_redteam[%d].why" % i, r.get("why", "")))))
        out.append('</tbody></table></div></div>')
    out.append('<div class="card card-pad"><p class="section-title">%s</p>'
               '<div class="table-wrap" style="border:0;box-shadow:none"><table><thead><tr>'
               '<th style="width:44%%">%s</th><th>%s</th></tr></thead><tbody>'
               % (e(loc.c("withdrawn_h")), e(loc.c("th_claim")), e(loc.c("th_actual"))))
    for i, w in enumerate(P["withdrawn_by_redteam"]):
        out.append('<tr><td class="was">%s</td><td class="now">%s</td></tr>'
                   % (rich(loc.t("withdrawn_by_redteam[%d].claim" % i, w["claim"])),
                      rich(loc.t("withdrawn_by_redteam[%d].actual" % i, w["actual"]))))
    out.append('</tbody></table></div></div>')

    out.append('<div class="card card-pad" style="margin-top:16px"><p class="section-title">%s</p>'
               '<div class="table-wrap" style="border:0;box-shadow:none"><table><thead><tr>'
               '<th style="width:44%%">%s</th><th class="num">%s</th><th>%s</th></tr></thead><tbody>'
               % (e(loc.c("confirmed_h")), e(loc.c("th_fact")), e(loc.c("th_conf")), e(loc.c("th_src"))))
    for i, c in enumerate(P["confirmed_independently"]):
        dots = '<span class="conf-dots">%s</span>' % ("<i></i>" * c["confirmations"])
        out.append('<tr><td class="strong">%s</td><td class="num">%s %d</td><td class="mono">%s</td></tr>'
                   % (rich(loc.t("confirmed_independently[%d].fact" % i, c["fact"])),
                      dots, c["confirmations"],
                      e(", ".join(loc_source(x, loc.lang) for x in c["sources"]))))
    out.append('</tbody></table></div></div>')
    return "".join(out)


def render_metrics(P, loc):
    out = ['<div class="table-wrap"><table><thead><tr><th style="width:34%%">%s</th>'
           '<th>%s</th><th>%s</th><th>%s</th><th class="num">%s</th></tr></thead><tbody>'
           % (e(loc.c("th_metric")), e(loc.c("th_today")), e(loc.c("th_target")),
              e(loc.c("source_k")), e(loc.c("th_epic")))]
    for i, m in enumerate(P["metrics"]):
        flag = ' ★' if m.get("flagship") else ''
        out.append('<tr><td class="strong">%s%s</td><td class="was">%s</td><td class="now">%s</td>'
                   '<td class="mono">%s</td><td class="num"><a class="fchip" href="#epic-%s">%s</a></td></tr>'
                   % (rich(loc.t("metrics[%d].metric" % i, m["metric"])), flag,
                      rich(loc.t("metrics[%d].today" % i, m["today"])),
                      rich(loc.t("metrics[%d].target" % i, m["target"])),
                      e(loc.t("metrics[%d].source" % i, m["source"])),
                      e(m.get("epic", "")), e(m.get("epic", "—"))))
    out.append('</tbody></table></div>')
    return "".join(out)


def render_borrowings(P, loc):
    out = ['<div class="table-wrap"><table><thead><tr><th style="width:26%%">%s</th>'
           '<th style="width:18%%">%s</th><th>%s</th><th class="num">%s</th></tr></thead><tbody>'
           % (e(loc.c("th_what")), e(loc.c("th_from")), e(loc.c("th_why")), e(loc.c("th_epic")))]
    for i, b in enumerate(P["borrowings"]):
        out.append('<tr><td class="strong">%s</td><td class="mono">%s</td><td>%s</td>'
                   '<td class="num"><a class="fchip" href="#epic-%s">%s</a></td></tr>'
                   % (rich(loc.t("borrowings[%d].what" % i, b["what"])), e(b["from"]),
                      rich(loc.t("borrowings[%d].why" % i, b["why"])),
                      e(b.get("epic", "")), e(b.get("epic", "—"))))
    out.append('</tbody></table></div>')
    out.append('<div class="card card-pad" style="margin-top:16px"><p class="section-title">%s</p>'
               '<ul class="plainlist pos">%s</ul></div>'
               % (e(loc.c("strengths_h")),
                  "".join('<li>%s</li>' % rich(loc.t("our_strengths_to_preserve[%d]" % i, s))
                          for i, s in enumerate(P["our_strengths_to_preserve"]))))
    return "".join(out)


# --------------------------------------------------------------------------- #
# page assembly
# --------------------------------------------------------------------------- #
HEAD_SCRIPT = """(function(){try{var s=localStorage.getItem("arc-theme");
if(s==="dark"||s==="light"){document.documentElement.setAttribute("data-theme",s);}}catch(e){}
document.addEventListener("DOMContentLoaded",function(){var b=document.querySelector(".theme-toggle");
if(!b)return;b.addEventListener("click",function(){var r=document.documentElement;
var d=r.getAttribute("data-theme")?r.getAttribute("data-theme")==="dark":
matchMedia("(prefers-color-scheme: dark)").matches;var n=d?"light":"dark";
r.setAttribute("data-theme",n);try{localStorage.setItem("arc-theme",n);}catch(e){}});});})();"""

SUN = ('<svg class="icon to-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
       'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/>'
       '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>')
MOON = ('<svg class="icon to-light" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
        '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>')

SECTIONS = [
    ("verdict", "h_verdict", "l_verdict", "nav_verdict", render_verdict),
    ("primer", "h_primer", "l_primer", "nav_primer", None),
    ("pillars", "h_pillars", "l_pillars", "nav_pillars", render_pillars),
    ("causes", "h_causes", "l_causes", "nav_causes", render_causes),
    ("supervision", "h_supervision", "l_supervision", "nav_supervision", render_supervision),
    ("findings", "h_findings", "l_findings", "nav_findings", render_findings),
    ("plan", "h_plan", "l_plan", "nav_plan", render_plan),
    ("questions", "h_questions", "l_questions", "nav_questions", render_questions),
    ("redteam", "h_redteam", "l_redteam", "nav_redteam", render_redteam),
    ("metrics", "h_metrics", "l_metrics", "nav_metrics", render_metrics),
    ("borrow", "h_borrow", "l_borrow", "nav_borrow", render_borrowings),
]


def page(P, loc, terms, assets, other_href, other_label, generated_at):
    title = loc.t("title", P["title"])
    subtitle = loc.t("subtitle", P["subtitle"])
    nav = "".join('<a href="#%s">%s</a>' % (sid, e(loc.c(navk))) for sid, _, _, navk, _ in SECTIONS)

    body = []
    for i, (sid, hk, lk, _navk, fn) in enumerate(SECTIONS, start=1):
        body.append('<section id="%s" aria-labelledby="%s-h">' % (sid, sid))
        body.append(sec_head(i, loc, hk, lk, sid, "h1" if i == 1 else "h2"))
        if sid == "primer":
            body.append(render_primer(P, loc, terms))
        else:
            body.append(fn(P, loc))
        body.append('</section>')

    i18n = json.dumps({"shown": loc.c("shown")}, ensure_ascii=False)
    doc = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{subtitle}">
<link rel="stylesheet" href="{assets}styles.css">
<script>{head_script}</script>
</head>
<body>
<a class="skip-link" href="#verdict">{skip}</a>
<header class="site-header">
  <div class="wrap">
    <div class="brand">
      <span class="title">{title}</span>
      <span class="subtitle">{subtitle}</span>
    </div>
    <div class="header-meta">
      <span class="hbtn static">{date}</span>
      <span class="hbtn static">shift {shift}</span>
      <a class="hbtn lang-switch" href="{other_href}" hreflang="{other_lang}" aria-label="{lang_switch_label}">{other_label}</a>
      <button class="hbtn theme-toggle" type="button" aria-label="{theme}">{sun}{moon}<span>{theme}</span></button>
    </div>
  </div>
</header>
<nav class="section-nav" aria-label="{nav_label}"><div class="wrap">{nav}</div></nav>
<main class="wrap" id="main">
{body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <span>{footer_gen} <strong>{synth}</strong> · {generated_at}</span>
    <span>{footer_src} <code>{payload_name}</code> · mandate <code>{mandate}</code></span>
  </div>
</footer>
<script>window.ARC_I18N = {i18n};</script>
<script src="{assets}app.js" defer></script>
</body>
</html>
""".format(
        lang=loc.lang, title=e(title), subtitle=e(subtitle), assets=assets,
        head_script=HEAD_SCRIPT, skip=e(loc.c("skip")), date=e(P["generated_at"]),
        shift=e(P["audit"]["shift"]), other_href=other_href,
        other_lang=("ru" if loc.lang == "en" else "en"),
        lang_switch_label=e(loc.c("lang_switch_label")),
        other_label=other_label, theme=e(loc.c("theme")), sun=SUN, moon=MOON,
        nav_label=e(loc.c("nav_verdict")), nav=nav, body="\n".join(body),
        footer_gen=e(loc.c("footer_gen")),
        synth=e(loc.t("audit.synthesizer", P["audit"]["synthesizer"])),
        generated_at=e(generated_at), footer_src=e(loc.c("footer_src")),
        payload_name="report-payload.json", mandate=e(P["mandate_source"]),
        i18n=i18n,
    )
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--payload", default=DEFAULT_PAYLOAD)
    args = ap.parse_args()

    with open(args.payload, "r", encoding="utf-8") as fh:
        P = json.load(fh)
    # keep a snapshot beside the report so it stays reproducible offline
    with open(os.path.join(HERE, "payload.json"), "w", encoding="utf-8") as fh:
        json.dump(P, fh, ensure_ascii=False, indent=1)

    overlay = {}
    import glob as _glob
    for part in sorted(_glob.glob(os.path.join(HERE, "i18n", "*.json"))):
        with open(part, "r", encoding="utf-8") as fh:
            overlay.update(json.load(fh))
    terms = load_terms()
    cfg_path = os.path.join(HERE, "figures.json")
    if os.path.exists(cfg_path):
        with open(cfg_path, "r", encoding="utf-8") as fh:
            CFG.update(json.load(fh))
    cc = CFG.get("critical_claimed")
    if cc and str(cc) not in json.dumps(P["headline"], ensure_ascii=False) \
            and str(cc) not in json.dumps(P.get("audit", {}), ensure_ascii=False):
        print("WARNING: figures.json critical_claimed=%s is not corroborated by the payload" % cc)

    try:
        generated_at = subprocess.check_output(["date", "-u", "+%Y-%m-%d %H:%M UTC"]).decode().strip()
    except Exception:
        generated_at = P["generated_at"]

    en = Loc("en", overlay, CHROME)
    ru = Loc("ru", overlay, CHROME)

    en_html = page(P, en, terms, "assets/", "ru/index.html", "EN ⇄ RU", generated_at)
    ru_html = page(P, ru, terms, "../assets/", "../index.html", "RU ⇄ EN", generated_at)

    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(en_html)
    ru_dir = os.path.join(OUT, "ru")
    if not os.path.isdir(ru_dir):
        os.makedirs(ru_dir)
    with open(os.path.join(ru_dir, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(ru_html)

    stale = sorted(set(STALE))
    if stale:
        print("STALE EN TRANSLATIONS (payload text changed after translating): %d" % len(stale))
        with open(os.path.join(HERE, "stale-en.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(stale))
        for k in stale[:15]:
            print("   ~", k)
    miss = sorted(set(MISSING))
    print("EN %d bytes / RU %d bytes" % (len(en_html), len(ru_html)))
    print("findings=%d pillars=%d causes=%d epics=%d questions=%d"
          % (len(P["findings"]), len(P["pillars"]), len(P["root_causes"]),
             len(P["epics"]), len(P["owner_questions"])))
    if miss:
        print("MISSING EN TRANSLATIONS: %d keys" % len(miss))
        with open(os.path.join(HERE, "missing-en.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(miss))
        for k in miss[:15]:
            print("   -", k)
    else:
        print("EN translation complete: 0 fallbacks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
