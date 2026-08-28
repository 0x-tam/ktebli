# Adversarial round 2 — loop limits & invariant 8 ("no paid order fails in silence")

**Date:** 2026-08-28 · **Adversary workstream:** phase 6.5 gauntlet, round 2 ·
**Model spend: $0.00** — every attack is deterministic, driven with injected fake
`judge`/`chat`/`spend` deps; no real model call was made.

**Targets (all READ-ONLY to this workstream):**
`supabase/functions/worker/delivery_gate.ts` (`loopAction`, `runGateLoop`,
`materialChange`, `runDeliveryGate`) and `supabase/functions/worker/index.ts`
(`notifyTerminal`, the gate hold/refund wiring at :2490–2639, the two hold-class
paths).

**Verdict: BROKEN.** One clean, executable break in the loop's material-change
floor (P1, delivery_gate.ts — importable and proven by a failing test); one
secondary silent-failure hole in `notifyTerminal` (P1, index.ts — analysis-only,
that module cannot be imported by a test). Four other vectors probed and **held**.

---

## BROKEN 1 — the material-change floor is defeated by a padding regeneration

### The rule
Loop invariant: *"material diff required between attempts."*
`reports/phase3-gate.md` states it as: **"Material diff required (`materialChange`
between consecutive attempts)."** The intent is that a regeneration which did not
actually rewrite the document is refused, so the loop cannot spin (or burn its
budget and judge dollars) re-judging near-identical drafts —
delivery_gate.ts:1080 calls this "the loop's favourite failure."

### The seam
`materialChange()` (delivery_gate.ts:1134) returns **four** fields:

```ts
{ changed_fraction, retention, identical, material }
material = !identical && changed >= threshold && retention <= MAX_CONTENT_RETENTION
```

`retention` (word-multiset survival) was added **specifically** to defend against
the insertion attack, and the author documented exactly that at
delivery_gate.ts:1102–1108:

> "Word-5-grams cannot see the strongest form of the non-rewrite: insert one
> filler word every four words and every 5-gram breaks while every content word
> survives in order, which scores 0.990 on the shingle measure. Retention is
> insertion-robust. … a padded, interleaved or reordered copy retains 1.000."

**But the loop never reads `material` or `retention`.** It keeps only the scalar
the author just warned is insertion-fragile:

- `runGateLoop`, delivery_gate.ts:**1880**:
  `changed = materialChange(previous, narrative).changed_fraction;`
  — the `material`/`retention` verdict is computed and discarded.
- `loopAction`, delivery_gate.ts:**1622**:
  `if (last.changed_fraction !== null && last.changed_fraction < limits.minMaterialChange)`
  — the only material-change test in the loop, and it sees only `changed_fraction`.

A grep of the whole tree confirms `retention`/`.material` are consulted **only**
inside `materialChange()` itself and in test files — never in any decision path
(`loopAction`, `runGateLoop`, or the index.ts wiring).

