# Quality loop — Iteration 1: the controlled 2×2

**Date:** 2026-08-26 · **Status:** complete · **Gate:** passed, with a decisive result and one honest limitation

The launch-readiness round found that the full pipeline produced output *no better* than a single
well-crafted prompt to the same model, and that 8/8 blind judgements called it machine-generated.
Iteration 1 was specified as a controlled 2×2 to separate a **generator-model ceiling** from an
**over-constrained pipeline**, before any prompt or architecture change.

It ran. Both hypotheses are refuted. The answer is a third thing.

---

## 1. Method, and what it can and cannot support

Four variants, evidence held constant within each case:

| | current generator `google/gemini-3.7-flash` | stronger generator `anthropic/claude-opus-5` |
| --- | --- | --- |
| **full pipeline** | A | B |
| **strong single prompt** | C | D |

Two cases: `ukyouth` (intended evidence-rich) and `evidence-poor`. Eight documents.

Judged **blind** by two model families — `openai/gpt-5.6-sol` and `x-ai/grok-4.6`, neither sharing a
family with either generator. Each critic saw the grant text, the applicant identity, and four
documents relabelled `Doc 1`–`Doc 4` in an order it could not infer. No critic was told a pipeline
existed, and none graded its own family's work.

### What this run cannot tell you

Three limitations, stated before the results rather than after them.

1. **The pipeline was replayed offline, not run.** No Supabase project exists to run the deployed
   worker against, so the stage chain was replayed through OpenRouter using the prompts transcribed
   verbatim from `worker/index.ts`. It is faithful to the generation path and is *not* the deployed
   system.
2. **The evidence-rich arm is compromised.** The launch-readiness report records the crawler pulling
   twelve concrete facts off ukyouth.org. Outbound web access is blocked here, so the case could only
   be rebuilt from what the reports actually record — four items verbatim, the rest marked UNKNOWN.
   That ledger offers **three** named referents, not twelve. All four variants saw the same evidence,
   so the comparison holds; but this run cannot say what the pipeline does with a genuinely rich ledger.
3. **Compliance cannot be read from this run.** Seven of eight documents broke the word limit, by 9%
   to 49%. That is almost certainly a replay artefact: the real `validate` stage runs a word-limit
   correction loop the replay did not reproduce, and Ktebli has never shipped over a limit in testing.
   Treated as an artefact, not a finding.

A fourth, procedural: the first critic call timed out at the MCP server's 60-second limit, so all
four critic runs used `reasoning_effort: low`. That is a *weaker* critic than the launch-readiness
round used, which makes a unanimous "not fundable" more credible, not less — but it is not an
identical replication.

---

## 2. The blind rankings

Both critic families produced the **identical ranking within each case**, independently.

**Case `ukyouth`** — `Doc 1 > Doc 4 > Doc 3 > Doc 2`, decoding to:

| rank | variant |
| --- | --- |
| 1 | **A** pipeline + current generator |
| 2 | **B** pipeline + stronger generator |
| 3 | C single prompt + current generator |
| 4 | D single prompt + stronger generator |

**Case `evidence-poor`** — `Doc 1 > Doc 2 > Doc 4 > Doc 3`, decoding to:

| rank | variant |
| --- | --- |
| 1 | **B** pipeline + stronger generator |
| 2 | D single prompt + stronger generator |
| 3 | C single prompt + current generator |
| 4 | A pipeline + current generator |

### Mean rank across both cases

| variant | ukyouth | evidence-poor | mean |
| --- | --- | --- | --- |
| **B pipeline + stronger** | 2 | 1 | **1.5** |
| A pipeline + current | 1 | 4 | 2.5 |
| C single + current | 3 | 3 | 3.0 |
| D single + stronger | 4 | 2 | 3.0 |

---

## 3. Which hypothesis the evidence supports

**Not a generator ceiling.** On `ukyouth` the strongest available model ranked *last* in
single-prompt mode and *second* in pipeline mode — below the cheaper current generator in both.
A model upgrade alone does not fix this.

**Not an over-constrained pipeline.** On `ukyouth` both pipeline arms beat both single-prompt arms,
under both critic families, unanimously. This directly contradicts the launch-readiness finding that
a single prompt matched or beat the architecture. On `evidence-poor` the pipeline took first place.

