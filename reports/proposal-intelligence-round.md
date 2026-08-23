# Ktebli — Proposal Intelligence Round

**Worker v12 → v17 · engineering and product report**
Date: 22 August 2026 · Author: automated build session · Scope: the 56-part proposal-intelligence contract

---

## A. Current-state audit (what existed before this round)

The instruction was to audit before adding prompts. Every capability named in the contract was classified against the deployed v11 code, not against intentions. The table below is the audit as it stood at the start of the round.

| Capability | Classification | What was actually true |
| --- | --- | --- |
| Grant analysis and rubric extraction | implemented, good | One structured extraction producing issuer, requirements, criteria, format spec. Rubric extraction correctly returned an empty array when the donor published none — it did not invent one. |
| Exclusivity locking (DB level) | implemented, genuinely good | `claim_approach` as a `SECURITY DEFINER` function over partial unique indexes, with a sanctions gate and stale-hold expiry. Race-safe by construction. |
| Website understanding | implemented but **misleading** | The order form collected a website and printed it into prompts. Nothing ever fetched it. The model was free to infer an organisation's work from its domain name. |
| Strategy selection | implemented but **weak** | One shot. The model produced a single approach; there were no candidates, no feasibility scoring, and no substantive comparison against approaches already reserved on the grant. |
| Similarity control | implemented but **weak** | A word-overlap cap of 25 on final text only. Wording-level. Two customers could receive the same project under different sentences and pass. |
| Fact validation | prompt-only, and **gated to Full tier** | A "don't invent facts" instruction with no verification step, and the review that might have caught inventions ran only on the top tier. This contradicted Part 34 of the contract. |
| Budget consistency | implemented but **misleading** | Spreadsheet formulas recomputed correctly, so totals were internally consistent — but nothing checked the total against the donor ceiling or against the narrative. |
| Project design | **not implemented** | Each document was generated from the grant text plus the previous document. There was no shared underlying project. |
| Numerical consistency across documents | **not implemented** | No check that the narrative, workplan, logframe and budget agreed on participants, duration, or cost. |
| `fingerprints`, `similarity_reports`, `intakes`, `documents` tables | **unused / misleading** | Present in the schema, referenced nowhere in the worker. They implied capabilities that did not exist. |

The honest summary: v11 produced well-formatted documents with correct spreadsheet arithmetic, and its exclusivity locking was real. Its *intelligence* was thin, and two of its stated guarantees — website understanding and fact validation — were not delivered by the code.

---

## B. Problems found

Six problems mattered enough to change the architecture.

**1. Nothing understood the applicant.** The single largest quality gap. With no website ingestion and no evidence store, the engine had roughly forty words about the organisation and a grant page. Everything specific it then wrote about the applicant was either generic or invented.

**2. Truth was a premium feature.** Fact-checking ran on Full tier only. A Draft-tier customer could receive a proposal containing fabricated organisational history and nothing in the pipeline would catch it. The contract is explicit that truth is mandatory everywhere.

**3. Uniqueness was enforced at the wrong layer.** The similarity gate compared *wording*. The promise is about *strategy and substance*. Paraphrase defeated the gate entirely, and the gate could not see that two proposals described the same project.

**4. Documents were a chain, not a system.** The workplan was written from the narrative, the budget from the workplan. Errors propagated forward and numbers drifted, because no single object held the project's real figures.

**5. Reasoning effort was never set.** The workhorse model has mandatory reasoning that defaults to medium. Every call in v11 — including trivial extractions — paid for medium reasoning. Nothing was set high where it would actually have helped.

**6. The revision path skipped the exclusivity gate.** `request-revision` appended `revise → package → deliver` with no `check` stage. A revision could drift into another customer's territory and ship.

---

## C. Architecture implemented

The design rule was the smallest coherent architecture, not the most impressive one. That meant **one new table, one new column, three new stages, and one stage that replaced three**.

```
analyze  → Grant Intelligence Object (requirement matrix, real rubric,
           donor structure, budget rules, format spec)
org      → deterministic website crawl → ONE extraction call →
           Organisation Profile + Evidence Ledger + voice guide + gaps
           (cached in org_intel, 30-day freshness + content-hash reuse)
voice    → previous proposals → dated evidence facts + writing voice
           (two outputs, one call)
strategy → 4 candidates → feasibility filter → distinctness vs reserved
           → TRANSACTIONAL reservation via the existing DB locks
design   → Project Design Object + Assumption Register
           (problem → causes → activities → outputs → outcomes)
gen:*    → every document derived from the SAME design object
validate → deterministic checks + Claim Ledger + requirement coverage
           + evaluator review + bounded correction rounds
check    → exclusivity gate on final text (also after revisions)
package  → unchanged v11 document contract + render QA
```

