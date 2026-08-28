# Phase 3 — the delivery gate, wired

**Date:** 2026-08-28 · **Workstream:** WS3 · **Branch:** worktree, base `809d532`

## 1. What was wired, and where

### The v2 gate, between `package` and `deliver`

| piece | location |
|---|---|
| Gate loop wiring (judge → record → decide → regenerate) | `supabase/functions/worker/index.ts:1947` (top of the `package` stage) |
| Judge HTTP call (temp 0, seed, structured outputs, `usage.include`, per-slot credential) | `supabase/functions/worker/index.ts:1016` (`judgeCall`) |
| Fail-closed deliver guard (no recorded pass on the exact bytes → no delivery) | `supabase/functions/worker/index.ts:2216` |
| Revision base reads the gated text, not the pre-gate draft | `supabase/functions/worker/index.ts:1876` |
| Loop driver (`runGateLoop`) — all decisions are `loopAction`'s | `supabase/functions/worker/delivery_gate.ts:1789` |
| DB bridge: `dbCauseFor` / `verdictFromRecord` / `loopAttemptFromRecord` | `supabase/functions/worker/delivery_gate.ts:1700/1712/1754` |

The gate runs at the **top of the package stage**, not inside deliver. Reason: a
QUALITY_HOLD regenerates the narrative, and files rendered from the held draft
would be stale — so the gate settles the final text first, every file is
rendered from a document carrying a recorded pass, and `deliver` then refuses
to run without a pass recorded for the SHA-256 of the exact text it is about to
deliver (`gate_verdict_for`, checked again at `index.ts:2216`). Nothing
customer-visible exists between the gate and the guard, and the guard is the
"between package and deliver" enforcement in the literal sense: reordering the
stages cannot smuggle a document past it.

Mechanics, against the unbreakable rules:

- **Pass-or-hold only, fail closed, no flag.** Every path through
  `runGateLoop` ends in `loopAction`'s decision; there is no configuration
  read anywhere in the wiring, and an unjudged document is an INFRA hold, never
  a pass.
- **Stickiness is the database's.** Fresh verdicts go through
  `record_gate_verdict` (migration `20260826170000`); the partial unique index
  keeps one sticky verdict per (proposal, doc_hash), and the gate replays a
  stored verdict at zero model calls (`gate_verdict_for` → `verdictFromRecord`).
  The verdict table predates v2, so its `cause` CHECK admits only the four v1
  causes: `dbCauseFor` maps the two v2-only causes (`cap_exhausted`,
  `spend_cap_reached`, both INFRA and non-sticky, never replayed) onto the
  stored INFRA cause, with the true cause verbatim in `findings`. A test
  asserts the mapping never crosses the QUALITY/INFRA partition.
- **Loop limits in code.** 2 regenerations max (double-enforced: `loopAction`
  counts recorded QUALITY holds seeded from `delivery_gate_verdicts`;
  `runGateLoop` independently caps in-run `regenerate()` calls — the smaller
  budget wins). Material diff required (`materialChange` between consecutive
  drafts; the DB hash separately makes an unchanged doc unreplayable into a
  fresh roll). Score must improve or the loop refunds. The judge's verdict ends
  its turn: one judge call per judgement, the regeneration brief never reaches
  the judge, the judge's words reach the generator only through
  `regenerationBrief()`. No builder-critic dialogue exists.
- **QUALITY vs INFRA stay disjoint in the wiring.** QUALITY refund path:
  `gate_refund_order` (with `p_confirmed=false` — see §7) + `refundLetter` to
  the customer, stage `held`. INFRA retry: stage patched back to `pending`
  **without throwing**, because the throw path ends in `notifyTerminal`'s
  customer email and nothing on an INFRA path may contact the customer. INFRA
  park (3rd consecutive INFRA hold, from the record): `gate_hold` escalation at
  priority `immediate`, stage `held`, no customer contact.
- **The generator's family never judges its own work** — `judgeLadder` drops
  same-family rungs against `MODEL` (anthropic/claude-opus-5); the harness
  applies the same rule to itself (§3).
- **Models never count words**: the gate's preflight word check is arithmetic,
  and it is handed `fmt.maxWords` only when the donor's limit covers the whole
  document (`limitScope === "whole"`); scoped limits stay with the renderer's
  deterministic count so the gate can never disagree with the renderer on the
  same document.
- **Heartbeats**: `deps.beat` fires before every judge call (`runJudgeRung`)
  and before every regeneration; `generateValidated` beats through `beatAll` as
  before.

### Task 1b (added mid-phase): the crawl delegated to `crawl_outcome.ts`

- `index.ts:1328` — the org stage's crawl is now `crawlSiteObserved()`; the
  inline `crawlSite` and its helpers were deleted (the module's traversal is
  the same algorithm with every HTTP status and parse result observed).
