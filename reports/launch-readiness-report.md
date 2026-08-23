# Ktebli — Launch Readiness Report

**Question 1:** Does Ktebli consistently produce proposals a competent grant writer would consider submission-ready?
**Question 2:** Is the surrounding service robust enough for real paying customers?

**Baseline at start:** worker v19 (frozen). **Baseline at end:** worker v26. Ten changes, each traced to a concrete test failure; all recorded in section G.
**Benchmark outcome:** 11 of 13 orders completed. The two that did not are both heavy-tier (Competitive, Full) and both failed the same way — see section H.
**Recommendation:** **NOT_READY** for paid launch. Reasoning in section M.

---

## A. What was tested, and how

Thirteen real orders were put through the live pipeline as paying customers would experience them — Stripe-created order rows, real queue, real models, real delivery. Ten fictional archetype cases (B1–B10) covering evidence-poor and evidence-rich applicants, strict-format solicitations, technical grants, tight word limits, partial-fit applicants, and all three tiers. Three additional cases (R1–R3) used **real organisations with real websites** — UK Youth, Practical Action, The Felix Project — paired to the same grants as three of the fictional cases, changing exactly one variable so the effect of website intelligence could be isolated.

Quality was judged **blind** by two critics from different model families — `openai/gpt-5.6-sol` and `x-ai/grok-4.6`, both above the generator (`google/gemini-3.7-flash`) on the intelligence index. Each saw only the grant text, the applicant's name/website/registration, and the finished narrative. No strategy object, no evidence ledger, no claim ledger, no validator output, no word counts, no mention of Ktebli or of how the document was made. The generator never graded its own work. The rubric and acceptance bar are in `quality-standard.md` and were written before any case ran.

Exclusivity, capacity and idempotency were tested at the database level, where the answers are deterministic and cost nothing.

**What this report does not cover.** The payment/access/email/revision/injection/file-safety audit (Parts 15–27) was carried out earlier in the session against the edge-function source. Its conclusions are not restated here in detail because they were not re-verified in this pass; the two findings I did re-confirm directly appear in section J. Treat Parts 15–27 as audited but pending restatement, not as unexamined.

---

## B. Quality — the core answer to Question 1

**No case passed the acceptance bar. Under either critic. Not one was marginal.**

The bar: clear every disqualifying condition, score ≥3 on all ten dimensions, and ≥4 on donor fit, organisation fit, feasibility and submission readiness.

### Round 1 — evidence-poor applicants (B2, B4, B5, B8; no website)

| Judgement | GPT-5.6 | Grok-4.6 |
| --- | --- | --- |
| Not fundable as submitted | 4/4 | 4/4 |
| Reads machine-generated | 4/4 | 4/4 |
| Central intervention generic | 3/4 | 4/4 |
| Targets arbitrary | 4/4 | 3/4 |
| Passed the bar | 0/4 | 0/4 |

The obvious objection was that these applicants were fictional with no crawlable website, so the evidence ledger was nearly empty and the intelligence architecture had nothing to work with. That objection is legitimate and it is why round 2 exists.

### Round 2 — evidence-rich applicants (B1, R1, R3)

R1 is UK Youth. The crawler pulled **12 concrete facts** off their real site: founded 1911, a 9,000-organisation network, named corporate partnerships with figures, real programme numbers.

Both critics still said: **generic intervention, machine-generated, and — the word both reached for — "swappable"**. GPT-5.6, asked to quote the most organisation-specific sentence it could find, returned a sentence that was little more than the name and registration number restated. Grok said the same of all three.

**A rich evidence ledger did not fix the problem.** That resolves the confound in the direction I did not want: the quality failure is real and is not an artifact of the test.

### What both critics kept naming

Uniform phase tables. Identical bullet cadence. Three-part parallel constructions. Grant-template diction — "structural problem", "capacity transfer", "civic backing", "relational inquiry", "synthesises". Pseudo-precise figures with no derivation. And, repeatedly, the absence of proper nouns. Grok's phrasing, on more than one case: *"no messy local nouns — no place names, vendors, staff CVs, or prior results."*

Both critics also caught internal arithmetic errors that the deterministic consistency checker passed: B1 states 200 beneficiaries where its own components sum to 216; R3 states overhead at 10.51% where its own figures give 11.74%.

---

## C. The naive baseline (Part 6) — the most uncomfortable result