New persistent state: `org_intel` (one row per organisation: profile, evidence, voice, gaps, crawl metadata, content hash) and `claims.strategy` (the reserved approach as an abstract record). Everything else lives on `job_stages.output`, which makes each stage's reasoning inspectable without new tables.

**Website intelligence** is staged deliberately so it stays cheap: sitemap and homepage-link discovery, regex page ranking (about/programmes/impact score high; privacy/terms score negative), non-LLM text extraction, paragraph-level dedupe so navigation and footers collapse, then **one** structured extraction call over the deduplicated corpus. Hard caps: 14 fetches, 10 pages, 60 KB total, 9-second timeout, same-domain only, SSRF-safe throughout. Measured on a real site: 57 URLs discovered, 10 fetched, 40 KB kept, 29.7 seconds, one LLM call.

**The Evidence Ledger** is the mechanism behind the anti-hallucination promise. Every fact about an organisation carries an ID, a source type (`user_intake` / `organisation_website` / `previous_proposal`), a source reference, a date context, and a status (`verified` / `historical` / `undated`). Generation prompts receive the ledger with an instruction that is unambiguous: *if a fact is not in this ledger, it does not exist for this proposal*. When the ledger is empty, the prompt switches to a different branch entirely — write credibly without any track-record claims.

---

## D. Model and call architecture

One workhorse model, `google/gemini-3.7-flash`, with reasoning effort set per task and a separately configurable model for the two stages where judgement matters most.

| Stage | Calls (typical) | Effort | Model |
| --- | --- | --- | --- |
| analyze | 1 | low | workhorse |
| org | 0–1 (0 on cache hit) | low | workhorse |
| voice | 0–1 (0 with no uploads) | low | workhorse |
| strategy | 1–2 | **high** | `MODEL_STRATEGY` |
| design | 1–4 | **high** | `MODEL_STRATEGY` |
| gen:* | 1 per document (+ repair) | low | workhorse |
| validate | 2 per round | low / **high** on Full | workhorse / `MODEL_STRATEGY` |
| check | 0 (1–2 only if overlap) | low | workhorse |

`MODEL_STRATEGY` reads from the Vault secret `openrouter_model_strategy` and falls back to the main model. Today both resolve to the same model at different reasoning efforts; upgrading strategy and design to a stronger model is a one-secret change with no redeploy.

**Measured per-tier economics** (Draft tier, four live runs on the same grant):

| Metric | Measured |
| --- | --- |
| Calls per proposal (Draft) | 7–11 |
| Wall-clock, clean run end to end | **~2.4 minutes** |
| Cost per Draft proposal | **~$0.07** |
| Cost, whole regression round (incl. every rerun and seeded test) | **$0.85** |

Estimated for the higher tiers, scaling by document count and review depth: Competitive ~12–15 calls, ~$0.12–0.18; Full ~17–20 calls, ~$0.20–0.30. All are far inside the 5–30 minute processing window the contract sets, and roughly half my pre-implementation estimate.

---

## E. Exclusivity architecture

Exclusivity is enforced at three levels, and only the first two are about substance.

**Level 1 — strategy generation.** The strategist receives *abstract* records of approaches already reserved on the grant: intervention type, delivery method, beneficiary, geography bucket, and the structured strategy object. It never sees another customer's proposal text, organisation name, or facts. It generates four candidates and self-assesses each as `clear`, `borderline`, or `same` against those reserved records, judging substance — problem framing, intervention, beneficiary handling, sustainability, thesis — with an explicit instruction that renaming is not distinctness.

**Level 2 — transactional reservation.** The database is the arbiter, not the model. Partial unique indexes on `(grant, intervention, delivery, beneficiary, geography)`, on structural template, on opening device, and on house voice — all scoped to `status IN (hold, confirmed)`. `claim_approach` runs inside a transaction, classifies unique-violations by cause, and returns a reason. The worker walks its ranked candidates against free template and opening slots; a `concept_combination` collision moves to the next candidate; exhaustion **fails safely** (holds the order with persisted diagnostics) rather than forcing artificial divergence.

