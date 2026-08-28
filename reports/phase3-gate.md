# Phase 3 — the delivery gate, wired

**Date:** 2026-08-28 · **Workstream:** WS3 · **Branch:** worktree, base `809d532` · **Status: COMPLETE — gate wired hold-biased, LOW-AGREEMENT flagged, sufficiency FLAT**

## 1. What was wired, and where

### The v2 gate, between `package` and `deliver`

| piece | location |
|---|---|
| Gate loop wiring (judge → record → decide → regenerate) | `supabase/functions/worker/index.ts:1947` (top of the `package` stage) |
| Judge HTTP call (temp 0, seed, structured outputs, `usage.include`, per-slot credential) | `supabase/functions/worker/index.ts:1016` (`judgeCall`) |
| Fail-closed deliver guard (no recorded pass on the exact bytes → no delivery) | `supabase/functions/worker/index.ts:2224` |
| Revision base reads the gated text, not the pre-gate draft | `supabase/functions/worker/index.ts:1876` |
| Loop driver (`runGateLoop`) — all decisions are `loopAction`'s | `supabase/functions/worker/delivery_gate.ts:1824` |
| DB bridge: `dbCauseFor` / `verdictFromRecord` / `loopAttemptFromRecord` | `supabase/functions/worker/delivery_gate.ts:1735/1747/1789` |

The gate runs at the **top of the package stage**, not inside deliver. Reason: a
QUALITY_HOLD regenerates the narrative, and files rendered from the held draft
would be stale — so the gate settles the final text first, every file is
rendered from a document carrying a recorded pass, and `deliver` then refuses
to run without a pass recorded for the SHA-256 of the exact text it is about to
deliver (`gate_verdict_for`, checked again at `index.ts:2224`). Nothing
customer-visible exists between the gate and the guard, and the guard is the
"between package and deliver" enforcement in the literal sense: reordering the
stages cannot smuggle a document past it. Disclosed: if the guard ever fired,
its throw would end in the terminal-failure path's generic customer email — an
acceptable never-reached backstop (a pass is recorded before deliver becomes
reachable), noted here rather than hidden.

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

### Results (exact production settings: temp 0, seed 20260827, reasoning high, structured outputs, neutral v2 instrument)

| candidate | n (data) | agree | rate | **always-hold baseline** | false-pass | false-hold | MISSING | own-family docs excluded |
|---|---|---|---|---|---|---|---|---|
| z-ai/glm-5.3-flash (the specified primary) | 40 | 26 | **65.0%** | **65.0%** | 14 | 0 | 0 | 0 |
| google/gemini-3.7-flash | 18 | 14 | **77.8%** | **22.2%** | 4 | 0 | 0 | 10 (A/C arms are gemini-generated) |

- **glm-5.3-flash: NO SIGNAL.** 65.0% agreement is *exactly* the always-hold
  baseline — it does not beat refusing everything. It passed 18 of 22 documents
  including 7 undisputed not-fundable ones; its only correct holds were four
  flash-generated documents (n03-C, n06thin-A, n12-A, n12-C).
- **gemini-3.7-flash: real signal, still under the 80% bar.** +55.6pp over its
  baseline, zero false holds — but it passed *every* document it judged
  (scores 48–50 on all 12), including both undisputed not-fundable opus
  documents (n06-B, n12-H), which is where its 4 false-pass data come from.
- On the **production-relevant subset** (opus-generated documents — production's
  generator is anthropic/claude-opus-5, so every real order's document is one
  of these), the two candidates tie at 77.8% and both passed everything. The
  corpus's two not-fundable opus documents were caught by neither.
- Harness caveat, disclosed: the printed `own-family-excluded` column shows
  `0 doc(s)` for gemini because it counts judged rows rather than skips — the
  correct figure is the 10 skipped A/C documents stated in the table above.

### The decision, per the pre-committed cascade

glm < 80% → gemini as primary candidate → also < 80% → **wire the better one
(gemini) as primary, HOLD-BIASED, and flag LOW-AGREEMENT**. Done:

- `delivery_gate.ts` judge config: `JUDGE_PRIMARY = google/gemini-3.7-flash`,
  `JUDGE_FALLBACK = z-ai/glm-5.3-flash`, with the full cascade in the comment.
- Hold-biased posture in `runDeliveryGate` step 8: a pass now requires the
  computed bar (applyBar) **and** the judge's own asserted `clears_bar`;
  either signal failing holds, sticky, on the merits. Strictly tightening —
  the asserted verdict can veto a pass and still cannot rescue a failing bar.
  Tested: `v2: hold-biased — a pass needs the bar AND the asserted verdict;
  either alone cannot pass`.
- LOW-AGREEMENT comment at the wiring site (`index.ts`, top of the package
  stage) and in the judge config.
- **Measured honestly: the hold-biased veto changes nothing on this corpus.**
  On the re-run with asserted-verdict capture, both models asserted
  `clears_bar` on every document whose computed bar cleared, so the
  hold-biased rates equal the plain rates (77.8% and 65.0%). The veto is a
  real mechanism with a measured effect of zero here; it can only help in
  production, and it cannot hurt (it never converts a hold to a pass).