- `index.ts:1408` — after the identity gate, the run is classified
  (`classifyCrawl` on the live observations; `reclassifyCached` on a cache
  hit) and the outcome — `blocked_robots | blocked_bot | js_only | fetch_failed
  | extraction_failed | nothing_relevant | identity_mismatch | succeeded` — is
  recorded in the stage result (`crawl.outcome/reason/report`) and in the
  events table under `crawl_outcome` (`crawlEventDetail`), instead of being
  swallowed (launch-readiness P1.6). `crawlGap()` supplies the customer-facing
  line for failures; the identity-mismatch path keeps its existing wording.
- The identity gate's TEST is unchanged (`orgNameMatchesSite`, asymmetric,
  discard-on-doubt). Its **trigger** now covers any site-derived output
  (profile, voice guide, evidence, or legal name) rather than only
  `webEvidence.length || profile.legal_name` — closing the module-documented
  hole where a site yielding only a mission and a voice skipped the gate
  entirely and drove strategy from another organisation's words. This can only
  discard more, never admit more.
- A cached `org_intel` row with no recorded outcome predates the contract and
  is re-crawled once (`hasRecordedOutcome` gates `cacheFresh`), after which the
  refreshed cache carries a report.
- `stack/live-run.sh`'s grep check (`crawl_outcome.ts` imported/used in
  index.ts) is satisfied by the real import at `index.ts:43`.
- Nothing in `crawl_outcome.ts` or `ssrf.ts` was changed. No module-change spec
  was needed: the module's API covered the org stage as intended by its own
  test (`tests/crawl-outcome/crawl_outcome_test.ts` `run()` helper).

## 2. Judge validation — agreement against the ladder ground truth

Harness: `tests/delivery-gate/validate_judge_ladder.ts` (Deno,
`--allow-net=openrouter.ai --allow-read --allow-env`, key via env or
`--key-file`; never printed). Ground truth: the 14 blind verdict files — Doc→arm
decoding from each file's derived-blinding header; the four pre-header files
carry the decodes recorded in `reports/phase1-verdicts.md`, all of them pinned
to packet bytes by `tests/ladder/bytematch.py` (green in the suite).

**Corpus: 22 documents, 56 critic judgements. 6 documents DISPUTED**
(n03-D, n06-C, n09-B, n06thin-D, n06thin-H, n12-D — one critic funds, the other
does not), excluded from every rate. Undisputed: 5 fundable, 11 not fundable.
Each per-critic judgement on an undisputed document is one datum.

(TO FILL: results table, per-model, with always-hold baseline, false-pass /
false-hold, MISSING, spend.)

### A production-config defect found by the harness

At the specified settings the primary judge could not answer at all:
`JUDGE_MAX_TOKENS` was 3000, and on a real ladder document
z-ai/glm-5.3-flash at `reasoning_effort: high` burned the entire completion
budget on reasoning and returned **empty content** (`finish_reason: length`,
`content_len: 0`) — every production call would have parse-failed into an INFRA
hold, i.e. the gate as previously configured would have parked every order.
Measured, then fixed in `delivery_gate.ts` (constant now 12000, measurement in
the comment): the same call completes naturally at 8907 completion tokens.
Reasoning effort stays `high` per the phase specification.

## 3. Proofs (offline, no network — `tests/delivery-gate/delivery_gate_test.ts`)

Fallback:

- `v2: a cap on the primary fails over to the other provider, and the order does not wait`
- `v2: the fallback is a failover, NEVER a second opinion`
- `wiring: a primary cap consults the fallback, and its verdict — either way — ends the ladder`
  (drives `runGateLoop` itself: cap on primary → fallback consulted → its pass
  delivers after exactly 2 calls; its fail drives the quality ladder and no
  third model is ever asked)

Loop stop:

- `v2 loop: two regenerations maximum, and the third failure refunds` (loopAction level)
- `wiring: a document that cannot pass stops after exactly 2 regenerations and refunds on the quality path`
  (end-to-end through `runGateLoop`: 3 judgements, 2 regenerations, refund under
  `gate.regeneration_budget_exhausted`, QUALITY_HOLD, and every judge prompt
  proven free of the brief and of attempt numbers)
- `wiring: a regeneration that did not materially change refunds through the loop`
- `wiring: INFRA holds never regenerate, never refund — they retry and then park`
- `wiring: a replayed sticky hold does not double-bill the regeneration budget`
- `wiring: verdictFromRecord round-trips a stored verdict and stickiness replays without a model call`
  (also: stale-gate-version and unclassifiable-cause records are refused as
  INFRA with alerts, never honoured, never a pass)
- `wiring: dbCauseFor maps every cause into the verdict table's CHECK without crossing the hold partition`

Suite total after the additions: **550 checks, all passing.**

## 4. Sufficiency — the re-test, and what was wired