**Level 3 — final text gate.** Longest-common-word-run against every other proposal on the grant, capped at 25, with up to two automated rewrites, and it now runs after revisions as well.

**Live evidence.** Four organisations applied to one synthetic grant, with B and C reserving **simultaneously**:

| Organisation | Intervention reserved | Delivery | Beneficiary | Template/Opening |
| --- | --- | --- | --- | --- |
| Amel Association | integrated MHPSS + livelihoods | mobile/centre hybrid | caregivers + street-connected youth | 1 / 1 |
| Cedar Community | culinary microbusiness + peer support | community hub | female-headed households | 2 / 2 |
| Horizon Development | savings groups + climate-resilient kitchen gardening | cohort training + savings groups | low-income female-headed households | 3 / 3 |
| Riverstone Aid | (distinct fourth approach) | — | — | 4 / 4 |

Zero lock collisions, four structurally distinct approaches, four distinct template/opening pairs. **Org C was deliberately steered toward Org A's reserved approach** through customer directions asking for "an integrated MHPSS plus livelihoods programme — exactly our vision". The strategist declined it and selected a genuinely different one, recording why: *"Distinct from the reserved approach's mobile protection unit and street-connected youth focus; centers on hub-based communal food production cooperatives and home-bound female heads of households."* That is the promise working as specified — the steering was honoured in spirit (livelihoods for vulnerable women) without duplicating the reserved substance.

**Cross-customer privacy assertion.** A SQL scan across every strategy, design, narrative and validate output on the shared grant, searching for any other test organisation's name or domain, returned **zero rows**.

---

## F. Grounding architecture

Four information types are handled distinctly: verified fact, historical fact requiring time-framing, future design element, and model-proposed assumption.

The **Claim Ledger** runs on the final narrative for **every tier**. It extracts each material claim about the organisation's past or present and classifies it as `supported`, `qualified`, `model_proposed_future`, `stale`, `conflicting`, or `unsupported`. Material claims in the last three categories **block delivery** until corrected.

The correction prompt carries the rule that makes this more than theatre:

> A weak section may NEVER be strengthened by adding organisational history, results, partnerships or credentials that are not in the evidence ledger. You may reorganise existing evidence, qualify honestly, or remove. **Evidence integrity outranks evaluator score.**

Three deterministic checks run free on every round, before any model call: numeric consistency against the design (participants, duration, budget total), budget total against ceiling and envelope, and a jargon watchlist.

**Seeded-failure evidence.** A narrative was overwritten with eight deliberate violations and pushed through validation. Round 0 caught all of them:

| Seeded violation | Caught by | Result |
| --- | --- | --- |
| "trained 12,000 women since 2015" (invented track record) | Claim Ledger — unsupported | removed |
| "63 percent reduction" (fabricated statistic) | Claim Ledger — unsupported | removed |
| "When Amira walked into our kitchen…" (fictional anecdote) | Claim Ledger — unsupported | removed |
| "partnership with the Ministry since 2019" | Claim Ledger — unsupported | removed |
| 4,800 participants vs design's 50 | deterministic consistency scan | corrected |
| 36-month horizon vs design's 12 months | deterministic consistency scan | corrected |
| jargon overload | deterministic scan: *transformative ×3, cutting-edge ×2, holistic ×2* | rewritten |
| Question 5 deleted entirely | requirement coverage — 6 missing mandatory | restored |

Round 0 recorded **14 blocking findings**; round 1 recorded **0**. The corrected text contains none of the fabrications and now answers all five donor questions. Every case failed for the right reason.

---

## G. Missing-information handling

Gaps are recorded with severity — `blocking`, `important`, `non_critical` — during the org stage, by comparing what the donor asks for against what the evidence ledger actually holds. When the donor asks about organisational experience and no past-delivery evidence exists, that is recorded as `important`, and the generation prompt switches to its no-track-record branch rather than filling the hole.

**The intake was not lengthened.** The contract is explicit that onboarding must not become a forty-question consultation, and it did not change at all. The trade-off is deliberate: short customer intake, deep automated understanding behind the scenes.