Three cases were regenerated with **one strong prompt to the same model**, no pipeline: no grant analysis stage, no organisation research, no strategy reservation, no project design, no validation loop, no claim ledger. The prompt was written to be genuinely good, not a strawman. Both outputs were then scored by the same evaluator against the same rubric.

| Case | Ktebli pipeline | Single prompt |
| --- | --- | --- |
| B2 | 25 / 50 | **27 / 50** |
| B5 | 24 / 50 | 24 / 50 |
| B8 | 22 / 50 | **26 / 50** |

**The single prompt matched or beat the full architecture on all three cases.**

Caveats, stated plainly because they matter:

- These are the three evidence-poor cases, where the pipeline's main differentiator was inert by construction. A like-for-like baseline on the evidence-rich cases has not been run. But R1 — twelve real facts, full pipeline — still scored 2s on organisation fit and specificity, so there is no strong reason to expect the gap to open up there.
- **The baseline blew a hard word limit on one of three cases, by 42%** (2,137 words against a stated 1,500). That application would be discarded. Ktebli has never shipped over a limit in any test.
- The baseline offers no exclusivity. Two customers applying to the same grant would receive near-identical proposals. Ktebli's locks make that structurally impossible.
- n=3, one evaluator, one run. Directional, not conclusive — but it points the same way as everything else in this report.

**Read honestly: the architecture is currently earning compliance and exclusivity, not quality.** Those are real and worth something. They are not what the pricing and the tagline promise.

---

## D. Website intelligence (Part 7)

Your instruction was: *do not celebrate a crawler because it extracted 200 facts if none improved the result.*

| Case | Site | Facts extracted | Effect on the proposal |
| --- | --- | --- | --- |
| R1 UK Youth | ukyouth.org | 12 | No measurable improvement — still "swappable" under both critics |
| B1 Beit Al-Shabab | amel.org | 8 | **Actively harmful — wrong organisation entirely (section E)** |
| R2 Practical Action | practicalaction.org | crawl succeeded | Narrative never completed (section H) |
| R3 The Felix Project | thefelixproject.org | **0** | Silent failure on a live, content-rich charity site |

Two conclusions. First, the crawler works on some real sites and returns nothing at all on others, with no error and no signal to the customer — R3 is a large, well-known charity with a rich website. Second, and more important: **where extraction worked best, it changed nothing.** The facts UK Youth publishes are institutional boilerplate — founding year, network size, corporate partners — and a proposal needs operational specifics. Extraction volume is not the constraint.

---

## E. The factual-grounding failure (P0, fixed)

This is the most serious single finding of the round.

Case B1's applicant was "Beit Al-Shabab Community Association". The website on the order was `amel.org`, which belongs to **Amel Association International**, a much larger Lebanese NGO. Every fact from that site entered the Evidence Ledger marked `allowed`, was classified **"supported"** by the Claim Ledger, and was written into the narrative as the applicant's own history:

- "has operated its community centre in Tyre since 1984"
- 40 centres, a 1,500-person workforce, operations in 10 countries
- "reached 101,581 people across 187 sites"
- a Nobel Peace Prize nomination

`identity_flags` came back **empty**. The reason: `identityCheck()` only ever validated the *shape* of the input strings — is the name gibberish, is the URL well-formed, does the registration number contain a digit. **Nothing in the pipeline ever asked whether the website belonged to the applicant.**

This is worse than invention, because it is verifiable. A customer submitting that proposal would be making false, checkable statements to a funder about their own track record. The real-world triggers are entirely ordinary: pasting a parent or umbrella body's site, a coalition site, a similarly-named organisation, or a typo'd domain.

**Fixed in v23/v24**, deliberately asymmetric: anything short of a confident name match rejects the site outright. Discarding real evidence costs a thinner proposal, which the system already handles honestly. Admitting the wrong organisation's evidence costs the customer their credibility. The gate runs after every path that can populate web evidence, including cache hits, because a cached extraction of the wrong site is exactly as damaging as a live one. The customer is told plainly, in a "Before you submit" document: we looked at this site, it does not appear to be you, we used nothing from it, send us the right one.

