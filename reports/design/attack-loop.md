# ADVERSARIAL — the regeneration loop

**Date:** 2026-08-27 · **Target:** `supabase/functions/worker/delivery_gate.ts` (the loop) and the
`validate` stage in `supabase/functions/worker/index.ts` · **Verdict: BROKEN — three ways, one of
them structural.**

No model was called. The OpenRouter key is capped and outbound access is refused; everything below
is deterministic code run against the real functions. Scripts:
`a1_oscillate.ts`, `a4_material.ts`, `a5_spend.ts`, `a7_replay.ts`, `a9_fixcheck.ts`, `a10_retention.ts`.
Failing test: `/home/user/ktebli/tests/adversarial/regeneration_loop_test.ts` (exit 1, 7 of 8 fail).
Fix: `patch-regeneration-loop.md`, applied to a scratch copy and verified.

---

## 0. The finding that outranks every other one: the loop has no caller

`loopAction()`, `runDeliveryGate()`, `LOOP_LIMITS`, `materialChange()` and the spend ledger are
**not reachable from the worker.**

```
$ grep -rn "loopAction\|runDeliveryGate" --include=*.ts . | grep -v node_modules
supabase/functions/worker/delivery_gate.ts
tests/delivery-gate/delivery_gate_test.ts
```

`index.ts` does not import `./delivery_gate.ts` (its import block is `index.ts:29-41`; the file is
never named anywhere in `index.ts`). Every bound I spent this session attacking is dead code
against a paid order today.

And there is **nowhere to persist a loop**. `attempts[]` and `SpendLedger` are function arguments.
`db/schema.sql` has no column for either: `job_stages` carries `attempt` and `max_attempts` and
nothing else. That matters because of the reaper — `reap_stale_stages()` puts any stage with no
heartbeat for three minutes back to `pending`, and `claim_next_stage()` re-runs it with
`attempt + 1` up to `max_attempts = 3`. An `attempts[]` and a spend ledger that live inside one
edge-function invocation are destroyed by every reap and start again at zero.

Measured (`a7_replay.ts`), driving the real `loopAction()` and real `materialChange()` through
three stage attempts with an in-memory ledger:

```
stage attempt 1: stopped after 3 gate runs by gate.spend_cap_reached (spend $8.10)
stage attempt 2: stopped after 3 gate runs by gate.spend_cap_reached (spend $8.10)
stage attempt 3: stopped after 3 gate runs by gate.spend_cap_reached (spend $8.10)
TOTAL: 9 gate runs, 6 regenerations, $24.30 against a $6.00 per-order cap — 4.0x
```

Two things in that trace, and both are real:

- **the per-order cap is multiplied by `max_attempts`.** Fix the cap arithmetic and it is still 3x,
  because the ledger resets with the history.
- **within a single attempt the cap is already overshot: $8.10 against $6.00.** That is finding 2.

**This is the requirement, and it should be a migration rather than a convention:** whoever wires
the gate must give the loop persisted attempt-history and spend, keyed on the proposal, in the same
commit — so `loopAction()` is called with the order's whole history and never with one invocation's
fragment. It is a pure function of `attempts[]` and it has no other defence: no absolute counter, no
wall clock, nothing read from the database. Hand it a truncated history and every limit resets.

---

## 1. BROKEN — `materialChange()` does not detect a non-rewrite

This is the loop's own stated favourite failure (`delivery_gate.ts:1037-1039`): *"Regenerating
something near-identical and hoping for a better verdict is the loop's favourite failure."*
It is defeated by three transformations that a real generator produces by accident.

Measured against a 315-word draft (`a4_material.ts`); floor is `MIN_MATERIAL_CHANGE = 0.20`:

| what the generator returned | `changed_fraction` | loop's verdict |
| --- | --- | --- |
| the identical document | 0.000 | refused ✓ |
| the identical document, whitespace churned | 0.000 | refused ✓ (`normaliseDocument` handles it) |
| **previous draft + one filler sentence x10** | **0.261** | **passes as a rewrite** |
| **previous draft + its OWN first sentence x10** | **0.325** | **passes as a rewrite** |
| **previous draft, one filler word inserted every 4 words** | **0.990** | **passes as a rewrite** |
| previous draft with half of it deleted | 0.000 | refused ✓ |
| a genuine paraphrase | 0.988 | passes ✓ |

**Why the first two work.** `changed_fraction` is the containment of NEXT in PREVIOUS only —
`total` sums over `b` alone (`delivery_gate.ts:1082-1084`). Nothing measures what *left* the
previous document. Appending therefore buys novelty without changing one word of the document that
was held. Padding with the document's own sentences is cheaper still: `Math.min(v, a.get(k))` caps
the shared count at the *previous* document's multiplicity, so repeating an existing sentence
inflates `total` while `shared` stays pinned.