The natural future improvement — and it is a UX change, not an engine change — is a single optional follow-up email of the form "a few things would make this stronger", sent after payment while the pipeline runs. It is not built, and it should not be built until there is evidence customers want it.

---

## H. Changes implemented

Deployed and verified byte-identical against local source at each step: **worker v12 → v19**, **stripe-webhook v9**, **request-revision v3**, plus one migration (`org_intel` table, `claims.strategy` column).

Eight of these changes were driven by defects the regressions actually found — not by speculation. Two of them (7 and 8) were caused by an earlier fix in this same list, which is the honest shape of the round: tightening one guarantee exposed the next weakness behind it.

1. **Evidence-poor feasibility bug** (found on KT-10002). With an empty evidence ledger, the strategist scored all four candidates infeasible and the order held with "strategy space exhausted". An organisation with no website was being treated as an organisation that cannot execute. Fixed: a thin ledger is explicitly not proof of incapacity; modest well-matched strategies should score 60+; an evidence-poor applicant gets a modest credible strategy, never a refusal. KT-10002 then completed end to end with feasibility 86.
2. **Unrecoverable word-limit failures.** Narratives that exceeded the donor limit had no route back — the repair prompt was told *that* it violated a rule but not by how much. Added a deterministic markdown sanitiser (whole-document code fences and horizontal rules are layout, not content, and are stripped in code) and a quantified repair instruction: "the draft is N words against a limit of M, cut at least K".
3. **Cited history flagged as inconsistency.** The consistency scanner flagged a legitimate, ledger-sourced statistic — "assisted 1,250 individuals in 2024" — as contradicting the project's participant total of 120. Figures that appear verbatim in the evidence ledger are now exempt from the contradiction scan. A fabricated figure is not in the ledger, so it is still caught here, and the Claim Ledger catches it independently regardless.
4. **Donor-mandated headings counted as plagiarism.** All four proposals reported a shared run of exactly 25 words — the cap. The cause: the donor defines the application structure, so every applicant must use the same long question text as headings. The gate was measuring compliance as copying. With a slightly longer donor question this would have blocked delivery outright. Donor-mandated lines are now excluded from both sides before measuring. After the fix, shared runs fell to 12–24 across the four proposals, with 10 donor lines excluded each.
5. **Over-limit delivery.** A 5% tolerance on the word limit meant a proposal shipped at 1,863 words against a hard 1,800-word limit. A donor portal with a hard cap would have rejected it. The limit is now enforced exactly, and generation targets ~94% of the cap so the reviewer's corrections have room. Our word counter errs high against a word processor's count (table pipes and hyphens split into extra tokens), so exact enforcement is conservative rather than over-strict.
6. **Revision flow skipped exclusivity** (found in the audit). `request-revision` v3 now appends `revise → check → package → deliver`, and the revise stage runs its own inline grounding audit.
7. **Fenced blocks had no deterministic repair.** Tightening the word limit pushed the model into emitting code fences during its shortening pass, and three consecutive attempts failed on a document that was otherwise good. A fence in a proposal is always a formatting mistake, never content, so the marker lines are now stripped in code while the text inside is kept — and anything the fence was hiding (ASCII art, box drawing) is still caught by the checks that run afterwards.
8. **The word counter itself was wrong.** This one was self-inflicted by change 5 and is the most instructive of the round. The counter replaced markdown characters with spaces, which split `community-based` into two words and turned table pipes into tokens; measured against a delivered narrative it over-counted by ~3% on prose and more on table-heavy documents. Enforcing the limit *exactly* against an inflated count then refused a Cedar proposal that was genuinely inside 1,800 words — the opposite failure to the one change 5 fixed. The counter now removes markdown syntax rather than substituting spaces and leaves hyphens intact, matching a word processor on every fragment shape tested. With an accurate counter, exact enforcement is fair in both directions, and Cedar delivered at 1,672 words.

Also: reasoning effort is now explicit per task (low by default, high for strategy, design and deep review); usage accounting is snapshotted on every stage that makes calls; the Full-tier review report is built from the validate stage's real results rather than from a template.

---

## I. Regression evidence

Every figure below comes from a live production run, not a simulation.

