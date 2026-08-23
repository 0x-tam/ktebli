# Ktebli launch readiness — interim findings

**Phase:** launch readiness (33-part mandate). **Baseline:** worker v19 frozen → v20, v21 (changes logged below).
**Status:** partial. Quality benchmark and blind evaluation complete on 4 of 10 cases; 6 cases re-running; service-robustness audit largely complete; exclusivity, concurrency and economics tests outstanding.

---

## 1. Headline

**Question 1 of the mandate — "does Ktebli consistently produce proposals a competent grant writer would consider submission-ready?" — currently answers NO.**

Two independent critics from different model families (`openai/gpt-5.6-sol`, `x-ai/grok-4.6`), each blind to everything but the grant text and the finished narrative, evaluated the four completed benchmark cases. **Eight of eight judgements said the proposal was not fundable as submitted.** Seven of eight said the central intervention was generic. **Eight of eight said the document reads machine-generated.**

Those last two are precisely the claims the product is built on. Neither is explained away by a weakness in the test.

## 2. What the critics agreed on

| Finding | GPT-5.6 | Grok-4.6 | Confounded? |
| --- | --- | --- | --- |
| Reads machine-generated | 4/4 yes | 4/4 yes | **No** |
| Central intervention is generic | 3/4 yes | 4/4 yes | **No** |
| Not fundable as submitted | 4/4 | 4/4 | **No** |
| Targets arbitrary | 4/4 | 3/4 | Partly |
| Organisation fit weak | 3/4 scored 1 | 2/4 scored 1 | **Yes — see §3** |
| Evidence use weak | 4/4 scored 1 | 2/4 low | **Yes — see §3** |

Against the acceptance bar in `quality-standard.md` (clear every disqualifier, ≥3 on all ten dimensions, ≥4 on donor fit / organisation fit / feasibility / submission readiness): **0 of 4 cases pass, under either critic.** Not one was marginal.

The named tells were consistent across both critics and all four cases: uniform phase tables, identical bullet cadence, three-part parallel constructions, grant-template diction ("wrap-around", "synthesises", "structural problem", "civic backing", "capacity transfer"), pseudo-precise figures with no derivation, and — repeatedly — **the complete absence of proper nouns**. Grok's phrasing: "no messy local nouns (no place names, vendors, staff CVs, or prior results)."

## 3. An honest limit on this evidence

The benchmark organisations are fictional and have no crawlable website, so the evidence ledger was genuinely close to empty for most cases. The critics punished that hard — "SWE-2049 is an untraceable shell", "no history, no relationships, no staff named". Ktebli is behaving **correctly** in not inventing that material; the grounding architecture is doing its job. A real customer with a real website and real history would supply what these cases could not.

So **organisation fit, evidence use and specificity scores are confounded and must be re-tested against real organisations** before they can be read as product failures. That re-test doubles as the Part 7 website-intelligence benchmark and is the next priority.

The machine-generated and generic-intervention findings are **not** confounded. They are about prose rhythm and strategy selection, and would look the same with a rich ledger.

## 4. Changes made this round (Part 1 discipline)

v19 was frozen. Four changes were made, each because a test produced a concrete failure — none speculative.

### 4.1 Donor word limit contradicted the generation brief (v20)

- **What failed:** B1, B3, B10 hard-failed `gen:narrative` on `over_word_limit`, all at attempt 3/3.
- **Why:** `GEN_SPECS.narrative.brief` hardcoded "(1500-2500 words)". B1's donor ceiling is 1,400 — the brief's *floor* sat above the donor's *ceiling*. The model was given two incompatible instructions and followed the task line.
- **Fix:** when the donor states a limit, the brief's range is replaced by that limit with ~6% headroom.
- **Regression risk:** low; only fires when `fmt.maxWords` is set.
- **Before/after:** B1 failed 3/3 → **now completes end to end**. B3 and B10 still fail (see §5).

### 4.2 Donor-required self-certifications deadlocked the validator (v21)

