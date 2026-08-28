# BLOCKED — the phase 2 hybrid bid failed its pre-committed test. The quality ceiling stands where phase 1 left it.

**Date:** 2026-08-28. **This blocks nothing downstream**: per the fork rule (KTEBLI-AUTORUN
phase 2, case B), phases 3–6 continue and are continuing. This file exists because the rule
requires the operator to see the ceiling, with both tables, in one place.

## What stopped

The pre-authorized case-B bid — replace the strategy+generation core with the strong
single-prompt generation fed the full Evidence Ledger, wrapped by the deterministic gates —
was built, run on the strongest rung (n12) and the evidence-poor case (n06thin), and judged
blind by the same two critic families. It lost on every clause of the win condition fixed in
advance: H above both B and D in 0/4 cells (needed ≥3), funded 0/4 (needed ≥2), once below
even the flash pipeline arm.

## Table 1 — phase 1, the ten verdicts (reports/phase1-verdicts.md)

| rung | critic_a | critic_b |
|---|---|---|
| n03 | B>D>C>A, funds B | B>D>C>A, funds B |
| n06 | D>B>C>A, funds D | D>B>C>A, funds D |
| n09 | D>B>A>C, funds D | D>B>C>A, funds D |
| n12 | B>D>A>C, funds B | B>D>C>A, funds B |
| n06thin | B>D>C>A, funds B | D>B>C>A, funds D |

B (pipeline+opus) vs D (single+opus): 5–5. Flash arms never win. Fundable marks: opus 13, flash 1.

## Table 2 — phase 2, the hybrid test (reports/phase2-decision.md)

| cell | ranking | funds | H fundable? |
|---|---|---|---|
| n12/critic_a | B > D > A > H | B | no |
| n12/critic_b | D > B > H > A | D | no |
| n06thin/critic_a | B > D > H > A | B | no |
| n06thin/critic_b | B > D > H > A | B | yes |

## What the ceiling is, precisely

- A strong generator inside the pipeline (B) and naked (D) produce blind-indistinguishable
  prose quality; the hybrid (D's core + deterministic gates, no strategy stage) is WORSE
  than both, because the strategy layer is what turns an evidence pile into a focused
  project. Both critics said this independently and unprompted.
- So there is no cheaper core hiding in the architecture: the pipeline earns its cost, and
  the only lever that moved fundability across ten cells was generator strength.

## Options and costs

1. **Keep pipeline+opus as the core; wrap it with the phase-2 deterministic gates**
   (word/numeric/grounding, already built and calibrated: every finding they raise on the
   ladder corpus is one a hostile critic independently confirmed). Cost ≈ $1.2–1.5 per
   Draft at current prices, margin >99% at $149. **Recommended, and what phases 3–6 are
   proceeding on.**
2. Keep pipeline+flash (arm A) for cost: refuted — A is last in 8 of 10 phase-1 rankings
   and was never fundable.
3. Re-bid the hybrid with a strategy stage retained (strategy → single-prompt gen →
   gates): plausible (~$0.5 of critic spend to test), but it converges on the existing
   pipeline minus stages the critics never faulted; not run without operator interest.

## Spend

Phase 2 total: $0.43 (hybrid generation $0.21, judging $0.22). Balance after: $24.12.
