# Phase 6 — engineering (WS6-core)

**Date:** 2026-08-28 · **Workstream:** ws6-core (worktree; base = trunk with WS3 gate wiring and WS4a compliance fixes merged) · **Model spend: $0.00 — no model call was made by this workstream.**

This is the engineering half. **The benchmark section is appended after §10 by
ws6-bench — do not renumber §1–§10.**

## 0. Environments — where each proof ran

Every proof below names one of these:

| env | what it is | what it can prove |
|---|---|---|
| **REPLAY** | throwaway Postgres 17, all 17 migrations replayed by `tests/replay/run.sh` / `tests/exclusivity/run.sh` (shims for pg_net/pg_cron; nothing leaves the machine) | real SQL semantics on the migration head |
| **DENO-EXTRACT** | Deno 2.9.5 executing code **extracted verbatim from the shipping source** (marked blocks imported as data-URL modules) or importing the shipping modules directly | the exact bytes of the predicates/wordings/helpers, plus source-order assertions for glue that cannot be imported (index.ts calls `Deno.serve` at module scope) |
| **STUB-STACK** | the real `supabase/functions/worker/index.ts` from this tree run as a subprocess under plain Deno with **localhost-only network permission**, against an in-process stub PostgREST | real end-to-end function behaviour for paths that need no model call; NOT the deployed edge runtime |

The shared local Supabase stack was deliberately **not** used for proofs: it
serves the MAIN checkout's files (not this worktree) and WS5's live runs share
it; DB-level proofs therefore use REPLAY and function-level proofs use
STUB-STACK, as the workstream brief allows. Caveat that applies everywhere:
nothing here reproduces the deployed edge runtime or its invocation limits.

Sudo note for the two Postgres suites: run with `TMPDIR=/tmp` (`sudo env
TMPDIR=/tmp PGBIN=/usr/lib/postgresql/17/bin …`). An inherited user-only
TMPDIR makes su-postgres psql unable to read mktemp'd SQL files, which is the
previously recorded "flaky throwaway Postgres" — it was never the database.

## 1. P0 — escalations kind-check regression (WS4a-21)

**Change:** `supabase/migrations/20260828120000_escalations_kind_union.sql` —
re-states `escalations_kind_check` as the exact element-by-element union of the
20260826170000 list (14 kinds incl. `gate_hold`/`gate_refund`/`gate_refund_failed`)
and the 20260826180000 additions (`payment_ungated`, `sufficiency_refund_failed`):
16 kinds. The migration's comment records the drop-and-recreate/last-writer-wins
mechanism and the rule that any future kind addition must re-state the full union.

**Fingerprint re-record:** `tests/replay/expected-fingerprint.txt` `constraints`
`be67c83d…` → `e380f936…` (and later → `cf3df5c7…` with §2's migration; final
committed values are what the replay produces). This is the documented update
path for a deliberate schema change, argued in the commit messages themselves
(`cd40e29`, `8861d1b`): the "never edit to make it pass" rule forbids papering
over an *unintended* mismatch; here the schema change is the subject of the
commit, only the categories a CHECK/column change predicts moved, and the
replay's deployment-state section still reports the full undeployed delta
against production. `REPLAY OK`, 8/8 categories, after each re-record.

**Proof (REPLAY):** `tests/exclusivity/escalation_kinds_test.sql`, wired into
`tests/exclusivity/run.sh` (must pass — a dropped kind now fails the suite by
name). Asserts: all 16 kinds insert; an unknown kind still refuses;
`gate_refund_failed` at priority `immediate` inserts; and `gate_refund_order()`
executes end to end on a real order graph on **both** paths — `p_confirmed=false`
→ `gate_refund_failed`@immediate escalation, `p_confirmed=true` → `gate_refund`
escalation — with order status `refunded`, `gate_refunded_at` set, and both
events rows present. Output: `ESCALATION-KINDS TEST PASSED`.

## 2. Invariant 2 — clearance enforced at both ends

WS3's read-only finding (phase3-gate §5): the sufficiency mechanism existed in
schema and module, and neither edge function enforced it. Now wired,
refusal-by-default, per `sufficiency.ts`'s own header contract. **The gate
stays FLAT — hard floor only; no threshold was touched** (asserted:
`payment_without_clearance_test` shows floor = 1 via `effectiveThreshold`).

**Changes:**

