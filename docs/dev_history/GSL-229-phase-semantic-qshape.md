# GSL-229 — semantic qshape grouping + candidates-count digest line

**Parent epic.** [GSL-243](https://ainstance-labs.atlassian.net/browse/GSL-243).
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/229.
**Branch.** `GSL-243-systems-audit-tail`.

## What changed

Audit finding 50: `qshape` was a near-verbatim SHA of the question string — 21 distinct shapes over two weeks, max group size 1, so lowering the `candidates` threshold would have promoted nothing. Fixing the threshold was the wrong lever; the shape itself needed to normalize.

New `qshape` hashes a **sorted bag of content words** after:

1. Placeholder substitution (keys, refs, paths, numbers).
2. Punctuation stripping.
3. Stopword removal (extensive English function-word list + the four `<key>/<ref>/<path>/<n>` placeholders).
4. Short-token filter (`len <= 2`).
5. A deliberately dumb stemmer: strip one of `("ing", "ed", "es", "ly", "s", "e")` — longest first, with a `len > suf+2` guard.

Result: `"merge strategy for PR #40 after main moved?"`, `"what is the merge strategy after main moved for PR #40?"`, and `"for PR #40, what is the merge strategy after main was moved?"` all hash to the same shape. Distinct forks stay distinct.

The digest's section 6 now prints `candidates: N (shapes: M)` **always**, including at zero — so 0 candidates over 21 shapes is visible rather than swallowed. The advisory invariant is spelled out in the digest line ("promotion into the manifest remains owner-only"); `candidates` itself never mutates the manifest.

## Files touched

- `tools/lab/lab-emit.sh` — new `QSHAPE_STOPWORDS`, `QSHAPE_SUFFIXES`, rewritten `qshape()`.
- `tools/lab/chronicler.py` — digest section 6 header now names the shape count.
- `tools/lab/tests/lab-emit-qshape.sh` — new gate, 5/5 pass.

## Verification

- `bash tools/lab/tests/lab-emit-qshape.sh` → 5/5 (fold, distinctness, ×3, ×4, advisory).
- `bash tools/lab/smoke.sh` → PASS=405 / FAIL=161 (unchanged). The existing smoke line "3× same shape+answer -> candidate" still passes because the three questions differ only in a ref number.

## Notes / decisions

- The stemmer is dumb on purpose. "strategy" → "strategy" (no suffix matches); "strategies" → "strategie" (drops "s"). Not perfect but self-consistent and stdlib-only.
- Adding a NEW content word breaks equivalence (the shape is bag-of-content-words, not synonyms). The test suite pins that behaviour to prevent accidental widening.
- Manifest is checksum-tested in the gate (`shasum` before and after `candidates`); the advisory invariant is proven, not just documented.