**It is an interaction, and the two effects are separable.** `ukyouth` shows a clean *mode* effect
(pipeline > single prompt, generator irrelevant). `evidence-poor` shows a clean *generator* effect
(stronger > current, mode secondary). The configuration that is in the top two on **both** cases is
**B — the full pipeline at the stronger generator** — and it is the only one.

**The absolute bar is still failed.** Across 16 document-level judgements there is exactly **one**
`fundable: yes`: critic_b on variant B, `evidence-poor`. That is the first fundable verdict this
project has recorded, and it is one out of sixteen. Critic_a funds nothing at all.

> ### CORRECTED 2026-08-26 — the one-system result was an instrument artefact
>
> This paragraph originally continued: *"Asked whether they were reading four applicants or one
> system, all four critic runs said one system. One called the weakest document 'the unfilled
> master; the others are filled variants.'"* Both halves were reported with more weight than they
> could carry.
>
> **The "unfilled master" was the single-prompt baseline, not the pipeline.** `Doc 2` decodes to
> variant **D** — one message to one model, which never touched `GEN_SPECS`, `STYLE_RULES`,
> `FORMAT_RULES`, the seeded templates or the logframe schema. It read as a template because it
> carried **35 `[INSERT: …]` placeholders** against **zero** in both pipeline arms: it was the one
> document that made the evidence hole visible, and both critics ranked it last.
>
> **The one-system question could not discriminate.** Experiment E-1 re-judged the same eight
> documents with the leading elements removed — a forced choice against ground truth, the
> nine-item reject list deleted, the "most proposals are mediocre" prior deleted, and the
> applicant identity stripped from the header:
>
> - **Forced choice: 1 of 4 correct against a chance rate of 1/3.** Below chance. The critics
>   cannot identify which documents actually share a writing process.
> - **Neutral open question: every item named was either mandated by the call's own required
>   sections or was the applicant's own identity**, which the experiment held constant. The one
>   partial exception was three of four ukyouth bids clustering near the £120k ceiling.
> - **Not one critic, on either case, named prose, diction, cadence, phase tables, three-part
>   constructions, "template diction", or "reads machine-generated"** once that vocabulary was
>   not supplied to them in the prompt.
>
> On this evidence the 4/4 unanimity measured **the shared client and the shared call**, not a
> shared system. It must not be used as a launch gate.
>
> **This reaches further than the one-system claim.** Iteration 1's critic prompt supplied the
> reject list, and the critics returned its vocabulary; E-1 withheld it, and they did not. Every
> "reads machine-generated" verdict in this report was produced by an instrument that named the
> failure it was asking about. The fundability and ranking results do not depend on that
> vocabulary and stand. The sameness verdicts do, and are downgraded to unproven.
>
> Consequences: the pre-delivery quality gate must use a **neutral** instrument, or it will hold
> documents for failures it invented. And the real exclusivity question — do documents for
> *different* applicants read as one writer — remains open, because it has never been asked.
> `reports/design/one-system.md` specifies E-2, which asks it.

**A note on what this does not excuse.** None of the above makes the output good. Fifteen of
sixteen judgements still say not fundable, and that verdict never depended on the supplied
vocabulary.

---

## 4. Proper nouns — the measurement that matters

Both critics, on `evidence-poor`, returned **identical counts and identical referents**: 3 / 2 / 1 / 2,
naming Bab al-Tabbaneh, Qobbe and the Municipality of Tripoli. On `ukyouth` both returned **zero for
all four documents**. One critic: *"none names a town, hub, partner, YJS team, college or street, so
Round 4 priority 1 is asserted not evidenced."*

The deterministic audit in `worker/proper_nouns.ts` puts the ceiling on it: the two ledgers offer
**three** and **five** named referents respectively. That is the entire universe of particularity
available to any of these documents — every "messy local noun" they could legitimately contain.

Two calibration notes, because the deterministic counts and the critic counts differ:

- The audit counts **ledger-backed** referents; the critics count referents **present in the document
  at all**. Those are different measurements, and the gap between them is the fabrication surface.
- Measuring against the critics found two real bugs in the audit, both now fixed: `"Bab al-Tabbaneh
  and Qobbe"` was being read as one referent, and a phrase containing the applicant's own name was
  being credited as a named referent. An earlier version also counted `UNKNOWN`, `E-WEB-1` and other
  ledger scaffolding as content, which manufactured a specificity failure out of an evidence failure.