**Why the third is worse.** Insert a filler word every four words and every 5-gram breaks, so
`changed_fraction` reads **0.990 — a near-perfect rewrite score for a document in which every
content word survives, in its original order.** No threshold fixes this and no n-gram measure can
see it. The guard is measuring novelty of *surface form* and calling it change of *substance*.

**How far it gets, and what stops it.** It defeats the `no_material_change` refund entirely, so the
loop spends both its regenerations instead of stopping at the second attempt. What stops it is the
plain counter — `qualityFails > limits.maxRegenerations`, three judgements on the merits and out.
So this is a cost and quality hole, not an unbounded loop *on its own*. Combined with finding 0 it
is unbounded, because the counter resets too.

---

## 2. BROKEN — the dollar cap, twice

### 2a. The cap cannot see its own hole

`addSpend()` deliberately refuses to price an unmeasured call at zero, and says so at
`delivery_gate.ts:1014-1016`: *"An unmeasured call is a hole in the cap, and the cap must know it
has a hole."* The ledger knows. **The cap never asks.** `loopAction` tests `spend.usd >=
limits.spendCapUsd` and reads `unmeasured_calls` nowhere.

```
1000 calls with usd=null -> spend.usd=$0.00, unmeasured_calls=1000
loopAction after 1000 unmeasured calls -> retry_gate
```

This is not a corner case. `GateDeps.judge` is **optional** (`delivery_gate.ts:205-208`) and its own
comment records the consequence: *"When it is absent, v2 wraps `chat` and records the spend as
unmeasured — never as zero."* Run the real `runDeliveryGate()` with `chat` and no `judge`
(`a5_spend.ts`):

```
spend after gate: usd=$0.00 calls=504 unmeasured=504
step-5 pre-call cap check is 'spend.usd >= 6' -> false
```

**With `deps.judge` absent the per-order dollar cap is structurally dead, at both check sites.**

### 2b. The cap is checked after the spend — the attack named in the brief, confirmed

`loopAction` tests the cap before authorising the next cycle but after the last one has landed, and
nothing reserves the cost of the call it is about to authorise. At `$5.99` against a `$6.00` cap it
returns `regenerate` — a full gate run plus a full generation, of a cost nobody bounded. Measured
overshoot in a single stage attempt: **$8.10 against $6.00, 35% over.**

Worse: the committed suite **asserts this behaviour** at `tests/delivery-gate/delivery_gate_test.ts:891`,
captioned *"one cent under the cap the loop still runs"*. The defect is written down as a
requirement, which is why nothing caught it.

---

## 3. BROKEN — a stored verdict is trusted rather than checked

`delivery_gate.ts:229-232` states the rule: *"The gate version is inside the hash on purpose. If the
bar changes, every stored verdict was reached against a different standard, and replaying it would
be the one way to smuggle a document past the new bar without judging it."*

The version is in the hash. **It is never checked on the record that comes back.** `runDeliveryGate`
casts whatever the store returns straight into a `JudgeOutcome`:

```
const s = stored as unknown as JudgeOutcome;
return { ...s, doc_hash, from_record: true, model_calls: 0, spend };
```

`deps.storedVerdict` is typed `Promise<GateOutcome | null>` — the **v1** interface
(`delivery_gate.ts:149-161`), which carries no `hold_class`, no `score`, no `spend`, no `alerts`,
no `headroom`. The `as unknown as` is load-bearing: it is a typing-only assertion silencing the
compiler on exactly the fields the loop branches on. Measured (`a7_replay.ts`):

```
a stored v1 PASS replays to -> deliver, model_calls=0, gate_version reported=delivery-gate-v1
a stored v1 HOLD replays with hold_class=undefined; loopAction THREW
```

A v1 pass **delivers** under the v2 gate having never been judged by it — the exact smuggling the
comment says the design prevents. A v1 hold fails closed, which is right, but it kills the validate
stage with an exception rather than a hold: three stage retries into the same wall, then `failed`.

The one thing standing between this and production is that a correctly-implemented store keys on a
hash that already includes the version, so the lookup would miss. **The module is relying on the
store to be right rather than checking, and there is no store yet to be right.**

---

## What I could NOT break — and I tried hard

These held under direct attack. Reporting them as passes is the point of the exercise.

**The INFRA / QUALITY boundary held against five separate attacks** (`a5_spend.ts`). This is the
attack the brief named — *"an INFRA_HOLD misread as a QUALITY_HOLD so the order regenerates on an
outage"* — and I could not land it.

- `classifyHold()` is total over `ALL_JUDGE_CAUSES`, the two sets are disjoint, and an unlisted
  cause **throws** rather than defaulting. There is no fall-through to guess with.
- Every provider failure I could construct — `403 Key limit exceeded`, a 90s timeout, a transport
  error, `502`, `429` — routes through `classifyProviderError` to `cap` / `timeout` / `transport`,
  and `runJudgeRung` returns immediately with `ok=false` for all of them, so step 7 produces
  `cap_exhausted` or `judgement_unavailable`. **Both are INFRA.**
- The nastiest case — a provider that is *up* but degraded, returning HTTP 200 with an error body
  that the schema parser rejects — still lands INFRA, because `parseJudgeReply` failing sets
  `error_class = "unreadable"`, which never yields a judgement, so there is no `verdictAttempt`.
  An outage cannot become a fact about the document on any path I could find.

**Oscillation and alternating scores were both caught** (`a1_oscillate.ts`), each by a different
guard, each with its own event code:

```
A/B/A/B, score 20/21/20   -> refund at step 3, gate.score_diverged
A/B/A/B, score climbing   -> refund at step 3, gate.regeneration_budget_exhausted
identical every time      -> refund at step 2, gate.no_material_change
whitespace churn          -> refund at step 2, gate.no_material_change
```

**Interleaving INFRA holds does not reset the quality budget.** `trailing` counts only trailing
INFRA holds, so I tried `INFRA, INFRA, QUALITY, …` forever to keep resetting it. `qualityFails`
counts *all* quality holds cumulatively and stopped it at step 8 with
`gate.regeneration_budget_exhausted`. The two counters are correctly scoped.

**`generateValidated()` (`index.ts:643-691`) is straight-line, not a loop** — exactly three
attempts, no `while`, and it `throw`s on the third failure. It cannot run away by construction.
The similarity-gate loop (`index.ts:1855-1861`) is `while (worst > 25 && rewrites < 2)` with the
counter incremented first. Both bounded.

**The deployed stage machine is the thing that actually bounds runaway today, and it is sound.**
`claim_next_stage()` selects `where s.attempt < s.max_attempts` and sets `attempt = s.attempt + 1`
in the same statement under `FOR UPDATE SKIP LOCKED`; `reap_stale_stages()` marks
`case when attempt >= max_attempts then 'failed'`. There is no path where a reap returns a stage to
the queue without having consumed an attempt. `index.ts:2020` then fails terminally at
`st.attempt >= 3` and calls `notifyTerminal`. **A stage cannot loop forever in production.** That is
also precisely why finding 0 bites: the only durable counter is per *stage*, and a regeneration
budget is not a stage retry budget.

---

## Against the invariants

- **Invariant 2 (no money taken for an order that cannot be fulfilled)** — not breached: every
  terminal quality path refunds, and I could not reach delivery on a held document.
- **Invariant 8 (no paid order fails in silence)** — not breached on these paths; every stop
  carries an event code and `alertOperatorOnHold()` returns `true` for both classes. The one ugly
  case is the v1-hold replay, which exits by exception rather than by a hold — still loud, via
  `notifyTerminal`, but it is an exception and not a decision.
- **Invariant 9 (all of it observable)** — the new stop reasons need event actions;
  `gate.spend_unmeasured` is specified in the patch and `events.action` is `text`, so no migration.
- **Nothing here weakens a gate.** Every fix is a refusal added, never a condition relaxed. The two
  test-file changes the patch requires are assertions that encode the defect, not thresholds moved:
  one fixture that calls a reordered copy a rewrite, and one that requires the cap to be overshot.

---

## Ranked

1. **Wire the gate, or delete it.** It is 1,638 lines of unreachable safety code and its absence is
   not visible from `index.ts`. If it is wired, the loop's history and spend must be persisted in
   the same commit, because the reaper resets both every three minutes.
2. **Patch 2 (the cap).** Smallest change, largest blast radius: with `deps.judge` absent the cap
   does not exist at all.
3. **Patch 3 (stored verdicts).** A stale pass delivers unjudged. Cheap to close, and it must be
   closed before a store is built, not after.
4. **Patch 1 (`materialChange`).** Defence in depth. Note honestly that the counter — not this
   function — stopped every one of my loop attacks, so this is a quality and cost fix rather than a
   runaway fix. Patch 1b needs the fixture change; do not apply it without.

## MISSING

- **The real cost of a gate run is not measured.** `DEFAULT_ORDER_SPEND_CAP_USD = 6.00` is a budget,
  not a measurement, and the file says so at `delivery_gate.ts:1000-1004`. Every model call in this
  environment returns 403, so the overshoot figures above are stated in units of that unmeasured
  cap. The *ratios* (4.0x, 35% over) are real and do not depend on the price; the dollar amounts do.
- **`MIN_MATERIAL_CHANGE = 0.20` is still uncalibrated**, and so is the `MAX_CONTENT_RETENTION = 0.85`
  I propose. Both are floors chosen to sit obviously between a polish and a rewrite, measured on
  synthetic and archived documents. What neither has is the distribution that matters: what a real
  regeneration under a real fix brief scores. That needs model calls.
- **No judgement of whether the loop improves a document.** The regeneration brief's effect is
  entirely unmeasured. This session says only that the loop stops; it says nothing about whether
  stopping later would have helped.