**KT-10002, old versus new — substance.** The old proposal was generic prose for an organisation the engine knew nothing about (`gv7bg6`, no website, no uploads), containing unsupported organisational claims because nothing prevented them. Under the new architecture the same order produced: a reserved strategy (`action_lab_hackathon`, feasibility 86) with a real thesis — *"structuring the forum as an intensive, output-driven venture sprint… rather than symbolic dialogue"*; a project design with 50 participants over 10 months at a $84,500 envelope; a Claim Ledger with **zero** unsupported claims (correctly, since the ledger was empty, the narrative makes no track-record claims at all); and validation clean in a single round.

**Four-organisation same-grant run.**

| Organisation | Requirements covered | Bad claims | Words / limit | Shared run | Donor lines excluded |
| --- | --- | --- | --- | --- | --- |
| Amel Association | 17 / 18 | 0 | 1,633 / 1,800 | 16 | 10 |
| Cedar Community | 11 / 12 | 0 | 1,672 / 1,800 | 19 | 10 |
| Horizon Development | 18 / 20 | 0 | 1,633 / 1,800 | 16 | 10 |
| Riverstone Aid | 13 / 14 | 0 | 1,596 / 1,800 | 12 | 10 |

Every proposal is inside the donor's word limit, every one carries zero unsupported claims, and each was compared against all three peers with the donor's own mandated question headings excluded from the measurement.

All four used the donor's published criteria as the review basis (`rubric_basis: donor_criteria`), all four used the donor's five questions verbatim as section headings, and all four carried zero unsupported, stale, or conflicting claims into delivery.

**Revision-drift test.** A completed proposal's revision output was replaced with text closely resembling another organisation's proposal on the same grant, then a `check` stage was appended. The gate attempted two automated rewrites, could not get the overlap under the cap, and **held the order** with `similarity gate: shared run of 26 words after 2 automated rewrites`. It did not deliver drifted text. This is the fix from change 6 proving itself.

**Concurrency stress.** Orgs B and C entered their strategy stages simultaneously. Both reserved successfully, on different concept combinations and different template/opening slots, with no collision and no retry.

---

## J. What is not yet proven

Stated plainly, because a report that only lists successes is not useful.

- **The render-validation container is still not deployed.** This is the one item from the previous round that remains open, and it is blocked on infrastructure this session cannot provision (Vercel cannot run LibreOffice; Supabase has no container runtime). Until a real URL exists, `render_service_url` and `render_service_secret` must stay unset in Vault. Consequence, by design: any grant with a hard **page** limit blocks delivery rather than guessing, because without a real render there is no verified page count. Word limits are unaffected.
- **The final similarity gate is lexical, not semantic.** It measures word runs. Substantive distinctness is enforced upstream at the strategy layer, which is the right place — but the last gate would not catch a full semantic paraphrase on its own. The `fingerprints` table remains unused; embedding-based comparison is the natural next step.
- **Grant identity is an exact normalised title-and-funder match.** Two customers who paste differently-worded versions of the same opportunity can land on separate grant rows and therefore never be compared against each other. This is the most consequential open risk to the exclusivity promise at scale.
- **Usage accounting is approximate under concurrency.** The counter is module-level and the worker runs three stages in parallel, so per-stage token attribution can bleed between concurrent stages. Totals are sound; per-stage figures are indicative.
- **The Claim Ledger runs before the check stage's rewrites.** A meaning-preserving rephrase after the ledger is accepted without re-auditing. The risk is low because rewrites are instructed to preserve meaning, but it is a real ordering gap.
- **One seeded-test run initially recorded a false pass** because the test harness wrote the seeded narrative while the validate stage was already reading it. The clean re-run caught all eight violations. Worth recording because it is exactly the kind of race that makes a test suite lie.

---

## K. Priority order, as implemented

Truth → donor compliance → credibility and feasibility → strategic distinctiveness → internal consistency → persuasiveness → writing elegance.

Two decisions in this round were made *against* the lower priorities to protect the higher ones, and both are worth naming. Enforcing the word limit exactly will occasionally cost a repair round and some elegance — donor compliance outranks both. And the strategy stage still fails safely rather than forcing a divergent strategy when the space is genuinely exhausted — an honest hold outranks a delivered proposal that is unique but not credible.

The three promises now have mechanisms behind them rather than instructions: **good enough to submit** (requirement coverage plus evaluator review against the donor's real criteria), **factually grounded** (Evidence Ledger plus Claim Ledger, on every tier), and **genuinely distinct** (candidate strategies, feasibility filtering, and database-transactional reservation at the level of substance).