* `supabase/migrations/20260828121500_pre_intake_clearance_inputs.sql` —
  `pre_intakes.tier` (checked to the four real tiers) and
  `pre_intakes.grant_analysis_ok`: the two `canonicalPayload()` inputs the row
  could not store, without which no fingerprint recompute is possible.
* `supabase/functions/save-intake/index.ts` (v5) — builds the row first,
  derives the `SufficiencyInput` FROM that row, runs `evaluateSufficiency()`
  on every submission, stores the verdict + fingerprint
  (`sufficiency_*` columns), and mints a single-use 48-hex `checkout_token`
  **only on a cleared verdict** — exactly one mint site (`index.ts:141`), and
  nothing client-supplied can assert clearance. Refusals return the verdict's
  own customer message + `gapLines`. `grant_analysis_ok` is decided
  server-side (`index.ts:89-94`): a URL-shaped grant is fetched through
  `worker/ssrf.ts safeFetchText` and counts only if it yields
  ≥ `MIN_GRANT_CHARS` of text — never accepted from the client. Every
  clearance/refusal is an events row.
* `supabase/functions/stripe-webhook/index.ts` (v10) — `client_reference_id`
  must be a gate-minted token (`index.ts:161-180`); the row is re-canonicalised
  through the byte-identical `clearance.ts` twin and the recomputed fingerprint
  goes to `consume_checkout_token()` (atomic re-check of clearance,
  fingerprint, single-use, TTL). Cleared tier must equal PAID tier
  (`tier_mismatch`, :167). The 48-hour any-intake-with-this-email fallback
  (hole #2 in 20260826180000's header) is **gone**. Work is queued only when
  `priceOk && emailOk && clearanceOk` (:213); an ungated charge parks as
  `attention` with a `payment_ungated` escalation at priority `immediate`
  (:251-271), no stages, no worker wake. Funded orders record
  `pre_intake_id` + `sufficiency_fingerprint` + raw `intake_answers`
  (the licence columns of 20260826180000 §4).
* `save-intake/clearance.ts` ≡ `stripe-webhook/clearance.ts` (byte-identical
  twins, sha-verified in-test): ONE canonicalisation path on both sides of the
  payment, importing `worker/sufficiency.ts` as the sole scoring authority.

**Proofs:**

* **REPLAY** — `tests/exclusivity/checkout_clearance_test.sql` (in run.sh, must
  pass): the refusal matrix executed — absent/short/unknown token, wrong
  fingerprint, reuse, expiry, uncleared row all return null; the valid path
  returns the row exactly once; all 7 refusals + the consumption are events
  rows (reasons enumerated); `pre_intakes_tier_check` and
  `pre_intakes_clearance_complete` bite; the order-licence columns exist.
  `CHECKOUT-CLEARANCE TEST PASSED`.
* **DENO-EXTRACT** — `tests/adversarial/payment_without_clearance_test.ts`
  (imports and *executes* the shipping `clearance.ts` + `sufficiency.ts`):
  an identity-only intake (today's wizard payload) refuses at the floor with
  gaps named; a fully answered intake clears and its fingerprint round-trips
  identically through the twin; clear-then-edit always changes the fingerprint
  (answer deleted/rewritten, org swapped, **tier swapped**, grant length
  changed, escape flipped, upload added); token shape; glue by source (single
  mint site, `consume_checkout_token` present, fallback query absent,
  stage insert after the parked return). ALL HELD.

**Recorded residual:** the fingerprint binds the grant by *length +
readability*, not by text — `canonicalPayload`'s own design (the gate never
scores grant text as evidence). Not reachable from any public surface: the
only customer edit path is save-intake, which re-evaluates and re-fingerprints.

**Consequences to flag:** (a) `index.html` (read-only for this workstream)
must be extended to ask the six slots and pass `checkout_token` as
`client_reference_id`; until then every real submission refuses — that is
invariant 2 working as specified, not a defect. (b) The live $1 trial link
would park as `payment_ungated`; deactivating it is already an owner item.
(c) No automatic Stripe refund is attempted for ungated charges — this
codebase has no Stripe refund plumbing (deliberate, phase3-gate §7.1); the
`immediate` escalation is the documented operator remedy. (d) TRANSCRIPTION
CAVEAT: both functions are transcribed copies (CLAUDE.md) — re-pull and diff
before deploying.

## 3. WS4a's open fix-specs in worker/index.ts

All proofs: **DENO-EXTRACT**, `tests/adversarial/parser_silent_pass_wiring_test.ts`
(43 assertions, ALL HELD) — the fixed predicates live in marked blocks that the
suite extracts from the real source and executes; glue asserted by source.

| spec | change | where |
|---|---|---|
| WS4a-15/-14 (+WS4a-1/F1) | `normalizeFmt` delegates both donor limits to `donor_limits.ts resolveDonorLimits` (limit/absent/refused — "1,400 characters", "at least…", dual limits, "$1,400", "A4", ranges all REFUSE; typography keeps `numLike`, safe defaults, not compliance). `required_sections` present-but-not-array → `limitUnparsed`, never `[]`. `Fmt.limitOutcomes` recorded. | index.ts:308 |
| refusal-before-spend | analyze resolves limits against the FULL grant text and records `limit_unparsed`/`limit_outcomes` in its output; `gen:narrative` refuses on the union of that and the runStage recompute BEFORE any generation call; package keeps its check as backstop | index.ts:1591-1598, 2047, 2628 |
| WS4a-5 (F5) | failed grant-URL fetch **fails the analyze stage** ("grant page unreachable"); the URL string can no longer masquerade as the grant text | index.ts:1572 |
| WS4a-2/-3/-4 (F3) | `normalizeClaims` (marked block): non-array ledger THROWS; classifications lowercased; out-of-enum → `"unsupported"` with raw value recorded. Wired in validate AND revise. Coverage: non-array throws when a requirement matrix exists; empty against a non-empty matrix throws | index.ts:1469, 2228, 2349, 2247-2258 |
| WS4a-6 | `normalizeVisualIssues` (marked block): issues missing/non-array THROWS into the retry (never "passed"); unknown-type BLOCKING reports survive as `unreadable_content` with the original name in the note | index.ts:1080 |
| WS4a-16 | `requiredSectionFindings` (marked block): Unicode fallback normalisation — a non-Latin donor's required structure is checked (Arabic fixtures executed both ways); a name empty under both rules is a recorded violation, never a silent skip; ASCII behaviour byte-preserved | index.ts:564-597, 646 |
| WS4a-17 | verified already closed by WS3's `siteDerived` entry condition; asserted present by source | index.ts:1717-1719 |
| WS4a-18 (P2) | non-array strategy ranking → `ranking_unparsed: true` in the stage output + console record; fallback selection unchanged | index.ts:1848-1856 |
| WS4a-19 | deliver: failed completion email → `delivery_failed` escalation + `email_failed` on the stage output + notify events row (proof in §4's suites) | index.ts:2723-2737 |
| WS4a-20 | QA record stores `word_count_whole` AND `word_count_counted` | index.ts:2643-2644 |
| WS4a-21 | §1 | migration |

**Deferred, with why:** the full `numeric_register.ts` wiring (the remaining
half of WS4a-14, launch P1.7). It has no §6 fix-spec; replacing
`consistencyFindings` with the register means making the design object a
mechanism rather than prose across every gen prompt — a redesign whose output
effects cannot be verified here ($0 model budget). `sufficiency.ts`,
`donor_limits.ts`, `crawl_outcome.ts` and `delivery_gate.ts` are now all
genuinely wired (§2, §3, §6, WS3), so WS4a-14 reduces to exactly this one
module. Also deferred: the `upload-intake-file` insert-response check (WS4a's
own §6 note) — that function is not in this workstream's paths.

## 4. Failure and hold notifications (phase 6.1)

**Changes (worker/index.ts):** `notifyOperator` (:1238; `operator_email` →
`support_email` fallback); `recordNotifyAttempt` — every attempt is an events
row with `sent:true/false` (invariant 9); `notifyTerminal` rewritten (:1346):
escalation row FIRST, then customer attempt, then operator attempt — terminal
failures notify **both**; `notifyUnnotifiedTerminals` (:1386, called every tick
at :2755) sweeps `failed/held` stages with `notified_at` null — closing the
reaper gap where a timed-out final attempt became `failed` in SQL and nobody
was told; gate INFRA_HOLD path (:2494) adds the operator email, keeps the
customer at zero contact, and sets `notified_at` so the sweep can never send
the generic failure letter over an INFRA hold; gate QUALITY_HOLD path (:2532)
sends the customer the DRAFT refund wording and sets `notified_at`;
deliver's email failure escalates (WS4a-19, :2723). Hold classes stay
disjoint end to end: QUALITY tells the customer, INFRA tells the operator
only and never implies the proposal failed.

**Unification note:** `delivery_gate.ts refundLetter` is untouched (its suite
still covers it), but the refund call site now uses
`DRAFT_WORDINGS.customerQualityHold` — same facts, rewritten because
refundLetter carries an em dash and long sentences, which the wording rules
forbid. One wording block, four class-distinct texts, no conflation.

**Proofs:**

* **DENO-EXTRACT** — `tests/notifications/wording_test.ts`: executes the DRAFT
  block verbatim; asserts no em/en dash anywhere, every sentence ≤160 chars,
  DRAFT marker present, class content (terminal names the step; quality-hold
  states the refund; INFRA contains "The proposal itself has not failed" / "No
  judgement about its quality was reached" / "The customer has not been
  contacted" and never mentions a refund), and the class wiring by source
  (hold_alert block has NO customer send; refund block does not reuse the
  INFRA wording; escalation precedes email; the sweep selects exactly
  terminal-and-unnotified). ALL HELD.
* **STUB-STACK** — `tests/notifications/terminal_notify_stub_test.ts`: the
  real worker, real terminal failure (final-attempt strategy stage, no
  analysis — throws before any model call). Asserts from the worker's actual
  requests: stage marked failed; `stage_failed` escalation (deadline_72h,
  order+proposal linked) written BEFORE the email attempt; the attempt
  happened (sendEmail consulted `resend_api_key`; the stub returns none — the
  Resend stub contract — so `sent:false`); `notify_customer` AND
  `notify_operator` events rows with `sent:false`; `notified_at` set. 25
  requests captured, none leaving 127.0.0.1. ALL HELD.
* Not executed end-to-end: the QUALITY/INFRA gate paths themselves (driving
  `runGateLoop` to a hold needs judge calls — $0 budget). Their decision
  machinery is already executed offline by `tests/delivery-gate` (555 checks);
  what this workstream added on those paths is covered by the source-level
  assertions above.

**Runner:** `tests/notifications/run.sh`. `tests/run-all.sh` is owned by
another workstream, so it does NOT include this directory — add the two lines
at merge (noted in the runner's header).

### The DRAFT wordings, verbatim (shipping defaults; operator to edit)

**Customer — terminal failure** (`customerTerminal(orderNo, stageLabel, support)`):

> Subject: `About your Ktebli order ${orderNo}`
>
> We could not finish your proposal.
> The work stopped at this step: **${stageLabel}**.
> Our team has been alerted. We will write to you about what happens next.
> You do not need to do anything.
> Order ${orderNo}. Questions: ${support}.

**Customer — QUALITY_HOLD refund** (`customerQualityHold(orgName, orderNo, amountUsd, support, refundConfirmed)`):

> Subject: `We are refunding your Ktebli order ${orderNo}`
>
> We wrote a proposal for ${orgName}. Then we assessed it the way a funder's reviewer would.
> It did not clear that bar. A second attempt did not clear it either.
> We will not send you a document we do not believe in. A weak proposal costs you a submission round. That is worth more than what you paid us.
> *(unconfirmed:)* **We are refunding ${money} in full.** Our payment provider will confirm when it settles.
> *(confirmed:)* **We have refunded ${money} in full.** It returns to the card you paid with, usually within five to ten business days.
> You do not need to do anything. You are not being charged for anything else.
> If you want to try again with more detail about the opportunity, write to ${support} and quote order ${orderNo}. That conversation is free.

**Operator — INFRA_HOLD** (`operatorInfraHold(orderNo, stageKey, reason)` — never implies the proposal failed):

> Subject: `Ktebli operator alert: order ${orderNo} is parked`
>
> An automated step could not complete for order ${orderNo}.
> The proposal itself has not failed. No judgement about its quality was reached.
> The order is parked at stage ${stageKey}. The customer has not been contacted.
> Reason: ${reason}.
> The escalations table has the full record.

**Operator — terminal failure** (`operatorTerminal(orderNo, stageKey, error)`):

> Subject: `Ktebli operator alert: order ${orderNo} failed at ${stageKey}`
>
> Order ${orderNo} stopped for good at stage ${stageKey}.
> Error: ${error}.
> The customer has been told we could not finish, and that we will follow up.
> The escalations table has the full record.

## 5. Strategy-retry strand (phase 6.2)

**Verification:** WS3's merge did land the worker-side release — strategy
calls `release_stranded_claim(p_proposal)` at index.ts:1889, BEFORE reading
`takenRows`, so the freed template/opening are visible to the same run
(source order asserted in `parser_silent_pass_wiring_test.ts`).

**Proof (REPLAY):** `tests/exclusivity/stranded_claim_test.sql` executes the
forced-retry sequence on the real functions: claim held+confirmed → retry
blocked `existing_claim_same_org` → release → **retry granted** with the freed
fingerprint re-issued; plus the safety cases (a second live order can neither
release the first's claim nor double-claim; a different org unaffected).
**New this workstream:** the ORPHAN branch — the isolate that died between
`claim_approach()` and the `claim_id` patch. A seconds-old unlinked claim is
NOT released (the 2-minute age guard keeps the claim/patch race closed, and
the retry stays blocked); backdated past the guard it IS released and the
retry succeeds. `STRANDED-CLAIM TEST PASSED` + `ORPHAN-CLAIM TEST PASSED`.
A worker-driven strategy retry was not executed (it requires a model call).

## 6. Crawl outcomes → sufficiency (phase 6.3)

**Change (worker/index.ts):** marked block at :543 + org-stage wiring
(:1794-1816): when the classified outcome (crawl_outcome.ts taxonomy, consumed
read-only) is starvation-class — `blocked_robots`, `blocked_bot`, `js_only`,
`fetch_failed`, `extraction_failed` — the stage counts the referents actually
in hand (`orders.intake_answers` E-ASK slots via `sufficiency.ts referentsIn`,
uploaded `intake_files` text, surviving web evidence) against
`effectiveThreshold(SUFFICIENCY_THRESHOLD)` — sufficiency.ts's own FLAT floor,
no second threshold definition. Below the floor: an `evidence_starved` events
row, then a loud throw that the tick handler (:2777-2779) treats as
TERMINAL-HELD **on first occurrence** (a retry cannot grow the ledger), so
`notifyTerminal` tells customer and operator immediately — never a silent
generic proposal. `nothing_relevant` / `identity_mismatch` are deliberately
not starvation (the site was read; the thin state is truthful and disclosed;
the pre-payment gate is the authority on thin). The count is deliberately
generous (raw `referentsIn`, no own-name exclusion): overcounting only
reproduces today's proceed-thin behaviour; no adequately-evidenced order can
be held by it. With §2 wired, every new paid order carries ≥1 E-ASK referent,
so this is the backstop for legacy/ungated orders and stripped answers.

**Proof (DENO-EXTRACT):** `tests/adversarial/crawl_starvation_test.ts` —
executes the predicate (all five starvation outcomes hold on an empty ledger,
none holds at the floor; succeeded/nothing_relevant/identity_mismatch/
unclassified never hold), executes `referentsIn` on real and escape answers,
asserts the org wiring, the events row, and the first-pass terminal-held
routing by source. ALL HELD.

## 7. Per-stage cost accounting (phase 6.4)

**Change (worker/index.ts):** the module-level `usage` global (shared by the
PARALLEL stages of one isolate — launch P2.9's cross-contamination) is gone.
Marked block at :148: `Usage`/`newUsage`/`addUsage`; `llmRaw` accumulates into
`opts.u` only and every request carries `usage:{include:true}` so the dollar
figure is OpenRouter's own per-response `usage.cost` (a response without one
counts as `unpriced_calls`, never a silent $0). `runStage` owns `stageUsage`
(:1495), threaded into all 10 direct `llm()` sites, all 6 `generateValidated()`
sites (new 4th parameter, forwarded internally) and `visualQA`; all 10 stage
outputs snapshot their own sink — per stage, per order, in
`job_stages.output.usage` (now incl. `usd` and `unpriced_calls`). `judgeCall`
untouched: the gate already reads provider accounting per call.

**Proof (DENO-EXTRACT):** `tests/adversarial/cost_accounting_test.ts` —
executes the accounting block under real concurrency: two interleaved async
"stages", 50 calls each with distinct shapes, end with exactly their own
totals (5000/500/$0.05 vs 350/3500/$1.00); unpriced responses counted; a
sink-less call accumulates nowhere (no hidden global to fall back to).
Threading asserted by source. ALL HELD. **STUB-STACK** re-run green after the
rewrite (the real worker still ticks).

## 8. Resumable section-by-section generation (phase 6.5)

**Change (worker/index.ts):** marked helpers at :745 (`sectionPlan`,
`assembleSections`, `sectionComplete`) + gen-stage wiring (:2083-2160). A
Competitive/Full narrative whose donor DEFINES the structure (3–20 sections)
generates one bounded call per section, position-keyed, each persisted into
the running stage's own output (`gen_progress` — the same mechanism as the
gate's `gate_text`; `claim_next_stage` does not clear output) the moment it
passes the deterministic material check. A re-invoked worker resumes:
persisted sections are skipped only after **re-passing** the check (nothing
trusted from storage); assembly adds the donor's headings deterministically —
byte-exact by construction, in the donor's order; the assembled document then
goes through the normal whole-document validation/repair, with per-section
targets summing under the same 0.94 headroom the single-shot brief uses.
Draft/trial and free-structure narratives keep the single-shot path; every
gen:* now checkpoints its finished document before `done()`, and a persisted
finished document resumes at zero model calls after re-verification.

**Marked `UNPROVEN ON DEPLOYED RUNTIME` in the code comment, as specified:**
the local stack cannot reproduce production invocation limits, so the
production kill/resume cycle is not reproduced anywhere in this proof set.

**Proof (DENO-EXTRACT):** `tests/adversarial/resumable_generation_test.ts` —
executes `sectionPlan`/`assembleSections` from the shipping source
(tier/structure/count gating; position keys; target arithmetic ≤ 94% of the
donor limit with a 60-word floor; byte-exact heading assembly in donor order;
no partial assembly; re-check-not-trust) and asserts the
resume/skip/persist/re-verify wiring and kind-keying by source. ALL HELD.

## 9. Deferred and residual, collected

1. `numeric_register.ts` wiring (§3) — no spec, unverifiable without model budget.
2. `upload-intake-file` insert-response check — outside owned paths (WS4a's own §6 note stands).
3. Gate QUALITY/INFRA paths not executed end-to-end here (§4) — decision machinery covered by tests/delivery-gate.
4. Worker-driven strategy retry not executed (§5) — model call required; DB semantics fully executed instead.
5. Fingerprint binds grant length+readability, not text (§2) — module's own canonical design; unreachable from public surfaces.
6. `index.html` slot questions + checkout_token flow — read-only for this workstream; until it lands, save-intake refuses real submissions (invariant 2 as specified).
7. `db/schema.sql` untouched: it is the reference dump of PRODUCTION, which has deployed none of these migrations; the replay's deployment-state section is the tracker.
8. `tests/run-all.sh` untouched (owned elsewhere): add `tests/notifications/run.sh` to it at merge.
9. Automatic Stripe refunds still do not exist anywhere (phase3-gate §7.1 decision unchanged); `payment_ungated`@immediate and `gate_refund_failed`@immediate are the operator remedies.

## 10. Test status

`sudo env TMPDIR=/tmp PGBIN=/usr/lib/postgresql/17/bin bash tests/run-all.sh`
→ **ALL SUITES PASSED, exit 0** (log: session scratchpad `ws6/run-all-final.log`):
migration replay + parity `REPLAY OK` (8/8 against the re-recorded
fingerprint; deployment-state correctly lists the whole undeployed delta);
exclusivity `PASSING — no ceiling` with the new CHECKOUT-CLEARANCE,
ESCALATION-KINDS and ORPHAN-CLAIM sections green and the concurrency probe
40/40; ladder byte-match; proper-nouns; numeric register; delivery gate (555
checks); sufficiency; contact-claims; crawl-outcome; word-limit; referent
weight; donor limits (71 forms); and all NINE adversarial suites — the four
originals plus this workstream's `payment_without_clearance`,
`parser_silent_pass_wiring`, `crawl_starvation`, `cost_accounting`,
`resumable_generation`. Separately: `tests/notifications/run.sh` → ALL
NOTIFICATION TESTS PASSED (wording + STUB-STACK). Worker, save-intake and
stripe-webhook all `deno check` clean under Deno 2.9.5.

Commits, in order: `cd40e29` (§1), `8861d1b` (§2), `5b19f41` (§3), `6f4e847`
(§4), `0dd0c5b` (§5), `4a78c83` (§6), `9f4d201` (§7), `cdb9daa` (§8).
Nothing was deployed; deployed worker remains v26. Diff before deploying, per
DEPLOY.md discipline, and re-pull the transcribed functions first.

<!-- END OF ENGINEERING SECTIONS — ws6-bench appends the benchmark section below. -->