Computation: `tests/sufficiency/ladder_tau.ts` (offline, deterministic; run it
yourself). For each of the 14 blind cells, Kendall tau-b between the critic's
ranking and each deterministic measure over that cell's four documents, using
`referentWeight()` (`worker/referent_weight.ts`) against the rung's fixture
ledger (`fixture-meta` rows excluded), oriented so positive = "more referents /
more weight ranked better":

| measure | mean tau-b | cells ≥ 0.5 | degenerate cells |
|---|---|---|---|
| referent COUNT (`present`) | **+0.161** (12 usable cells) | 4 / 14 | 2 (all four docs used every offered referent) |
| referent WEIGHT (`weight`) | **−0.452** (14 usable cells) | 0 / 14 | 0 |

Per-cell values are in the script's output; the extremes: count reaches +0.913
only on n12 cells and −0.548 on n09 (it points the wrong way on a third of the
cells), and weight is negative in 12 of 14 cells — the flash arms repeat
referents decoratively and out-weigh the documents both critic families fund.

Against the pre-committed rule (wire a ladder arm only at tau ≥ 0.5 across
rungs and critics): **neither qualifies. `ladderStatus: "flat"` is wired**
(`sufficiency.ts`, with the numbers in the comment). The gate keeps the hard
floor and required-slot arms (they follow from invariants 2 and 3, not from the
ladder), `activeScorer()` falls back to count, `effectiveThreshold()` stays at
the hard floor, and `ladderVerdictNote()` now tells every verdict that the
scoring rule above the floor carries no evidential weight.
`tests/sufficiency/sufficiency_test.ts` updated to assert `flat`; all
sufficiency tests pass.

## 5. save-intake / stripe-webhook clearance (read-only verification)

**The refusal contract in `sufficiency.ts`'s header is NOT implemented by
either function.** `save-intake/index.ts` (44 lines) writes the `pre_intakes`
row and returns its id: it never calls `evaluateSufficiency()`, never writes
`sufficiency_cleared` or a fingerprint, and mints the checkout reference
(`client_reference_id`) unconditionally. `stripe-webhook/index.ts` creates the
order from the paid session with **no read of `sufficiency_cleared`, no
fingerprint recompute, no refusal path** — the only parking condition is a
price/tier mismatch. The schema side exists (migration
`20260826180000_sufficiency_gate.sql`: columns + `pre_intakes_clearance_complete`
constraint), so today every clearance column simply stays NULL/false and orders
flow regardless. Not fixed here: the fix lives in the two edge functions, which
are outside this workstream's paths (and CLAUDE.md marks both as transcribed,
not byte-verified — they must be re-pulled before editing). Flagged as a
**phase-3 exit blocker for invariant 2**.

## 6. Spend

(TO FILL: per-call and total from usage fields.)

## 7. Found and not fixed (with why)

1. **No Stripe refund plumbing.** The QUALITY refund path calls
   `gate_refund_order(p_confirmed=false)`, which parks a `gate_refund_failed`
   escalation at priority `immediate` for the operator to complete the
   transfer, and the customer letter uses the unconfirmed wording. Actually
   moving money needs a Stripe API call with an idempotency key — new secret
   handling and a new failure surface, deliberately not smuggled into this
   diff. The migration designed exactly this fallback path.
2. **save-intake / stripe-webhook do not enforce sufficiency clearance** (§5)
   — outside owned paths.
3. **Gate spend cap is per-invocation.** `runGateLoop`'s SpendLedger lives for
   one stage invocation; a stage retried across ticks re-meters from zero
   (verdict rows record `model_calls` but not USD). The per-call costs are
   ~$0.005, three orders of magnitude under the $6 cap, so the practical
   exposure is bounded by the INFRA park at 3 attempts; still, a dollar column
   on `delivery_gate_verdicts` would make the cap cross-tick. Needs a
   migration — not in scope.
4. **Long gate loops stress the invocation budget** (launch-readiness P0.3
   territory): 2 regenerations + judgements can add several minutes inside one
   edge invocation. Heartbeats cover the reaper; the underlying
   one-invocation-per-stage design is another workstream's problem.
5. **A customer revision after a gate regeneration starts from the gated
   text** (fixed at `index.ts:1876`) — but `finalNarrative()` itself still
   prefers `revise`/`check` text; anything else reading it mid-cycle sees the
   pre-gate draft. Deliver and revise read `package.text` explicitly, which
   covers every customer-visible path.
6. **`qa-visual-test` / other transcribed functions** untouched, per CLAUDE.md.

## 8. Test status

`bash tests/run-all.sh`: every suite that passed at baseline still passes
(delivery gate 550 checks, sufficiency, crawl-outcome, proper-nouns, numeric
register, word limit, referent weight, donor limits, replay, bytematch, all
four adversarial suites). `tests/exclusivity` fails at baseline and after — it
is the deliberately-failing ceiling probe (CLAUDE.md), untouched by this
workstream. Worker and gate module typecheck clean under deno 2.9.5.
