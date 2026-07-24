#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lists every translatable payload string with its i18n key and a short hash of the
Russian source, so the English overlay can be authored offline and later checked
for drift (build.py reports a STALE key when the Russian behind it changed).

    python3 build/extract.py                 # every key, grouped
    python3 build/extract.py --only findings # one group
    python3 build/extract.py --missing       # only keys absent from i18n-en.json
    python3 build/extract.py --hashes        # emit {key: hash} JSON for stamping
"""
import argparse
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def h(s):
    return hashlib.sha1(("" if s is None else str(s)).encode("utf-8")).hexdigest()[:10]


def collect(P):
    """(group, key, russian) for every translatable string, in report order."""
    out = []

    def add(group, key, val):
        if isinstance(val, str) and val.strip():
            out.append((group, key, val))

    add("meta", "title", P.get("title"))
    add("meta", "subtitle", P.get("subtitle"))
    add("meta", "audit.synthesizer", P["audit"].get("synthesizer"))
    for i, s in enumerate(P["audit"]["sources"]):
        add("meta", "audit.sources[%d].zone" % i, s.get("zone"))
        add("meta", "audit.sources[%d].note" % i, s.get("note"))
    for i, c in enumerate(P["audit"]["caveats"]):
        add("meta", "audit.caveats[%d]" % i, c)

    hd = P["headline"]
    for k in ("one_liner", "hardest_fact", "note_on_counts"):
        add("headline", "headline.%s" % k, hd.get(k))
    for i, a in enumerate(hd.get("top_actions", [])):
        add("headline", "headline.top_actions[%d]" % i, a)
    add("headline", "headline.product_gloss", P.get("product_gloss"))
    add("headline", "headline.research_gloss", P.get("research_gloss"))
    fm = P.get("flagship_metric") or {}
    add("headline", "flagship_metric.name", fm.get("name"))
    add("headline", "flagship_metric.rationale", fm.get("rationale"))
    for i, d in enumerate(P.get("already_done") or []):
        add("headline", "already_done[%d].what" % i, d.get("what"))
        add("headline", "already_done[%d].evidence" % i, d.get("evidence"))

    for p in P["pillars"]:
        n = p["n"]
        for k in ("name", "verdict", "evidence", "blocker", "means", "readiness_label"):
            add("pillars", "pillars[%s].%s" % (n, k), p.get(k))

    add("causes", "root_causes_note", P.get("root_causes_note"))
    for r in P["root_causes"]:
        for k in ("title", "what", "cure"):
            add("causes", "root_causes[%s].%s" % (r["id"], k), r.get(k))

    pl = P["platform"]
    for i, g in enumerate(pl["gives"]):
        add("platform", "platform.gives[%d]" % i, g)
    for i, g in enumerate(pl["does_not_give"]):
        add("platform", "platform.does_not_give[%d]" % i, g)
    for i, d in enumerate(pl["devalues_our_code"]):
        add("platform", "platform.devalues_our_code[%d].what" % i, d.get("what"))
        add("platform", "platform.devalues_our_code[%d].how" % i, d.get("how"))

    for f in sorted(P["findings"], key=lambda x: x["n"]):
        n = f["n"]
        for k in ("title", "evidence", "means", "recommendation", "calibration", "rank_note"):
            add("findings", "findings[%d].%s" % (n, k), f.get(k))
        vd = f.get("verdict") or ""
        if any("Ѐ" <= ch <= "ӿ" for ch in vd):
            add("findings", "findings[%d].verdict" % n, vd)

    for ep in P["epics"]:
        n = ep["n"]
        for k in ("title", "why", "owner_sees", "done_when", "risks", "priority_note"):
            add("epics", "epics[%s].%s" % (n, k), ep.get(k))
        if not isinstance(ep.get("priority"), int):
            add("epics", "epics[%s].priority" % n, ep.get("priority"))
        for i, t in enumerate(ep.get("tasks") or []):
            add("epics", "epics[%s].tasks[%d]" % (n, i), t)
        for si, st in enumerate(ep.get("steps") or []):
            add("epics", "epics[%s].steps[%d].label" % (n, si), st.get("label"))
            for i, t in enumerate(st.get("tasks") or []):
                add("epics", "epics[%s].steps[%d].tasks[%d]" % (n, si, i), t)
        for i, d in enumerate(ep.get("depends_on") or []):
            if not isinstance(d, int):
                add("epics", "epics[%s].depends_on[%d]" % (n, i), d)
    for i, x in enumerate(P.get("not_in_plan") or []):
        add("epics", "not_in_plan[%d].item" % i, x.get("item"))
        add("epics", "not_in_plan[%d].why" % i, x.get("why"))

    for q in P["owner_questions"]:
        n = q["n"]
        for k in ("title", "context", "channels_nuance", "why_recommended", "sub_fork"):
            add("questions", "owner_questions[%d].%s" % (n, k), q.get(k))
        for i, o in enumerate(q.get("options") or []):
            add("questions", "owner_questions[%d].options[%d].label" % (n, i), o.get("label"))

    for i, w in enumerate(P["withdrawn_by_redteam"]):
        add("redteam", "withdrawn_by_redteam[%d].claim" % i, w.get("claim"))
        add("redteam", "withdrawn_by_redteam[%d].actual" % i, w.get("actual"))
    for i, r in enumerate(P.get("raised_by_redteam") or []):
        add("redteam", "raised_by_redteam[%d].finding" % i, r.get("finding"))
        add("redteam", "raised_by_redteam[%d].to" % i, r.get("to"))
        add("redteam", "raised_by_redteam[%d].why" % i, r.get("why"))
    for i, c in enumerate(P["confirmed_independently"]):
        add("redteam", "confirmed_independently[%d].fact" % i, c.get("fact"))

    for i, m in enumerate(P["metrics"]):
        for k in ("metric", "today", "target", "source"):
            add("metrics", "metrics[%d].%s" % (i, k), m.get(k))

    for i, b in enumerate(P["borrowings"]):
        add("borrow", "borrowings[%d].what" % i, b.get("what"))
        add("borrow", "borrowings[%d].why" % i, b.get("why"))
    for i, s in enumerate(P["our_strengths_to_preserve"]):
        add("borrow", "our_strengths_to_preserve[%d]" % i, s)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--missing", action="store_true")
    ap.add_argument("--hashes", action="store_true")
    ap.add_argument("--payload", default=os.path.join(HERE, "payload.json"))
    a = ap.parse_args()

    with open(a.payload, "r", encoding="utf-8") as fh:
        P = json.load(fh)
    rows = collect(P)

    if a.hashes:
        print(json.dumps({k: h(v) for _, k, v in rows}, ensure_ascii=False, indent=0))
        return 0

    have = {}
    import glob as _glob
    for part in sorted(_glob.glob(os.path.join(HERE, "i18n", "*.json"))):
        with open(part, "r", encoding="utf-8") as fh:
            have.update(json.load(fh))

    group = None
    n = 0
    for g, k, v in rows:
        if a.only and g != a.only:
            continue
        if a.missing and k in have:
            continue
        if g != group:
            group = g
            print("\n##### %s" % g)
        n += 1
        print("%s\t%s\t%s" % (k, h(v), v.replace("\n", " ")))
    print("\n# %d strings" % n, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
