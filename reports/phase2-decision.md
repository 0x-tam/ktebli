# Phase 2 — the fork, called honestly: CASE B. The single prompt matches the pipeline.

**Date:** 2026-08-28 · **Input:** 10/10 verdicts, reports/phase1-verdicts.md · **Status: fork called; hybrid test EXECUTING**

## The counts

Funded arm, per cell (B = pipeline+opus, D = single-prompt+opus):

| | n03 | n06 | n09 | n12 | n06thin | total |
|---|---|---|---|---|---|---|
| critic_a (gpt-5.6-sol) | B | D | D | B | B | B×3 D×2 |
| critic_b (grok-4.6) | B | D | D | B | D | B×2 D×3 |

- Head-to-head, B above D: **5 of 10 cells**. D above B: **5 of 10**. An exact tie.
- Per rung the families AGREE on every standard rung (n03→B, n06→D, n09→D, n12→B) and split
  only on the thin rung. The winner is a property of the rung, not the critic.
- Fundable-as-submitted marks: opus arms 13, flash arms 1 ("barely"). Arm A last in 8/10.
- Case A ("pipeline beats single-prompt on the majority, both families") is **false**: 5/10
  overall; critic_a majority for B (3–2), critic_b majority for D (3–2) — not both families.
- Case C does not arise: zero MISSING, zero SUBSTITUTE.

**Case B applies: the single prompt matches the pipeline** (a tie is "matches"). Per the
pre-authorized rule: do not stop; adopt the winner inside the invariants.

## What the architecture demonstrably earns, and what it loses

The pipeline earns grounding (ledger-fed arms used 71–100% of offered referents),
compliance scaffolding, and exclusivity; on prose the naked single prompt at the same
generator matches it — and the single prompt costs ~$0.12–0.13 against B's ~$1.2–1.5 per
document, a 10× difference for indistinguishable blind rank.

Known defects of the naked single prompt (from the critics and the metas, and none of them
prose): n12-D shipped 36 words OVER the 1,200 hard limit; its budget paid for 24 minibus
trips against 12 planned; n06-D's budget did not close (38,840 + 4,660 ≠ its own total).
These are exactly the defect classes the wrapper's deterministic gates exist to catch.

## The hybrid, as pre-authorized

Core: ONE strong single-prompt generation call — `anthropic/claude-opus-5`,
`reasoning_effort: low`, `max_tokens: 12000`, identical parameters to every D arm — fed the
FULL Evidence Ledger. Wrapped by everything that works, applied deterministically AFTER
generation, with at most 2 repair rounds that name exact failures (loop limits per
invariant-style rules; a repair must materially change the document):

1. **Compliance gate**: Q1–Q5 answer-span word count in Python (same method as the ladder
   table; models never count), hard 1,200; over → named repair. Never truncation.
2. **Numeric register**: recompute every budget line and stated total; any figure that does
   not close → named repair.
3. **Claim ledger / grounding**: every named referent in the document must trace to the
   ledger; an unledgered proper noun → named repair.
4. **Exclusivity composer**: wraps the hybrid in production but is a no-op for a single
   document per rung (uniqueness is judged across applicants, not within one document);
   stated rather than silently skipped.

## The test, pre-committed before any call

- Rungs: **n12** (the strongest rung: most evidence, both families fund B there) and
  **n06thin** (the evidence-poor case).
- New documents: `out-<rung>-H.md` only. B and D stand as generated — the hybrid must beat
  the OLD pipeline and the naked single prompt as they are, not freshly rolled.
- Packets: 4 documents {A, B, D, H} in the builder's verified framing (A retained as the
  weak control), orders differing between rungs, blinding derived from bytes as always.
- Critics: the same two, same settings, blind, one call per cell, 4 cells.
- **Win condition, fixed now:** H ranks above BOTH B and D in at least 3 of 4 cells, is the
  funded document in at least 2 of 4, and never ranks below A anywhere. Anything less is a
  loss and writes BLOCKED.md with both tables.

Result: recorded below after the run. Nothing above this line changes after it.

---

## RESULT (recorded after the run, 2026-08-28): THE HYBRID LOSES, 0 of 4.

4 cells, same critics, same settings, blinding derived from bytes, every decode confirmed
by a critic-quoted figure unique to one arm (bytematch: 26 fingerprints green). Judging
spend $0.2233; hybrid generation $0.2084.

| cell | packet order | ranking (decoded) | funds | H fundable? |
|---|---|---|---|---|
| n12 / critic_a | AHDB | **B > D > A > H** | B | no |
| n12 / critic_b | DBHA | **D > B > H > A** | D | no |
| n06thin / critic_a | HDAB | **B > D > H > A** | B | no |
| n06thin / critic_b | BADH | **B > D > H > A** | B | yes |

Against the pre-committed win condition: H above both B and D in **0 of 4** (needed ≥3);
funded in **0 of 4** (needed ≥2); below A in one cell. A loss on every clause.

**Why it lost — both critics, independently, the same diagnosis.** Not prose, and not
arithmetic: critic_a *verified H's budget closes* (recomputing £88 × 52 = £4,576 — the
first document in this project's history whose totals a hostile critic confirmed), and
critic_b counted H's referents among the densest. It lost on **strategy**: "bundles
existing youth sessions, a supper club, adult volunteering and progression work into an
over-broad proposal rather than presenting a disciplined project" (critic_a);
"design is a pile of existing work, not a progression plan" (critic_b). Fed the full
ledger with no strategy layer, the strong generator used everything and chose nothing.

**What this establishes.** The strategy-plus-generation core is load-bearing: the
pipeline's strategy stage is what turns an evidence pile into a project, and no wrapper
of deterministic gates substitutes for it. The pipeline (arm B) remains the core. The
deterministic gates built for this test are kept — they caught real, critic-confirmed
defects in every arm (word limits, 24-vs-12 trips, 90 hall evenings, unledgered names)
and they are exactly the wrapper the pipeline's own weaknesses need.

A variance note, honestly: in these packets B beat D in 3 of 4 cells, including both
n06thin cells, where phase 1 had split. One critic judging one packet is not a stable
instrument at the margin — which is an argument for the hold-biased deterministic gate
posture in phase 3, not against the comparison above.

Per the fork rule: BLOCKED.md carries both tables; phases 3–6 continue, none of which
depends on the fork.