> ### RETRACTED 2026-08-26
>
> This section originally concluded: *"the constraint is the evidence, not the pipeline and not
> the model."* **That conclusion is withdrawn. This run did not establish it.**
>
> The evidence contrast was **inverted**. The arm labelled evidence-rich carried **3** named
> referents; the arm labelled evidence-poor carried **5**. So evidence richness was never varied
> — and on the axis that was varied, the "rich" case was the poorer of the two. A conclusion about
> evidence being the binding constraint rests on a comparison that was never run.
>
> What survives: the two ledgers offered 3 and 5 referents, which bounds how particular any of
> these eight documents could have been. That is a *ceiling*, not a demonstration that raising the
> ceiling raises fundability.
>
> The mode effect found on UK Youth (pipeline above single prompt, both critics) is real. It is
> **unlabelled**: it cannot be attributed to evidence richness, because richness did not vary.
>
> `reports/referent-ladder.md` runs the comparison this one did not: one organisation, one grant,
> referent counts of 3/6/9/12 as strict supersets, plus a specificity contrast at fixed count.

---

## 5. Arithmetic — independent confirmation of the Numeric Register

`critic_a` recomputed every figure and found, unprompted, exactly the defect class the Numeric
Register was built to make impossible:

- a *"over 75% to frontline delivery"* claim that recomputes to **61.9–69.0%**
- *"roughly 600 shifts"* that recomputes to about **261**
- a cohort that cannot receive six-month tracking inside a 24-month project
- a £12,000 match never reconciled against the total it implies
- 18 streets × 2 volunteers = 36 assignments against ~15 volunteers
- households added to persons

Every one throws in `resolveRegister()` before a document is written. `critic_b` found none of these
and reported all four budgets closing — the two critics disagree on arithmetic depth, not direction,
which is itself an argument for the check being deterministic rather than model-driven.

---

## 6. Cost, measured

| variant | model calls | cost per document |
| --- | --- | --- |
| A pipeline + current | 10–13 | **$0.06** |
| B pipeline + stronger | 10–16 | **$1.15–1.27** |
| C single + current | 2–3 | $0.03–0.05 |
| D single + stronger | 2 | $0.22 |

B costs roughly **20×** A. Against $149–$449 that is still a gross margin above 99%, and the owner's
stated headroom is 10× current spend. Twenty times a very small number remains a very small number.

---

## 7. What the evidence says to do next, ranked

1. **Move the generator to the stronger model.** It is the only variant in the top two on both cases,
   it produced the one fundable verdict recorded, and it costs $1.20 against a $149 floor. This is the
   cheapest decisive change available.
2. **Fix the evidence, not the prose.** Three to five named referents is the ceiling on particularity,
   and no configuration beats it. This is the intake and crawl work — and the designs for it were
   **rejected** by adversarial review for manufacturing provenance and breaking prompt-injection
   fencing. They need revision before implementation. See `reports/design/README.md`.
3. **Land the Numeric Register in the design stage.** The defect class is confirmed present in live
   output by an independent critic, and the deterministic core and its tests are already committed.
4. **Strip the house-style scaffolding.** Not tested by this run, but `reports/design/house-style-findings.md`
   documents hardcoded table headers, fixed section lists, fixed word bands and one logframe ontology
   applied to every applicant — and every critic run answered "one system".
5. **Re-run this 2×2 with a real evidence-rich case** once an environment exists. The strongest claim
   here — that the pipeline beats the single prompt — rests on a case whose ledger was reconstructed
   from a report rather than crawled, and it deserves a proper replication.

---

## 8. Against the launch-readiness finding

The prior round reported the single prompt matching or beating the pipeline on all three cases it was
run against, and 8/8 "reads machine-generated".

This round finds the pipeline **ahead of the single prompt on both cases** under two critic families,
and the "machine-generated" verdict split 12 yes / 4 no rather than 8/8. That is a real change in the
comparative result and it should be treated as provisional: different cases, a weaker critic setting,
an offline replay, and only two cases. It is enough to stop believing the pipeline is net-negative.
It is not enough to declare it good — 15 of 16 judgements still say not fundable.