- **Despite temperature 0 and the fixed seed, glm's per-document judgements
  are NOT reproducible.** Between the first run and the re-run glm flipped
  4 of 22 documents (n03-C hold→pass, n06thin-C pass→hold, and the disputed
  n06-C and n06thin-D), with large score swings on unflipped documents too
  (n06thin-A: 4 → 31). Its 65.0% headline survives only because the two
  undisputed flips cancel: the *rates* are stable, the *verdicts* are not.
  gemini reproduced exactly — every verdict, score and cost identical across
  runs. This instability materially supports the hold-biased posture and the
  gemini-primary ordering, and it belongs in the record: a glm verdict on a
  single document is one draw from a noisy instrument, held stable in
  production only by the DB stickiness rule, never by the seed.
  The honest headline stands: **the wired judge agrees with
  blind ground truth 77.8% of the time, below the 80% bar — LOW-AGREEMENT.**
  What this gate now reliably provides is the deterministic preflight layer,
  the recorded-verdict stickiness, the INFRA/QUALITY separation, and a judge
  that has real signal over flash-grade output but rubber-stamps opus-grade
  output. Nothing unfundable-per-the-critics is *known* to be caught at
  opus quality; drift monitoring must not assume otherwise.

### A judge-budget reliability fix (`JUDGE_MAX_TOKENS` 3000 → 12000)

During the first harness attempt, one call on a real ladder document at the
then-configured 3000-token budget spent the entire completion budget on
reasoning and returned **empty content** (`finish_reason: length`,
`content_len: 0` — a parse failure, so an INFRA hold). That was **one sample
of a high-variance instrument, not a deterministic defect**: the critic
re-issued the identical claimed-failure settings and the call completed fine
(`finish=stop`, ~940 completion tokens), and my own probe's output was
observed in-session but never persisted as an artifact. What IS established:
reasoning spend at effort `high` varies wildly call to call (consistent with
the glm verdict instability above), and a 3000-token ceiling leaves no
headroom for the verbose tail — a raised-budget call completed naturally at
8907 tokens. The change to 12000 stands as **headroom against variable
reasoning verbosity** (~$0.005/call against the $6 per-order cap), with the
code comment reframed to say exactly that. Reasoning effort stays `high` per
the phase specification.

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

Also: `v2: hold-biased — a pass needs the bar AND the asserted verdict; either alone cannot pass` (the LOW-AGREEMENT posture of §2, both directions plus the agreeing pass).

Suite total after the additions: **555 checks, all passing.**

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

All figures from each response's own `usage.cost` (`usage.include: true`),
never from the account meter. Budget: $3.00 HARD, checked before every call
with a reserve; no call was refused for budget, 0 MISSING.

| run | calls | usage-field total |
|---|---|---|
| glm-5.3-flash, 22 documents | 22 | $0.0486 |
| gemini-3.7-flash, 12 documents (10 own-family skipped unbilled) | 12 | $0.0795 |
| re-run of both with asserted-verdict capture (hold-biased measurement) | 34 | $0.1392 |
| probes (liveness $0.00001; short structured $0.0005; full-doc at 3000 tok $0.0021; at 9000 tok $0.0051) | 4 | $0.0077 |
| **total** | **72** | **$0.2750** |

Per-call range on the real documents: $0.0009–$0.0079. Remaining of the $3.00
budget: ~$2.73. Per-document judging cost for the wired primary:
~$0.006–0.008 — the marginal gate cost per order is under a cent per
judgement against the provisional $6 per-order cap.

Disclosed: per-call generation ids were captured in-flight but are not
persisted anywhere; the audit trail for these runs is the per-call console
rows (verdict, score, asserted verdict, cost) in the harness logs.

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

## 8. Test status and reproduction

`bash tests/run-all.sh` (run before and after): every deno/python suite that
passed at baseline still passes — delivery gate **555 checks** (was 470 at
baseline; the additions are the wiring proofs of §3 and the hold-biased
contract), sufficiency, crawl-outcome, proper-nouns, numeric register, word
limit, referent weight (61/61), donor limits (71 forms), ladder bytematch,
all four adversarial suites. Worker and gate module typecheck clean under
deno 2.9.5.

The two Postgres suites need a privileged environment: in my unprivileged
run-all they died on root/postgres-owned scratch dirs under `/tmp` before
reaching their assertions — an environment failure, which an earlier revision
of this report wrongly reported as the documented deliberate red. **Corrected,
verified by running both privileged (`sudo PGBIN=/usr/lib/postgresql/17/bin
bash tests/<suite>/run.sh`) on this exact base: `tests/replay` → `REPLAY OK`,
and `tests/exclusivity` → "EXCLUSIVITY TEST PASSING — no ceiling", 40 of 40
concurrent applicants served on one grant, 0 refused, exit 0.** The per-grant
ceiling that CLAUDE.md and the launch-readiness report describe is closed on
this branch; the probe is green here, not deliberately red.

Reproduce the numbers:

```
npx --yes deno@2.9.5 run --allow-read tests/sufficiency/ladder_tau.ts        # §4, offline
OPENROUTER_API_KEY=... npx --yes deno@2.9.5 run \
  --allow-net=openrouter.ai --allow-read --allow-env \
  tests/delivery-gate/validate_judge_ladder.ts \
  --models=google/gemini-3.7-flash,z-ai/glm-5.3-flash                        # §2, ~$0.19
```

**Deployment note:** nothing here is deployed. Deployed worker remains v26;
`supabase/functions/worker/` now carries these changes on top of the already-
undeployed stranded-claim/notification work (CLAUDE.md source-of-truth
warning). Diff before deploying, per DEPLOY.md discipline.