### The attack
A "regeneration" that returns the previous document with one filler word inserted
after every fourth word (`pad()` in the test — round 1's own L3 document):

| measure | value | what sees it |
|---|---|---|
| `retention` (previous words kept) | **1.000** | `material` — the loop ignores it |
| `material` | **false** (correct) | the loop ignores it |
| `changed_fraction` (5-gram) | **1.000** | the loop's floor sees this → passes 0.20 floor |

Content is **100% preserved**; the document did not change. Yet the loop treats it
as a material rewrite.

### Proof — `tests/adversarial/adv2_loop_notify_test.ts` (FAILS against current code)

```
A1 ok    materialChange says non-material: retention=1.000 > 0.85
A1 ok    yet its changed_fraction is 1.000, above the 0.2 floor  (the scalar the loop keeps)
A2 FAIL  loopAction on a retention-1.000 regeneration -> action="regenerate" event="gate.quality_hold"
         (SAFE: refund / gate.no_material_change)
A3 FAIL  runGateLoop end-to-end -> regenerations=2, judge_calls=3,
         event="gate.regeneration_budget_exhausted"  (SAFE: stop at first padded regen, gate.no_material_change)
A4 ok    control: a 3% edit is still refused (defect is the insertion seam, not the floor in general)
2 FAILURE(S) — loop material-change floor is DEFEATED by padding   (exit 1)
```

A3 drives the full `runGateLoop` with an injected judge (always fails the bar on
`specificity=2`, strictly improving score so the divergence guard cannot mask the
result) and a `regenerate` hook that returns `pad(previous)` every time. The loop
runs its **entire** two-regeneration budget and re-judges the padded copies
**three times** ($0.03 of simulated priced calls) before refunding under
`gate.regeneration_budget_exhausted` — when it should have halted at the **first**
padded regeneration under `gate.no_material_change`.

### Why round 1 did not catch it
The seam was never crossed by a test:
- `tests/adversarial/regeneration_loop_test.ts` L1–L3 assert
  `!materialChange(...).material` — they test the **function** (which is correct;
  L3 even prints `changed_fraction=0.988` with `material` false).
- `tests/delivery-gate/delivery_gate_test.ts` "a document that did not materially
  change stops the loop" feeds `loopAction` a **synthetic** `changed_fraction:
  0.03` — a low number the loop does refuse.

No test ever derived a **real** `changed_fraction` from a padded document and
pushed it **through** `loopAction`/`runGateLoop`. The function's robust verdict
and the loop's fragile scalar were tested separately; the wiring between them was
not. Round 1's fix added `retention` to the function and its L1–L3 assert the
function — it never verified the loop consumes the verdict. It does not.

### Severity
P1. Bounded (the 2-regeneration hard cap still holds; nothing unfundable is
delivered, and the eventual outcome is still a refund with the customer told). The
damage is: the loop accepts a non-material diff as material, so a degenerate
generator (or an adversarial one) makes the gate spend its full regeneration
budget and up to 3 judge invocations per order on content-identical drafts, and
the stated invariant "material diff required between attempts" is false. The dollar
cost is capped by the spend cap, so this is a correctness/waste defect, not a
runaway.

### Fix spec (do NOT apply here — shared code is out of scope for this workstream)
The loop must consume the robust verdict, not the fragile scalar. Minimal change:

1. In `runGateLoop` (delivery_gate.ts:1880), carry the whole `ChangeReport`, not
   just `changed_fraction`. Add a `material: boolean | null` (and/or `retention`)
   field to `LoopAttempt`; set `material = materialChange(previous, narrative).material`.
2. In `loopAction` (delivery_gate.ts:1622), refuse when the change is **not
   material** — i.e. replace / augment the `changed_fraction < minMaterialChange`
   test with `last.material === false` (equivalently, also require
   `retention <= MAX_CONTENT_RETENTION`). Keep the existing `changed_fraction`
   floor so the low-edit case (A4) still refuses.
3. Add a regression case: `loopAction` on a `materialChange(DRAFT, pad(DRAFT))`
   result must return `gate.no_material_change` — i.e. adopt A2/A3 of the failing
   test as the fixed target.

---

## BROKEN 2 (analysis-only) — `notifyTerminal` can mark a terminal failure "notified" while telling NOBODY

`index.ts` calls `Deno.serve` at module scope and **cannot be imported by a
test** (the project's own convention, stated in delivery_gate.ts:1804–1806 and in
`tests/notifications/wording_test.ts`). This finding is therefore documented by
source analysis, not by an executable case in `adv2_loop_notify_test.ts`.

### The rule
Invariant 8: *every terminal failure notifies **customer AND operator**;* and the
overarching promise, *"no paid order fails in silence."* The mechanism of record
is the escalation row, written **before** any email so the alert survives even
where Resend is unconfigured (index.ts:1339, 1357).

### The hole
`notifyTerminal` (index.ts:1346) commits the idempotency marker **before** it has
made any notification attempt:

```
1350  await patch(job_stages, { notified_at: now });     // <-- marks "notified" FIRST
1352  const prop  = (await sel(order_proposals...))[0];   // sel() THROWS on any non-2xx (see :104-107)
1353  if (!prop) return;                                  // early return: nobody told
1354  const order = (await sel(orders...))[0];
1355  if (!order) return;                                 // early return: nobody told
1358  await ins("escalations", ...)                       // the "alert of record" — never reached on the above paths
1371  await sendEmail(customer...)                        // never reached
1375  await notifyOperator(...)                           // never reached
1377  } catch { /* swallow */ }
```

`sel()` (index.ts:104) throws on any non-2xx response (transient 5xx, network
blip, replica lag). If either lookup throws — or returns `[]` (row not yet
visible) — control leaves via the early `return` or the outer `catch {}` with
`notified_at` **already set** and **no escalation row, no customer email, no
operator email** written. Because `notifyUnnotifiedTerminals` (index.ts:1386)
sweeps only `notified_at=is.null`, the stage is **never retried**: the terminal
failure is swallowed permanently. That is a paid order failing in silence — the
exact thing WS6-core was built to prevent.

The happy path and the "Resend not configured" path are covered by
`tests/notifications/terminal_notify_stub_test.ts`; the transient-lookup-failure
path after the marker is set is not.

### Severity
P1, narrow trigger (requires a transient PostgREST error or a not-yet-visible row
in the ~4 lines after the marker commits). But the failure mode is the worst kind:
total, silent, unrecoverable by the sweep.

### Fix spec (do NOT apply here)
Set `notified_at` **last**, after the escalation row and the two email attempts
have been made (or write the escalation row first and the marker only once at
least one channel has been attempted). A throw/early-return before any attempt
must leave `notified_at` null so `notifyUnnotifiedTerminals` retries on the next
tick. This is the same "alert of record exists before the marker" ordering the
code already applies to the escalation-vs-email step; it just needs to apply to
the marker-vs-everything step too.

---

## Probed and HELD (conceded)

**(a) Force > 2 regenerations / re-entry with a fresh doc-hash or proposal id.**
Held. Two independent caps: `runGateLoop` hard-stops when `regenerations >=
maxRegenerations` (delivery_gate.ts:1865, counts `regenerate()` calls in this
run), and `loopAction` refunds when `qualityFails > maxRegenerations`
(delivery_gate.ts:1642, counts QUALITY holds across the whole record incl.
`priorAttempts`). A fresh doc-hash does **not** reset the budget: each regenerated
document is still pushed as an attempt and counted. Across worker restarts the
budget is reconstructed from the DB via `loopAttemptFromRecord`
(delivery_gate.ts:1794, which drops non-v2 rows and holds without a class). The
comment at :1861-1864 makes the two counters "smaller budget wins." No path
observed to exceed 2 regenerations. *Note:* BROKEN 1 makes each of those 2
regenerations spendable on non-material documents, but the count itself is not
exceeded.

**(c) Spend money without reserving (multi-call v2 path).** Held; round 1's
cap-after-spend fix (L6) stands. `runDeliveryGate` checks `spend.usd >= spendCap`
**before** the first call (step 5, :1433) and breaks the ladder after
`spend.usd >= spendCap` between rungs (:1461); `loopAction` reserves
`spendCap/(maxRegenerations+1)` between cycles (:1583) and separately halts on
`unmeasured_calls > maxUnmeasuredCalls` (:1591, round 1's L5). Residual, non-breaking
caveats worth recording, both already acknowledged in code/reports: (i) a single
`runDeliveryGate` cycle can still make up to ~4 priced calls (primary ≤2 format
retries + fallback ≤2), so the $2 reserve assumes a per-cycle cost ≤ $2 that is
**unmeasured** — DEFAULT_ORDER_SPEND_CAP_USD is explicitly "a budget, not a
measurement" (:1044); (ii) the SpendLedger is created fresh per worker tick
(index.ts gateDeps has no `spend`), so the cap is per-invocation, as
`reports/phase3-gate.md` §"Gate spend cap is per-invocation" already states —
INFRA retries across ticks cost ~$0 (failed/timed-out calls are never priced), so
this does not accumulate real spend. No injected-deps sequence produced an
unreserved paid call that the cap or the unmeasured backstop failed to catch.

**(d) A terminal failure that notifies nobody / `notified_at` set without an email
attempt.** Found — see **BROKEN 2** (marker committed before the attempt; a
transient lookup error swallows the notification permanently).

**(e) An INFRA_HOLD that emails the customer.** Held. The classes are provably
disjoint (`QUALITY_CAUSES`/`INFRA_CAUSES` partition `ALL_JUDGE_CAUSES` totally,
`classifyHold` throws on anything unclassified — delivery_gate.ts:780–797).
`tellCustomerOnHold`/`refundOnHold` return true for QUALITY only (:808–809).
`loopAction` never emits `action:"refund"` with an INFRA class, nor `hold_alert`
with a QUALITY class (:1584–1652 — every refund is QUALITY, every hold_alert is
INFRA). The index.ts wiring reads those actions: `hold_alert` → operator-only,
`operatorInfraHold` wording, and it sets `notified_at` so the terminal sweep can
never re-notify the customer (index.ts:2576–2599); the only customer email on the
gate path is under `action:"refund"` (QUALITY), :2601–2629. The grounding-failure
path the phase-6 e2e hit lands as DB status `failed` → `notifyTerminal` →
`customerTerminal` wording, which is a **terminal failure**, not an INFRA_HOLD;
telling the customer "we could not finish" is correct there and that wording never
uses the INFRA phrasing. No path observed where an INFRA_HOLD reaches the customer.

**(f) A QUALITY_HOLD that does not tell the customer or does not log the refund.**
Held. The refund branch calls `gate_refund_order` (which raises an immediate
`gate_refund_failed` escalation so the operator completes the transfer — the
refund is logged even though the worker moves no money) and sends
`customerQualityHold`, recording a `notify_customer` events row via
`recordNotifyAttempt` (index.ts:2606–2621). `refundOnHold`/`tellCustomerOnHold`
are true for QUALITY. The one nuance — the customer email is skipped when
`rr.already_emailed` — is idempotency, not silence (the first pass already told
them). No QUALITY_HOLD path observed that neither refunds/logs nor tells the
customer.

---

## Deliverables
- **Failing test:** `tests/adversarial/adv2_loop_notify_test.ts` — 2 failures
  (A2, A3), exit 1, `$0.00` real spend. Run:
  `npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_loop_notify_test.ts`
- **This report.**

Strongest attack: **BROKEN 1** — the loop's material-change floor consumes the
insertion-fragile `changed_fraction` and discards the insertion-robust
`retention`/`material` verdict that `materialChange()` computes for exactly this
attack, so a content-identical padded regeneration passes as a material rewrite.

---

## RE-ATTACK 2026-08-28 (post-fix) — CONCEDED

Both breaks were fixed and merged to trunk; I re-verified against the merged
`delivery_gate.ts` + `index.ts` and mounted one fresh round of attacks with
injected deps (`$0.00` real spend). **Nothing broke. CONCEDED.**

### The fixes, confirmed present
- **Loop material-change floor.** `runGateLoop` now keeps the whole verdict —
  `const report = materialChange(previous, narrative); changed =
  report.changed_fraction; material = report.material;` — and stores `material`
  on the `LoopAttempt` (delivery_gate.ts:1587, :1910, :1938-1940). `loopAction`
  now refuses on the insertion-robust verdict FIRST: `if (last.material ===
  false) return … gate.no_material_change` (delivery_gate.ts:1670), with the old
  `changed_fraction < floor` branch kept below it for the cosmetic-edit case.
- **`notifyTerminal` silent-swallow.** `notified_at` is now set **last**
  (index.ts, end of `notifyTerminal`), after the escalation row and BOTH email
  channels have been attempted, each `.catch`-guarded. A throw or `!prop`/`!order`
  early return before the notifications now leaves `notified_at` null, so
  `notifyUnnotifiedTerminals` (sweeps `notified_at IS NULL`) retries next tick.
  The marking now happens at the point notification is done, not before it begins.

### My own committed test now passes
`tests/adversarial/adv2_loop_notify_test.ts` against merged code: **ALL PASSED,
exit 0.** A2 → `refund` / `gate.no_material_change`; A3 end-to-end → the first
padded regeneration stops the loop at `regenerations=1` under
`gate.no_material_change` (was: `regenerations=2`, `gate.regeneration_budget_exhausted`).
A4 control (low-edit refusal) preserved.

### Fresh attacks, all HELD (injected deps, `$0.00`)
Driven against the merged functions (scratch harness, not committed):

| # | attack | result | why it held |
|---|---|---|---|
| R1 | force > 2 regenerations: every regen genuinely material, fails bar, score strictly improves | **held** — `regenerations=2` then `refund`/`gate.regeneration_budget_exhausted` | dual hard cap: `runGateLoop` stops at `regenerations >= maxRegenerations`, `loopAction` refunds at `qualityFails > maxRegenerations` |
| R2 | dodge `material===false` with a 20%-word-deletion copy | **held** — `material=true` (retention 0.804 ≤ 0.85) so the dodge "works" at the function level, but it buys nothing: still bounded by R1's 2-regen cap, and a 1-in-5-word deletion is a real content change by the retention metric, not the near-identical case the guard targets | the guard is a necessary floor, not the whole bound; the count cap is the real backstop |
| R3 | `material===false` via pure sentence reorder (retention 1.0) | **held** — `material=false` → `loopAction` returns `refund`/`gate.no_material_change` | reorder keeps every word → retention 1.0 → non-material, exactly as intended |
| R4 | budget reset via seeded DB history (2 prior QUALITY holds + a fresh material regen) | **held** — `refund`/`gate.regeneration_budget_exhausted` | `qualityFails` counts QUALITY holds across the whole record incl. `priorAttempts`; re-entry cannot reset it |
| R5 | crash-window replay: a padded doc carried across a worker restart has `material=null` / `changed_fraction=null` and skips the EARLY no-material refund | **held (bounded residual)** — that one carried doc is not refused early, but `qualityFails` still counts it, the 2-regen cap still bounds the order, and the outcome is still a refund with the customer told | worst case is one extra judge call under a precise crash window; **not silence, not > 2 regens, not a bad delivery** |

### Notification / hold-class re-probe
- **INFRA → customer:** still disjoint. `loopAction` emits `refund` only with
  `QUALITY_HOLD` and `hold_alert` only with `INFRA_HOLD`; the gate wiring routes
  `hold_alert` to the operator alone and self-sets `notified_at` so the terminal
  sweep cannot re-notify the customer; the only customer email on the gate path
  is under the QUALITY `refund` branch. No INFRA path reaches the customer.
- **Terminal swallow:** the `notified_at`-last ordering means a transient lookup
  error now retries rather than swallows. The remaining direction is
  at-least-once (a persistent final-`patch` failure would let the sweep re-send),
  which is over-notification, not silence — the correct trade for invariant 8.

### Verdict
The material-change floor now consults the insertion-robust `material` verdict;
`> 2` regenerations is impossible; re-entry does not reset the budget; a reordered
or padded content-identical regeneration refunds; and `notifyTerminal` no longer
marks-and-swallows. I could not produce a delivery of an unfundable document, an
unbounded/`> 2` regeneration loop, an INFRA→customer leak, or a terminal failure
that notifies nobody. **CONCEDED — both fixes hold.**
