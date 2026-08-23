# Ktebli Internal Quality Standard v1

**Status:** internal benchmarking only. Nothing in this document is ever shown to a customer, and no score from it appears in any delivered document or on the order page.
**Baseline under test:** worker v19 (frozen).

---

## 1. Why a rubric at all

Compliance and quality are different questions, and v19 only proves the first. A proposal can carry zero unsupported claims, answer all five donor questions, land inside the word limit and clear the similarity gate — and still be a proposal no competent grant writer would send. The validators cannot see that, because they were built to detect *defects*, not to judge *merit*.

So the standard below is deliberately written to be failable by a technically clean document.

---

## 2. The ten dimensions

Each is scored 1–5 by a blind evaluator that sees only what a donor sees. The wording matters more than the number: what we act on is the recurring free-text weakness, not the average.

| # | Dimension | 5 = | 1 = |
| --- | --- | --- | --- |
| 1 | **Donor fit** | Engages the donor's actual stated priorities and constraints as the organising logic of the proposal | Mentions donor priorities as decoration; would read identically for a different funder |
| 2 | **Strategic quality** | The project idea is genuinely good — someone experienced would say "that is a sensible way in" | A default intervention chosen because it is the obvious one |
| 3 | **Organisation fit** | The strategy plays to what this specific organisation can actually do | Could be delivered by any organisation; or requires capability the applicant lacks |
| 4 | **Specificity** | Concrete about place, people, sequence and numbers; unmistakably this applicant | Interchangeable prose; nouns could be swapped without breaking anything |
| 5 | **Problem → intervention logic** | The activities follow necessarily from the stated causes | Activities are plausible in general but not derived from the problem as stated |
| 6 | **Feasibility** | Deliverable at this budget, timeline and staffing | Targets or scope that would require materially more money, time or people |
| 7 | **Evidence use** | Uses what is genuinely known about the organisation, and is honest where nothing is known | Ignores available evidence, or leans on vague capability language to fill the gap |
| 8 | **Persuasiveness** | An evaluator finishes it understanding why this deserves funding | Competent but inert; gives the evaluator no reason to advocate for it |
| 9 | **Clarity** | Easy to assess; a reviewer can find each answer fast | Requires effort to work out whether a requirement was met |
| 10 | **Submission readiness** | A competent grant writer would send it as-is | Would require rewriting before sending, not just tweaking |

---

## 3. The acceptance bar

An average is the wrong instrument — it lets a proposal that is excellent on clarity and empty on strategy pass. So the standard is a set of **disqualifying conditions**, any one of which means the proposal is not benchmark-quality regardless of its scores.

**A proposal fails the bar if any of the following is true:**

1. **The central intervention is generic.** If the same intervention would be the obvious answer for any applicant to this grant, the strategy layer has not earned its cost.
2. **Organisation fit is questionable.** The proposed work does not follow from what this organisation is or does, or quietly assumes capability that is not evidenced.
3. **Sustainability is empty language.** "We will seek further funding" and "the community will take ownership" are not mechanisms. A real answer names what continues, who owns it, what it costs, and who pays.
4. **Available evidence is unused.** If the evidence ledger held usable material about the organisation and the narrative does not draw on it, the intelligence architecture ran and produced nothing.
5. **The problem statement does not lead to the activities.** A reader who covered the activities section could not predict it from the problem section.
6. **Targets feel arbitrary.** Round numbers with no derivation, or targets the listed activities plainly cannot produce.
7. **A major activity is unrealistic** at the stated budget, timeline or staffing.
8. **It reads obviously AI-generated** — uniform paragraph rhythm, tri-colon lists, abstract nouns doing the work of concrete ones, no authorial judgement anywhere.
9. **Donor priorities are named but not integrated.** The priorities appear in a sentence and change nothing about the design.

**Two further rules that override any score:**

- **Honesty about limits beats polish.** Where the applicant is a partial fit for the grant, a proposal that says so plainly and proposes a partnership scores higher than one that papers over the gap — even if the second reads better. Overclaiming is a failure, not a stylistic choice.
- **A failed dimension 10 fails the proposal.** Submission readiness is the product promise. If the evaluator would rewrite rather than tweak, nothing else rescues it.

**Recommended bar for launch:** a case passes only when it clears every disqualifier above **and** scores ≥3 on all ten dimensions **and** ≥4 on dimensions 1, 3, 6 and 10 (donor fit, organisation fit, feasibility, submission readiness). Those four are the ones a customer would notice, and the ones a donor punishes.

**Why this bar and not "average ≥ 80":** the four weighted dimensions are the ones where failure is visible to the buyer. A proposal can be stylistically strong and still be unfundable if it does not fit the donor, does not fit the applicant, cannot be delivered, or needs rewriting. Everything else on the list is recoverable by a customer with a revision round; those four are not.

---

## 4. How evaluation is run

- **Blind.** The evaluator receives the finished narrative and the grant text only. It never sees the strategy object, project design, evidence ledger, claim ledger, validator output, or any generation reasoning — the same view a donor's reviewer has.
- **Separate model family.** The generator is `google/gemini-3.7-flash`. Evaluation uses `openai/gpt-5.6-sol` and `x-ai/grok-4.6` — both from different families and both higher on the intelligence index (60.9 vs 56.0). The generator never grades its own work.
- **Two independent critics, not two runs of one.** Agreement between two different model families is materially stronger evidence than repeated sampling of a single model, and it exposes evaluator idiosyncrasy: where the two disagree sharply, that dimension is treated as unresolved rather than averaged.
- **Adversarial prompt.** The evaluator is instructed that most proposals it sees are mediocre, that a 4 or 5 must be earned, and that it must name the single weakest thing in the document. A critic that hands out 4s freely is useless.
- **Recurring weakness, not score.** The finding that matters is the one both critics raise on multiple cases. A single low score on one case is noise.

## 5. Where a donor publishes its own criteria

Several benchmark cases carry a real published rubric with weights. Those are assessed **separately and additionally**, scoring the proposal against the donor's own criteria and weights rather than ours — because that is what would actually happen to it.