**Verified after the fix, end to end.** B1 was re-run from the organisation stage. The gate detected `site_legal_name: "Amel Association International"` against `supplied_org: "Beit Al-Shabab Community Association"`, **discarded all 8 web claims**, and dropped the evidence ledger from 11 items to 3 (intake only). The order then completed all ten stages and delivered. The delivered narrative was checked directly: **no mention of Amel, no 1984, none of the borrowed figures (187 sites, 101,581 people, 1,500 staff, 40 centres), no Nobel nomination.** 1,404 words, inside the donor's limit. The proposal is now thinner and honest rather than impressive and false.

---

## F. Exclusivity and the capacity ceiling (Parts 9–11) — P0, not fixed

Exclusivity is enforced by five partial unique indexes per grant: one claim per organisation, one concept tuple, one structural template, one opening device, one house voice. The mechanism is sound — it is transactional, race-safe, and cannot be talked around by a model.

But two of those locks are on **enumerable finite pools**: there are exactly **8 structural templates and 8 opening devices**.

Tested directly with ten applicants on a clean grant, each bringing a genuinely distinct concept so the concept lock never fired:

| Applicant | Granted | Blocked by |
| --- | --- | --- |
| 1–8 | ✅ | — |
| 9 | ❌ | `structural_template` |
| 10 | ❌ | `structural_template` |

**Ktebli can serve a maximum of 8 proposals per grant, ever.** The exclusivity promise is real and it is the constraint.

What happens to the ninth customer: the strategy stage throws `claim blocked: strategy_space_exhausted`, the stage is marked `held`, the order rolls up to `attention` — **and stops there**. `sendEmail` is called in exactly one place in the worker: the deliver stage. **No email fires for a held or attention order.** The ninth customer pays $149, receives nothing, and is never told.

Nothing checks slot availability before payment. This is a business-model decision as much as an engineering one, so I have not picked a fix. The options are: enlarge the template and opening pools; check availability at checkout and refuse the sale; sell explicitly as "slot 6 of 8"; or accept the order into a queue with automatic refund on exhaustion. All four are defensible; they are not mine to choose.

---

## G. What broke, and what was changed (Part 1 discipline)

v19 was frozen. Ten changes were made. Every one traces to a test that produced a concrete failure; none was speculative.

| # | What failed | Why | Fix | Ver | Before → after |
| --- | --- | --- | --- | --- | --- |
| 1 | B1/B3/B10 hard-failed `gen:narrative` on `over_word_limit`, 3/3 | The brief hardcoded "(1500-2500 words)"; B1's donor ceiling was 1,400, so the brief's *floor* was above the donor's *limit* | Donor limit replaces the brief's range, with ~6% headroom | v20 | 3 failures → B1 completes |
| 2 | B6 hard-failed `validate` after 2 rounds | Donor eligibility self-certifications (banking, debarment) can never be evidenced; classified `unsupported` and blocked, then oscillated: remove → mandatory requirement missing → restate → ungrounded | Narrow `donor_required_certification` class, excluded from grounding blocks, every one surfaced to the customer in a "Before you submit" document | v21 | Deadlock → validate passes |
| 3 | B9 hard-failed `gen:cover_email` on `ends_mid_sentence`, 3/3 | The check catches truncation; a cover email legitimately ends "Maria Haddad / Executive Director" with no terminal punctuation. Deterministic failure on both paid tiers above Draft | `signoff` option exempts a short final line for cover emails only | v21 | 3 failures → passes |
| 4 | B7 reaped as `[timeout]`, 3/3 | Up to twelve model calls per generation with no heartbeat between them; the reaper killed live work at 3 minutes | Every model call heartbeats, throttled to 20s, beating all stages in flight (a single global would have beaten one and let its siblings die) | v21 | Reaped at ~180s → survived 807s |
| 5 | B3/B10/R2 `over_word_limit` persisted | A model cannot count its own words, so restating the same target reproduces the same overshoot | Escalating targets across attempts: 0.94 → 0.85 → 0.78 of the limit | v22 | B3, B10 complete |
| 6 | B6 `package: heading_missing` | Under length pressure the model shortened a donor-mandated heading | Headings declared verbatim-mandatory; prose is what gives way | v22 | — |
| 7 | Validate's correction pass blew the limit | The correction answers findings by *adding*, and nothing in that prompt ever mentioned a ceiling | Correction prompt carries the limit and the current count, and must not grow the document | v22 | B3 completes |
| 8 | **B1 attributed another organisation's history to the applicant** | No check that the website belongs to the applicant (section E) | Deterministic name/domain identity gate on every evidence path, cache included | v23/24 | 8 false claims admitted → 8 discarded |
| 9 | B6 `heading_missing` on the one heading of five containing an apostrophe | The docx writer escapes `'` as `&apos;`; the entity decoder knew `&#39;` but not `&apos;`, so a correct document was rejected | Decoder handles named, decimal and hex forms of all five entities | v24 | B6 completes |
| 10 | B9 `content validation at render: ends_mid_sentence` | Fix #3 was applied at generation but not at render — the same check ran again without the option | `signoff` passed at render time | v24 | B9 completes |