- **What failed:** B6 hard-failed `validate` — "unresolved after 2 rounds: unsupported: Maintains an active institutional bank account…".
- **Why:** the donor's form obliges applicants to certify administrative facts (registration standing, debarment, banking). No evidence source can ever supply these. The claim ledger had no category for them, so it classified them `unsupported` and blocked. The correction loop then oscillated: remove the certification → mandatory requirement missing → restate it → ungrounded. Deadlock by construction. **This would have hit every proposal to any donor with an eligibility question — which is most institutional donors.**
- **Fix:** a deliberately narrow `donor_required_certification` class (administrative self-certification only, explicitly *not* claims about experience, results or capability), excluded from grounding blocks. Because Ktebli must never quietly certify on a customer's behalf, every one is now surfaced in a customer-facing **"Before you submit"** document listing each statement to confirm, on all tiers.
- **Regression risk:** medium — the class could become an escape hatch for unsupported capability claims. The prompt constrains it three ways and it is worth watching in the next round.
- **Before/after:** B6 failed 3/3 at validate → **validate now passes**.

### 4.3 Cover emails failed on their own signature (v21)

- **What failed:** B9 hard-failed `gen:cover_email` on `ends_mid_sentence`, 3/3.
- **Why:** the check exists to catch truncation. A covering email legitimately ends "Kind regards, / Maria Haddad / Executive Director" — no terminal punctuation. Deterministic failure on essentially every cover email that signs off with a name; cover emails only exist on Competitive and Full, so **both paid tiers above Draft were affected**.
- **Fix:** a `signoff` option exempts a final line of ≤80 characters for cover emails only. Real truncation is long, and `llm()` already guarantees the model did not stop on the token cap.
- **Regression risk:** low, scoped to one document type.
- **Before/after:** B9 failed 3/3 → **passes**.

### 4.4 Long generations were reaped as "[timeout]" while still running (v21)

- **What failed:** B7 hard-failed `gen:narrative` with `[timeout]`, 3/3.
- **Why:** the reaper marks a stage dead after 3 minutes without a heartbeat, but a single generation can make up to twelve model calls (three validated attempts × four continuation hops) with **no heartbeat between them**. Long documents outran the window, were reaped while the edge function was still working, and retried into the same wall every time. Not a model problem — a bookkeeping one.
- **Fix:** every model call heartbeats, throttled to once per 20 seconds. Because up to three stages share an isolate, the heartbeat registry beats all stages currently in flight rather than one global — a naive single global would have beaten one stage and let its siblings be reaped.
- **Regression risk:** low. One extra DB write per 20s per active stage.
- **Before/after:** B7 no longer times out; still working through generation at time of writing.

## 5. New failure exposed by the fixes — and it is systemic

With the deadlocks cleared, the pipeline ran further and hit a different wall in three places:

- **B3** — `validate` now fails `over_word_limit`. The validator's *correction* pass regenerates the narrative to fix findings; adding the required content pushes it over the donor's ceiling. The v20 fix patched the generation brief but not this correction path.
- **B10** — `gen:narrative` still fails `over_word_limit` at a 1,600-word ceiling even with the corrected brief.
- **B6** — `package` now fails `docx validation: heading_missing: Question 3…`. Under pressure to cut words, the model dropped a donor-mandated heading.

These are one problem wearing three masks: **for tight-limit donors the constraint set is over-determined, and the repair loop has no way to trade off between "cover every requirement", "stay under the limit" and "keep every mandated heading".** It satisfies whichever it was last told about and breaks another. This is the most important engineering finding of the round and is not yet fixed.

## 6. Also worth flagging

- **B8 shipped at 596 words against a hard 600-word limit** and *both* critics independently judged it over the limit and said the funder would discard it unread. Even if our counter is right, a 0.7% margin on a disqualifying constraint is not a margin. The 6% headroom is applied as a generation hint but not enforced as a delivery buffer.
- **60% of a 10-order burst landed in `attention`.** Orders did correctly roll up to that status rather than silently dying — the attention queue works — but no order recovered on its own, and none would have without manual intervention.
- **Per-stage token accounting (`usage`) is a module-level global shared by up to three concurrent stages**, so recorded per-stage costs are cross-contaminated. Observability only, not a launch blocker, but it means the Part 13 economics figures need to be derived from OpenRouter's own accounting rather than ours.

## 7. Direction of the recommendation

On the evidence so far, **`NOT_READY` for paid launch**, with the deciding factor being §2 rather than any individual bug. The bugs in §4 were real and are fixed; the bugs in §5 are tractable. The finding that does not have an obvious fix is that two independent critics unanimously identified the output as machine-written and mostly generic — which is the specific promise the product sells against.

This is not yet a final recommendation. It becomes one after the real-organisation re-test in §3, which is the single most informative thing left to run: it separates "the engine cannot do this" from "the benchmark starved the engine of material".