Also added in the final pass, unproven because R2 has not completed: when length is the *only* remaining violation, the last attempt **shortens the existing draft** rather than regenerating from the original prompt. R2 burned all three attempts writing a fresh over-length document each time.

**Deploy discipline held throughout, and earned its keep.** Every deployment (v20–v26) was fetched back and compared byte-for-byte against local source with `difflib`. Six verified identical on the first attempt. **v25 did not**: a JSON over-escaping error wrote literal `\"` sequences into 58 lines — every bare double quote inside template literals, including the prompt schemas for six stages, the docx font checks, and the delivery email's link. It was caught by the byte comparison, never ran a customer stage, and was corrected in v26. That is precisely the class of silent corruption that a "looks fine" review would ship. **Keep this check mandatory.**

**Final deployed version: v26**, verified identical.

---

## H. Throughput and the 5–30 minute promise (Parts 12, 14, 30)

Measured across all completed stages:

| Stage | n | p50 | p90 | max |
| --- | --- | --- | --- | --- |
| `gen:narrative` | 8 | 62s | 262s | 272s |
| `design` | 10 | 40s | 73s | 81s |
| `validate` | 6 | 42s | 73s | 79s |
| `strategy` | 13 | 31s | 56s | 61s |
| everything else | — | <25s | <29s | 29s |

**Unqueued, a Draft order takes about 3 minutes at p50 and about 8 minutes at p90.** The engine is comfortably inside the promise.

**Queueing is the risk, not generation.** The global concurrency cap is 6, with 3 stages per isolate. A 10-order burst saturated it immediately and starved four cases for a long stretch. The promise is safe for the arrival rates a launch will realistically see and breaks under a burst; it is a capacity-planning parameter, not a defect.

**The real ceiling is on the heavy tiers.** B7 (Competitive) and R2 (Full-scale narrative with a rich ledger) both failed repeatedly with the isolate dying mid-generation — B7 stayed alive and heartbeating for **807 seconds** before being lost. A single edge-function invocation cannot reliably complete a large-tier narrative that needs more than one generation attempt. More evidence makes the document longer, which makes retries more likely, which makes the overrun more likely. This is architectural: the fix is to make generation resumable or to move heavy generation off the edge runtime. It is not a prompt problem and I have not papered over it. **Competitive and Full are not currently deliverable at acceptable reliability.**

---

## I. Economics (Part 13)

| Tier | Price | Measured model cost | Gross margin |
| --- | --- | --- | --- |
| Draft | $149 | ~$0.11–0.20 | >99% |
| Competitive | $299 | higher, not cleanly isolated | >99% |
| Full | $449 | higher, not cleanly isolated | >99% |

Derived from account-level OpenRouter spend across the benchmark rather than from the worker's own accounting, because **the per-stage `usage` counter is a module-level global shared by up to three concurrent stages**, so recorded per-stage costs are cross-contaminated. That is an observability defect (P2), not a spending one.

**Unit economics are not a launch risk.** Even with retries, failures and re-runs, cost per order is rounding error against price. There is ample room to spend more per proposal on quality — which, given section C, is where the money should go.

---

## J. Service robustness (Parts 15–27, partial)

Re-confirmed directly in this pass:

- **Order access.** The order page is keyed on a UUID `token`, not the human-readable `KT-nnnnn` order number. The order ID is not an authentication secret. ✅
- **Event log integrity.** `events` is enforced append-only at the database level — an attempted cleanup delete was refused by a trigger. That is the right design and it held. ✅
- **Attention routing.** Orders correctly roll up to `attention` when a stage fails or is held; the state exists and works. ✅
- **Attention notification.** ❌ Nothing is sent. `sendEmail` appears once in the worker, in the deliver stage. A customer whose order fails is never told, and no operator is alerted.
- **Recovery.** ❌ Resetting a stage at or before `strategy` leaves the organisation's prior claim held, so the retry is permanently blocked by `existing_claim_same_org`. I hit this operating the system myself. Any recovery attempt that rewinds past strategy strands the order unless the claim is released by hand.

The remaining items in Parts 15–27 were audited earlier in the session and are not restated here. They should be re-verified before launch rather than assumed.

---

## K. Observability and drift (Parts 26–28)

- Per-stage token accounting is unreliable under concurrency (section I).
- There is no quality-drift monitor. Nothing would detect the degradation this report documents if it appeared in production — the validators pass these proposals.
- **This is the point that matters most for monitoring design:** every failing proposal in section B passed every internal validator. Compliance instrumentation cannot see quality. Any drift monitor built on validator output would have reported perfect health throughout.

---

## L. Classification

### P0 — blocks paid launch

1. **Proposal quality does not beat a single prompt** (sections B, C). The product's central promise is unmet.
2. **The 8-per-grant ceiling with no pre-payment check and no notification** (section F). The ninth customer pays and silently receives nothing.
3. **Competitive and Full tiers do not reliably complete** (section H). Two of three price points are undeliverable.
4. **No failure notification to customer or operator** (section J). Every failure mode is silent.
5. ~~Website evidence attributed to the wrong organisation~~ — **fixed and verified this round** (section E). Listed because it was live in v19, the version that was about to launch.

### P1 — fix before scaling, not necessarily before a supervised beta

6. Recovery past the strategy stage strands orders on a stale claim (section J).
7. The crawler fails silently on some real sites (section D).
8. The deterministic consistency checker misses internal arithmetic errors both critics caught (section B).
9. No quality-drift monitoring, and validator-based monitoring would be blind to it (section K).

### P2 — real, low urgency

10. Per-stage cost accounting cross-contaminated under concurrency (section I).
11. Currency defaults to USD regardless of the applicant's country — a UK charity's proposal was written in dollars throughout.
12. Word-limit margin is thin on the tightest limits (B8 shipped 596/600 — **verified compliant**; both critics wrongly claimed it was over, which is a good reminder that language models cannot count words and their word-count judgements should be ignored).

---

## M. Recommendation

**NOT_READY for paid launch.**

The deciding factor is not the defect list. The defects in section G were real, they were found by testing rather than by inspection, and they are fixed. The engineering discipline around this system is good: the exclusivity mechanism is genuinely sound, the grounding architecture correctly refuses to invent history, compliance enforcement works, the append-only audit trail held under an operator's own careless delete, and unit economics are excellent.

The deciding factor is section C. A single well-crafted prompt to the same model, with none of the architecture, produced proposals a blind critic scored **equal or better** on all three cases tested. Meanwhile two independent critics from different model families unanimously identified all seven evaluated proposals as machine-generated and mostly generic — including the case with twelve real facts about a real organisation. The architecture is currently buying compliance and exclusivity, which are worth something real, but not the thing the price and the tagline promise.

Your own framing was the right test: *if a nonprofit gives Ktebli money today, will it reliably receive a credible, accurate, genuinely distinct proposal worth submitting, without us having to intervene?* Today: distinct, yes — structurally guaranteed. Accurate, yes, now that the identity gate is in. Credible and worth submitting, not yet. Without intervention, no — three of thirteen orders in this round needed hands-on recovery.

**What would change the recommendation.** In rough order of leverage:

1. **Attack the style and genericness problem directly.** It is the single thing standing between this and a defensible product, and section I says you can afford to spend ten times more per proposal on it. The critics have handed you a precise, repeated specification of what is wrong — uniform structure, template diction, no proper nouns, undived targets. That is actionable.
2. **Re-run the baseline comparison on evidence-rich cases** before concluding the architecture cannot win. Section C's caveat is genuine and the test is cheap.
3. **Decide the exclusivity ceiling question** — it is a pricing and positioning decision, not a bug.
4. **Make heavy-tier generation resumable**, or sell only Draft until it is.
5. **Send an email when something fails.** The cheapest item on this list by a wide margin.

**A limited beta becomes defensible** once 3 and 5 are done and a human reviews each proposal before it is delivered — which would also generate exactly the human-judgement data needed to attack item 1. What is not defensible today is unsupervised delivery at $149 to $449.
