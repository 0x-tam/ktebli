# Adversarial round 2 — INVARIANT 4: "every number is derived once"

**Invariant as stated:** `resolveRegister()` runs before writing; every figure resolves
through it; totals are recomputed at the gate and at closing, exactly, units included.

**Verdict: BROKEN.** Three ways, in increasing severity. Two are register-internal holes
that round 1 did not close; the third is that the register is not wired to the pipeline at
all, so the invariant's central clause — "every figure resolves through it" — is false
before any arithmetic is even considered.

Failing test: `tests/adversarial/adv2_numeric_test.ts` (A9, A9b, A10, A11). Every case was
executed against the real `supabase/functions/worker/numeric_register.ts` and the real
`index.ts` before being written; the test exits non-zero today (7 failures) and is the
specification for the fixes below. Deterministic, `$0`, no model:

```
npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_numeric_test.ts
```

Do NOT fix shared code from this task — the fixes below are specifications.

---

## BREAK 1 (register-internal, primary) — a rate right about the WRONG denominator

**Where:** `supabase/functions/worker/numeric_register.ts:216-220` — the rate branch of `walk()`.

```ts
if (!norm(n.label).includes(norm(den.label))) {
  throw new RegisterError("rate_denominator_label", n.id, …
    `A rate must name its own denominator, or it is right about the wrong quantity.`);
}
```

PATCH 6 exists, in its own words, so that "75% of total project cost divided by the grant
gets caught." The guard it uses is a **naive substring test**. It assumes the denominator's
label honestly names the denominator — but labels are model-controlled, and they are the only
defence. Any denominator whose label is a substring of the rate's label satisfies it.

**The non-closing number: 0.75.** Register (test A9):

| id | label | value |
|----|-------|-------|
| B1 | frontline delivery costs | £81,000 |
| B2 | **cost** | £108,000  ← this is the grant |
| B3 | match funding | £12,000 |
| B4 | **total project cost** (sum B2+B3) | £120,000 |
| R1 | **share of total project cost reaching frontline delivery** (rate B1/B2) | asserted 0.75 |

`R1 = 81000 / 108000 = 0.75` closes. But the register **holds its own total**, `B4 = 120,000`,
and the honest share of total project cost is `81000 / 120000 = 0.675`. The register blesses a
claim that contradicts a figure it computed one line earlier, because
`"share of total project cost reaching frontline delivery".includes("cost")` is true. This is
the exact defect `reports/quality-iteration-1.md` §5 records as live and confirmed
("over 75% to frontline delivery … recomputes to 61.9–69.0%") and that the register's header
claims to make impossible ("Every one throws in `resolveRegister()`").

Round 1's A6 only looked closed because its denominator was labelled `"grant requested"`, which
is not a substring of the rate label. Relabel it `"project cost"` (A9b, a substring of
"total project cost") — no true-total node needed — and it walks straight through. Confirmed:
both A9 and A9b return without throwing; `R1.value === 0.75`.

**Fix spec** (numeric_register.ts:216-220), two parts, both needed:

1. Replace substring containment with a **word-boundary phrase match** of the denominator's
   full label inside the rate's label (tokenise on `norm`; require the denominator's token
   sequence to appear as a contiguous run). This alone kills the one-word `"cost"` case (A9),
   because "cost" is no longer a free-floating substring of a longer phrase — the rate label
   would have to literally contain the denominator's whole name.
2. When the rate's label applies a totalising modifier to the denominator noun
   (`total|overall|whole|entire|combined|gross`), require the denominator node to be the
   register's actual total of that unit — i.e. a `sum` node, or the unique maximal-valued node
   of that `unit` — not a bare leaf. In A9 that forces R1's denominator to be `B4` (120,000),
   at which point `0.75` fails closure against the recomputed `0.675`. Concretely: if any
   `sum` node of the same `unit` has value `> den.value` and its label also matches the rate's
   totalising phrase, reject `rate_denominator_label`.

**Fix must not break the honest control** (test A9, "delivery cost per participants" = 750): a
rate whose label names its denominator without a totalising word (`GBP/participants`) still
resolves. Verified — the control passes today and must keep passing.

---

## BREAK 2 (register-internal, secondary) — a ratio "verified" by a colliding integer

**Where:** `supabase/functions/worker/numeric_register.ts:318-319` (the `evidence` branch of
`admissible()`), together with `numbersIn()` at lines 92-101.

```ts
const pct = r.unit_kind === "ratio" || r.unit_kind === "rate";
if (!(item.has(r.value) || (pct && item.has(asPercent(r.value))))) { throw … }
```

PATCH 4 correctly stopped pooling the whole ledger, so a figure is now checked against the item
it names. But within a single item, `numbersIn()` records only the *magnitudes* — it does not
record which numbers wore a `%` sign. So the ratio-as-percent path accepts a bare integer that
merely coincides with `asPercent(value)`.

**The non-closing number: 0.11.** Ledger item `E-WEB-1 = numbersIn("Our team of 11 staff runs
3 centres across the borough")`. A leaf ratio `0.11` cited to `E-WEB-1` is accepted, because
`asPercent(0.11) = 11` is in the set — put there by "11 **staff**", not by any stated
percentage. Confirmed: A10 passes through today. This is the same class as round-1 A5 (0.77
verified by a stray 1), one abstraction level up: the item is real, the id is honest, and the
number still isn't provenance.

**Fix spec:** the ratio-as-percent comparison must consult a **percent-tagged** set, not the raw
integer set. Have `numbersIn()` (or a sibling `percentsIn()`) return, alongside the magnitudes,
the subset of numbers that appeared immediately before `%` or the word `percent`. Store both on
the evidence map (e.g. `Map<string, {nums:Set<number>, pcts:Set<number>}>`) and change line 319
to `item.pcts.has(asPercent(r.value))` for the percent branch. Then "11 staff" no longer
verifies a `0.11` ratio, while "11% of referrals" still does. This is a signature change to
`resolveRegister`/`admissible` and the ledger builder, so it is a spec, not a patch.

---

## BREAK 3 (systemic, the strongest) — the register is wired to nothing

Round 1 hardened `resolveRegister()` into a genuinely tight function. It does not matter, because
**nothing in the worker calls it.** The invariant's clause "every figure resolves through it"
is false at the wiring, independent of any arithmetic hole above.

Evidence (test A11 asserts all four and all four fail today):

- **Not imported, not called.** `grep -n resolveRegister supabase/functions/worker/index.ts`
  → nothing. `index.ts` imports `proper_nouns`, `contact_claims`, `word_limit`, `crawl_outcome`,
  `delivery_gate`, `donor_limits`, `sufficiency` (index.ts:37-53) — never `numeric_register`.
  `numeric_register.ts:288` exports `resolveRegister`; the repo has no importer.
- **The design emits bare model numbers.** The design stage (index.ts:2076-2100) asks the model
  for `participants_total`, `budget_envelope_usd`, `duration_months` as plain JSON numbers, plus
  a prose `assumptions[]` array. There is no `numeric_register` field, no node graph, no
  `asserted` totals, no closure. The "single source of truth" is once again the design object
  pasted into prompts — precisely the anti-mechanism `numeric_register.ts:10-14` says it replaces
  ("an instruction to a language model, not a mechanism").
- **The only numeric gate is still one-directional.** index.ts:2251-2254 builds
  `dn = {participants: project.participants_total, …, budget_total: project.budget_envelope_usd}`
  straight from those bare model numbers, and the sole numeric check is
  `consistencyFindings(...)` (index.ts:2279). Its participant guard (index.ts:265) is
  `n > dn.participants * 1.01` and its duration guard (index.ts:275) is `n > dn.duration_months`
  — **overstatement only.** An understatement (`n < target`) passes by construction. That is the
  delivered **200-vs-216** defect, unchanged, live, and the register that fixes it is not in the
  path.
- **`numbersNear()` is dead.** index.ts:241 is `function numbersNear(a, b){ return a === b; }`,
  used only as `n > target*1.01 && !numbersNear(n, target)` (index.ts:265, 275). When the strict
  inequality is true, `n === target` is already false, so `!numbersNear(...)` is always true — it
  can never change the outcome. The declared "nearness tolerance" is a no-op.

**Fix spec (wiring — owner/pipeline work, not this task):**

1. Add a `numeric_register: RegNode[]` field to the design-stage JSON contract (index.ts:2076+),
   and require the model to route every project figure through it.
2. In the design stage, call `resolveRegister(design.numeric_register, currency, evidenceMap,
   donorNums)` and **fail the stage on any `RegisterError`** before a document is written. Persist
   the resolved `Map` on the design.
3. Feed generation from the resolved values (each section renders `Resolved.value` /
   `Resolved.derivation`), not from re-sampled model numbers.
4. At the gate/closing, re-run `resolveRegister` with `opts.frozen` = the design's resolved map
   (the immutability path PATCH 10 already built and that nothing exercises), and replace — or
   at minimum back — `consistencyFindings` with a check that every number printed in prose
   appears in the resolved register (use the exported `numbersIn()` against the narrative, which
   is currently dead outside tests). Until then, at least make `consistencyFindings` bidirectional
   and delete `numbersNear`.

Only step 4's prose→register cross-check makes "every figure resolves through it" *true*; steps
1-3 make the register the source instead of a validated side-object.

---

## CONCEDED — round-1 classes I re-attacked and could not reopen

Run against the real function; each threw as intended, so these stay closed:

- **Understatement at the register.** 200 asserted against components summing to 216 throws
  `closure_mismatch` — closure is exact equality, so it catches under- and over-statement both
  ways. (The one-directional hole survives only in the *unwired* `consistencyFindings`; see
  BREAK 3.)
- **Fraction as a headcount.** `280 places × 0.77 attendance = 215.6` throws `fractional_count`
  at the derived node; `12.5 people` throws it at the leaf.
- **Unit mismatch in a sum.** people + months throws `sum_unit_mismatch`; the member/parent
  `unit` and `unit_kind` are both checked exactly.
- **Self-declared `unit_kind`.** "people" as a `ratio`, a currency code as a `count`, "months" as
  a `count` all throw `unit_kind_mismatch` — `unitKindOf()` overrides the model's choice.
- **Pounds ÷ people as a "proportion".** throws `ratio_unit_mismatch` (numerator/denominator must
  share a unit for a ratio).
- **Arbitrary six-figure money leaf.** an undecomposed £247,500 that nothing consumes throws
  `money_leaf_total`; pseudo-precision on counts throws `pseudo_precision`.
- **Register revision / shrink under `opts.frozen`.** throw `register_revised` / `register_shrank`.
- **Two figures, one phrase.** duplicate label throws `duplicate_label`.
- **Rounding manufacturing a mismatch.** money closes at the minor unit (pence), so £1,000.50 × 3
  resolves to £3,001.50 and £3,003 is refused.

The register, taken as an isolated function, is close to sound — modulo BREAK 1 and BREAK 2. Its
problem is BREAK 3: it is not the thing that guards the numbers that ship.

---

## Strongest single statement

The register holds `total project cost = 120,000` and, in the same resolution, certifies
"share of total project cost reaching frontline delivery = 0.75" computed as 81,000 ÷ 108,000,
whose honest value against that very total is 0.675 (BREAK 1) — and none of this reaches a
delivered proposal anyway, because `resolveRegister()` is called by nothing and prose numbers are
still gated only by the one-directional, understatement-blind `consistencyFindings` with its dead
`numbersNear` (BREAK 3).

**BROKEN.**

---

# RE-ATTACK 2026-08-28 (post-fix)

The three breaks above were fixed and merged to trunk. I re-ran `adv2_numeric_test.ts`
(A9/A10/A11) against the merged `numeric_register.ts` + `index.ts` and all are **GREEN**:

- **BREAK 1 CLOSED.** Rate denominator is now matched by node identity — the denominator's
  label must appear as a whole token-run in the rate label, bounded on both sides by a
  start/end or a connective (`numeric_register.ts:249-259`). `"share of total project cost"`
  ÷ the `"cost"` node throws `rate_denominator_label` (left neighbour `"project"` is a content
  word). The right-extension variant (`"cost overrun"`, `"cost recovery"`) is closed too.
- **BREAK 2 CLOSED.** `numbersIn()` now records a fraction only for a number that wore a `%`
  (`asFraction`, `numeric_register.ts:120`), and the evidence check is `item.has(r.value)` with
  the `Math.round` term removed (`:364`). `"11 staff"` no longer verifies a `0.11` ratio.
- **BREAK 3 CLOSED (mechanism).** `resolveRegister` is imported (`index.ts:40`) and called in the
  design stage (`index.ts:2316`), failing the stage on any `RegisterError` before generation;
  the resolved values are threaded to generation as `register_derivations` (`index.ts:2331`,
  `:2422`). `consistencyFindings` is now bidirectional (`index.ts:277-280`) and the dead
  `numbersNear` is gone. A critic confirmed the wiring is real, not merely imported. Verified.

Then I made one more genuine attempt, per the mandate. **The mechanism does not fully hold.**
Two residual holes, both in `admissible()`/`walk()` themselves (deterministic, `$0`), now encoded
as failing cases **A12** and **A13** in `tests/adversarial/adv2_numeric_test.ts` (the file's first
eight assertions stay green; A12+A13 add 2 failures). **Verdict: BROKEN.**

## (a) The MECHANISM — BROKEN

### RE-1 (primary) — the %-provenance fix landed in the evidence branch, not the donor branch

**Where:** `supabase/functions/worker/numeric_register.ts:375` (the `donor` branch of `admissible`).

```ts
if (b.kind === "donor" && !donorNums.has(Math.round(r.value)) && !donorNums.has(r.value)) { throw … }
```

BREAK 2 removed `Math.round(r.value)` from the **evidence** branch (i) because a rounded ratio
collides with a stray integer. The **donor** branch (ii) still has it. For a ratio,
`Math.round(0.75) = 1`, and `donorNums = numbersIn(JSON.stringify(analysis))` (`index.ts:2313`) is
pooled over the entire analysis blob, where a bare `1` is near-universal. So a fabricated
`"the fund covers 75% of costs"`, attributed to the donor and **stated nowhere in the grant**, is
"verified" by that `1`.

**The non-closing number: 0.75** (test A12). Confirmed accepted. **Control (0.29, no `1` in the
grant):** rounds to `0`, correctly throws `donor_basis_unverified` — isolating the admission of
`0.75` to the `Math.round → 1` collision and nothing else. Any donor-attributed share in
`[0.5, 1.49]` is affected; the class BREAK 2 closed for evidence is still live for the donor.

The fix's own comment (`:374-376`) claims the donor branch is %-provenance-safe and cites `0.20` —
which rounds to `0` and sits *below* the collision threshold, hiding the bug for every share ≥ 0.5.
A validator that looks checked and is not is exactly this project's stated failure mode.

**Fix spec:** drop the `Math.round(r.value)` disjunct from `:375`, mirroring the evidence branch —
a donor figure is verified by `donorNums.has(r.value)` only. A ratio then matches only a real donor
percentage (`"75%"` → `asFraction` → `0.75`), never a headcount or a stray `1`. Keep the rounding
path only for counts if a genuine `1250.4`-vs-`1250` case needs it, gated on `r.unit_kind === "count"`.

### RE-2 (secondary) — wrong denominator via a connective-SEPARATED content qualifier

**Where:** `numeric_register.ts:249-259` (the identity match) + `RATE_LABEL_CONNECTIVES` (`:93-98`).

The identity match bounds the denominator token-run by connectives on both sides, so an **adjacent**
content word is refused. But a content qualifier **separated from the denominator token by a
connective** is not. Denominator `"cost"` stays bounded by `"of"`/`"of"` inside
`"share of cost of the whole project reaching frontline delivery"`, while `"of the whole project"`
reframes the quantity as the total. It divides by the grant (`108000`); the register's own total
(`B4 = 120000`) makes the honest share `0.675`, and `0.75` closes (test A13, confirmed accepted).
This is the same right/left-extension class BREAK 1 targeted, one connective away — narrower and more
awkward to phrase than RE-1, but the mechanism admits it.

**Fix spec:** the qualifier is the problem, not just adjacency. Two options: (1) after matching the
denominator run, reject if any **content** token elsewhere in the rate label is a totalising word
(`total|whole|overall|entire|combined|gross`) that is not itself part of a denominator node's label;
or, more robustly, (2) when the numerator is a strict component of a `sum` node of the same unit
(here `B1` is a sibling of the parts of `B4`), require the denominator to **be** that maximal `sum`
node, not a smaller leaf — a share of a whole must be divided by the whole the register actually holds.

## (b) The GENERATION-QUALITY half — UNPROVEN, not broken

Distinct from the mechanism, and I am **not** claiming a break here — only naming it as an open
measurement, as the design-stage comment already does (`index.ts:2300-2304`):

- Whether **every** figure a real narrative prints was first routed through the register (so that
  understatement is caught end-to-end because each section writes from `register_derivations`) needs
  a full pipeline order to prove. It costs model spend and was not run. Marked
  **unproven-without-e2e**.
- The backstop for prose numbers that bypass the register is still `consistencyFindings`. Its
  understatement guard now fires, but only for a total-claim `≥ 0.5 × design total`
  (`totalClaimFloor`, `index.ts:270`). A headline total understated by more than 2× (design 500,
  prose "200") falls below the floor and is read as a per-cohort figure — invisible. This is a
  property of the *backstop heuristic*, not of the register (the register catches understatement
  exactly, by closure). It matters only for numbers that never entered the register — i.e. exactly
  the coverage question above. It is a bounded backstop, not a mechanism break.

## Verdict

**BROKEN** — RE-1 is a deterministic, register-internal admission of a fabricated donor share
(`numeric_register.ts:375`, the `Math.round` term the evidence branch removed and the donor branch
kept; fix comment's `0.20` example masks it). RE-2 is a narrower residual of the wrong-denominator
class. Both are encoded as failing cases A12/A13. The generation-QUALITY coverage remains an honest
open measurement (unproven-without-e2e), separate from these two mechanism holes.

---

# RE-ATTACK #2 2026-08-28 — BROKEN (scope reframe is one-directional)

RE-1 and RE-2 were fixed and merged (trunk `eae6b18`). I re-ran `adv2_numeric_test.ts`
against the merged register: **A12 and A13 are now GREEN**, and A9/A10/A11 remain green.

- **RE-1 CLOSED.** The donor branch dropped `Math.round(r.value)` and is now
  `!donorNums.has(r.value)` (`numeric_register.ts:399`), mirroring the evidence branch. A
  fabricated `0.75` donor share no longer verifies against a stray `1`. Confirmed.
- **RE-2 CLOSED (for the case tested).** After matching the denominator run, the code walks
  the connective run to its **right** and refuses the match if it reaches a scope word in
  `{whole,total,entire,overall,combined,full,gross,aggregate,all}` (`numeric_register.ts:260-273`).
  `"share of cost of the whole project"` now throws `rate_denominator_label`. Confirmed.

Then one more attempt on the mechanism. **Still BROKEN**, encoded as failing case **A14**.

## (a) The MECHANISM — BROKEN

### RE-3 (primary) — the scope-reframe walk only looks RIGHT of the denominator

**Where:** `numeric_register.ts:262-274` (the `namesDenominator` predicate).

```ts
const leftOk  = i === 0 || RATE_LABEL_CONNECTIVES.has(rateToks[i - 1]);      // adjacency only
const end = i + denToks.length;
const rightOk = end === rateToks.length || RATE_LABEL_CONNECTIVES.has(rateToks[end]);
let k = end;                                                                 // walk RIGHT only
while (k < rateToks.length && RATE_LABEL_CONNECTIVES.has(rateToks[k])) k++;
const reframed = k < rateToks.length && k > end && SCOPE_REFRAME.has(rateToks[k]);
return leftOk && rightOk && !reframed;
```

`leftOk` checks only the **immediately adjacent** left token; the scope-reframe walk runs
**only to the right** (`k = end` forward). So a scope word placed **before** the denominator,
one connective away, clears `leftOk` (its neighbour is a connective, not the scope word) and is
never seen by the reframe walk. It reframes the quantity exactly as the right-side qualifier did.
This is the same defect the RE-2 fix note itself records — *"Left-anchoring alone let the
right-extension through"* — now on the reframe axis: right-only reframe detection lets the
**left-side** reframe through.

**The exact defeating input (test A14):** denominator `B2 = "cost"` (the grant, £108,000), the
register holding its own `B4 = "total project cost" = £120,000`, and

```
R1.label = "frontline share of the total of cost"   (rate = B1 / B2, asserted 0.75)
```

Tokens `[frontline, share, of, the, total, of, cost]`: `"cost"` at index 6 has left-neighbour
`"of"` (a connective, so `leftOk`) and sits at the end (`rightOk`); the reframe walk starts past
the end and finds nothing. The scope word — **`"total"`, the canonical member of `SCOPE_REFRAME`
itself** — sits at index 4, before the denominator, and is never inspected. `R1` resolves to
`81000/108000 = 0.75` over the grant while the register's own total says the honest share is
`81000/120000 = 0.675`. Confirmed accepted. The honest construction (dividing by `B4`) resolves
correctly at `0.675`, so the fix has a clean target.

### RE-3b (corroboration) — the scope-word SET is enumerable and incomplete

Independently of direction, the right-side check only fires on nine listed words. Natural
totalising synonyms it omits — `"complete"`, `"cumulative"`, `"consolidated"` —
reframe the same way: `"share of cost of the complete project"` is accepted (test A14, second
assertion). This is corroboration that a word list is the wrong shape of defence, not a separate
break.

**Fix spec:** the reframe test must be **direction-symmetric and not enumerated**. After a
denominator run matches, reject the match if any token in the rate label that is *not* part of
some register node's own label is a scope/aggregation modifier — checked on **both** sides, and
ideally as a positive rule rather than a blocklist: a share whose numerator is a component of a
`sum` node of the same unit must divide by **that** `sum` node (its `Resolved` identity), not by a
smaller sibling leaf. In A14 `B1` is a delivery line and `B4` is the total-cost `sum`; requiring
the denominator of a "share of … cost" to be the maximal cost node closes RE-2, RE-3 and RE-3b at
once, with no word list to keep current.

## (b) The GENERATION-QUALITY half — still UNPROVEN, not broken

Unchanged from the prior round and re-affirmed here: whether **every** figure a real narrative
prints is first routed through the register end-to-end (so understatement is caught because each
section writes from `register_derivations`) needs a full paid pipeline order and was not run —
**unproven-without-e2e**. That is an open measurement, not a mechanism break, and it is distinct
from RE-3, which is a deterministic hole in `resolveRegister` reachable with a crafted register and
no model at all.

## Verdict

**BROKEN.** Exact defeating input: a `rate` node `R1 = B1 / B2` with
`label = "frontline share of the total of cost"`, `B2 = "cost" = 108000` (the grant), alongside
`B4 = "total project cost" = 120000`; `resolveRegister` accepts `asserted 0.75` where the honest
share of the register's own total is `0.675`, because the scope-reframe walk never inspects the
word `"total"` sitting before the denominator. Failing test: A14 in `adv2_numeric_test.ts`.

---

# RE-ATTACK #3 2026-08-28 — BROKEN (structural rule tests node identity, not value-subsumption)

RE-3 was fixed and merged (trunk `6fbabdb`): the reframe walk is now direction-symmetric,
the scope-word set gained `complete/cumulative/collective/grand/sum/totality/net`, and — per
my own fix spec — a word-list-free structural closure was added: if the numerator is
transitively a member of a same-unit `sum` node `S`, the share must divide by `S`, else
`rate_denominator_not_whole`. I re-ran `adv2_numeric_test.ts`: **A14 is now GREEN** (both the
left-side `"total"` and the `"complete"` synonym are refused), and A9–A13 remain green.

The orchestrator's claim for the durable rule was: *"the structural sum-membership rule is the
durable closure when the register declares its aggregate as a sum (a closed budget always
does)."* I attacked exactly that claim, and it does not hold.

## (a) The MECHANISM — BROKEN

### RE-4 — the sum-membership test is node-IDENTITY, not value-subsumption

**Where:** `numeric_register.ts:299-320` (the `numInSum` recursion and the `for (const s of list)` loop).

`numInSum(S.of, num.id, …)` returns true only if the numerator **node id** appears (transitively)
in `S.of`. It never asks whether the numerator's *value* is subsumed by `S` — whether its
components are a subset of `S`'s components. So a **partial sub-aggregate** numerator escapes:

```
L1 delivery staff      = 50000        L2 sessional workers = 31000     L3 administration = 39000
F1 frontline delivery  = sum[L1,L2]   = 81000      (a roll-up subtotal)
T1 total project cost  = sum[L1,L2,L3]= 120000     (sums the LEAVES, flat)
G1 cost                = 108000        (the grant — the wrong denominator)
R1 "frontline delivery share of cost" = rate F1 / G1, asserted 0.75
```

`F1`'s components `{L1,L2}` are entirely inside `T1`, so `F1` is provably a part of `T1`
(`81000 < 120000`, componentwise). But `"F1"` is not a member of `T1.of = [L1,L2,L3]`, so
`numInSum(T1.of,"F1")` is false and `rate_denominator_not_whole` never fires. **No scope word is
used**, so the symmetric walk is irrelevant — this is purely the structural gap, independent of
the (still enumerable) word list. `resolveRegister` returns `R1 = 81000/108000 = 0.75`, though the
honest frontline share of the register's own total is `81000/120000 = 0.675`.

**The control proves it is exactly this.** Change one thing — declare the total as
`T1 = sum[F1, L3]` (frontline as a listed subtotal) instead of the flat `sum[L1, L2, L3]`.
Identical values, identical economics. Now `"F1"` IS a member of `T1.of`, the rule fires, and the
same division throws `rate_denominator_not_whole` (test A15, control assertion, green today). So
whether a part-over-wrong-whole is caught depends on an **incidental structuring choice** in how
the model wrote the total — flat over leaves vs nested over subtotals — not on the economics. A
model that builds a flat line-item budget and a separate `"% to frontline"` roll-up (a natural
shape) is unprotected; the durable closure the orchestrator relied on is silent for it.

This is **not** the acknowledged narrow residual. That residual was "an UNDECLARED-leaf total
using an unlisted synonym". Here the total **is** declared, **as a sum**, and the attack uses **no
scope word at all** — it defeats the structural rule head-on.

**Fix spec:** the membership test must be over **value/components**, not node identity. After
resolving, for a `rate` whose `num` is a `sum`/leaf of unit `U`, refuse any denominator `D` when a
`sum` node `S` of unit `U` exists whose resolved component-leaf set is a proper superset of `num`'s
component-leaf set and `S.value ≠ D.value` — i.e. `num`'s leaves ⊂ `S`'s leaves ⟹ the share must be
over `S`. Equivalently, precompute each node's transitive leaf set and compare sets rather than ids.
That closes RE-4 and subsumes the direct-member case the current rule already handles.

## (b) The GENERATION-QUALITY half — still UNPROVEN, not broken

Unchanged and re-affirmed: whether every figure a real narrative prints is routed through the
register end-to-end is **unproven-without-e2e** (needs a paid pipeline run). That is an open
measurement, distinct from RE-4, which is a deterministic hole in `resolveRegister` reachable with
a crafted register and no model.

## Verdict

**BROKEN.** Exact defeating input (test A15): a register with `F1 = sum[L1,L2] = 81000`,
`T1 = sum[L1,L2,L3] = 120000`, `G1 = 108000`, and `R1 = rate F1 / G1` labelled
`"frontline delivery share of cost"` with `asserted 0.75`. `resolveRegister` accepts `0.75` where
the honest share of the register's own declared total is `0.675`, because the structural rule tests
node-identity membership and `F1` is a sub-aggregate not directly listed in `T1.of`. The control
(total declared `sum[F1, L3]`) throws, isolating the defect to the membership test.

---

# RE-ATTACK #4 2026-08-28 — BROKEN (label-superset rule compares exact token sets)

RE-4 was fixed and merged (trunk `13537a8`). The `numInSum` structural rule was **removed** and
replaced by a label-superset ambiguity rule (`numeric_register.ts:291-318`): a denominator is
refused (`rate_denominator_ambiguous`) when another same-unit node's label **token-set** is a
proper superset of the denominator's with a different value — so `"cost"` is refused whenever
`"total project cost"` (a different value) is in the register, structuring-independent and with no
scope word. I re-ran `adv2_numeric_test.ts`: **A15 now passes** (both structurings refuse; I
updated A15's expected code to `rate_denominator_ambiguous`), and A9–A14 remain green.

Then my best final attempt on the mechanism. **Still BROKEN**, encoded as failing case **A16**.

## (a) The MECHANISM — BROKEN

### RE-5 — the token-set comparison is verbatim: a stop-word or a plural defeats it

**Where:** `numeric_register.ts:303-315`.

```ts
const denTok = new Set(norm(denNode?.label ?? "").split(" ").filter(Boolean));
…
const otherTok = new Set(norm(other.label).split(" ").filter(Boolean));
if (otherTok.size > denTok.size && [...denTok].every((t) => otherTok.has(t))) { throw … }
```

`norm()` only lowercases and collapses whitespace — it does **not** remove articles/stop-words or
stem. So the token sets contain every word verbatim, and the subset test is trivially defeated by
adding one meaningless token to the denominator's label. Since `numInSum` is gone, this label rule
is the **only** structural check, so evading it has no backstop.

**The exact defeating input (test A16), one stop-word from the caught case:**

```
L1 delivery staff = 50000   L2 sessional workers = 31000   L3 administration = 39000
F1 frontline delivery = sum[L1,L2]     = 81000
T1 total project cost = sum[L1,L2,L3]  = 120000
G1 "the cost"         = 108000          (the grant)
R1 "frontline delivery share of the cost" = rate F1 / G1, asserted 0.75
```

`denTok = {the, cost}`. The real total's `otherTok = {total, project, cost}`. `"the"` is not in
`otherTok`, so `denTok ⊄ otherTok`, the rule does not fire, and `resolveRegister` returns
`R1 = 81000/108000 = 0.75` — where the honest frontline share of the register's own total is
`81000/120000 = 0.675`. `"the cost"` is semantically identical to the bare `"cost"` the rule
**does** catch (the A16 sentinel, green): the only difference is the article. A **plural**
(`"costs"`) and a **possessive** (`"our cost"`) evade it identically, as does a token-disjoint
synonym (`"overall budget"`, `{overall, budget}` shares no token with `{total, project, cost}`).

This is not the acknowledged residual (undeclared-leaf total + unlisted scope synonym): the total
**is** declared as a sum, no scope word is used, and `"the cost"` is not a synonym — it is the same
word plus a stop-word. It is a normalisation gap in the ambiguity rule.

**Fix spec:** the ambiguity test needs semantic normalisation, and even then a lexical rule is the
wrong shape. Minimally: strip stop-words/articles and stem (singular/plural) before the set
comparison, so `{the, cost}`, `{costs}` and `{cost}` collapse to the same token. Durably: this is
exactly why a **value/structure** rule beats a label rule — reinstate the removed `numInSum` idea
but as **transitive leaf-set subsumption** (the earlier RE-4 fix spec): a share whose numerator's
leaf-set is a proper subset of a same-unit `sum` `S` must divide by `S`, whatever either label
says. The orchestrator rejected leaf-set subsumption because the donor's own "overhead over DIRECT
costs" rule has overhead's leaves ⊂ total — but that case is distinguished by the **numerator**:
there the numerator is `overhead` and the denominator `direct costs` is a *sibling partition*, not
a superset of overhead's leaves; the refusal should fire only when the numerator's leaf-set ⊂
`S`'s leaf-set **and** the denominator's leaf-set ⊉ the numerator's whole — i.e. divide-by-the-whole
is required only when a strictly-larger same-unit aggregate over the numerator exists. That closes
RE-5 without over-refusing the overhead ratio, and with no word list or stop-word table to maintain.

## (b) The GENERATION-QUALITY half — still UNPROVEN, not broken

Unchanged: whether every figure a real narrative prints is routed through the register end-to-end
is **unproven-without-e2e**. Open measurement, distinct from RE-5 (a deterministic hole reachable
with a crafted register and no model).

## Verdict

**BROKEN.** Exact defeating input (test A16): a register with `F1 = sum[L1,L2] = 81000`,
`T1 = sum[L1,L2,L3] = 120000`, `G1 = "the cost" = 108000`, and `R1 = rate F1 / G1` labelled
`"frontline delivery share of the cost"`, `asserted 0.75`. `resolveRegister` accepts `0.75`
(honest share of the register's own total is `0.675`) because `{the, cost}` is not an exact
token-subset of `{total, project, cost}`. The bare-`"cost"` sentinel throws, so the boundary
between caught and missed is a single stop-word.

---

# RE-ATTACK #5 2026-08-28 — BROKEN (a proper sub-sum denominator, total declared as a sum)

RE-5 was fixed and merged (trunk `5a04a60`) with my own durable spec: a word-list-free **leaf-set**
rule (`numeric_register.ts:302-341`). If the numerator is a proper part of a same-unit `sum` `S`
and the denominator's leaves fall **outside** `S`, refuse (`rate_denominator_not_whole`); labels are
not compared, so `"the cost"`, `"costs"`, and synonyms are all caught by leaves. I re-ran
`adv2_numeric_test.ts`: **A15 and A16 are now GREEN** (I updated their expected code to
`rate_denominator_not_whole`, the code the leaf-set rule throws), and A9–A14 remain green.

`reports/adversarial/residual-boundary.md` concedes only the case where the true whole is a bare
**leaf**, and argues: *"a closed budget declares its total as a SUM (so the leaf-set rule fires)."*
I attacked exactly that sentence. **A total declared as a sum is not sufficient** — the leaf-set
rule still misses a wrong denominator, so this is a new class under the orchestrator's own
criterion (b), not the documented boundary.

## (a) The MECHANISM — BROKEN

### RE-6 — the `denWithinS` escape admits a proper SUB-SUM labelled as the whole

**Where:** `numeric_register.ts:326-341` — the leaf-set loop and its `denWithinS` escape.

```ts
const denWithinS = denLeaves.size > 0 && [...denLeaves].every((l) => sLeaves.has(l));
const denEqualsS  = done.get(s.id)?.value === den.value;
if (denWithinS || denEqualsS) continue; // den is S or a sibling part of it — legitimate
```

The escape is correct for a genuine part/part ratio (the donor's "overhead over **direct costs**":
direct costs is a sibling part of the total). But it fires on **any** denominator whose leaves are
inside `S` — including a proper sub-sum that is **labelled as the whole**. And nothing else covers
that: the symmetric scope walk only inspects scope words in the **rate** label adjacent to the
denominator run, never a totalizing word inside the **denominator's own** label; and the
label-superset backstop only fires on a token-subset, which a sub-sum's total-ish label is not.

**The exact defeating input (test A17), total is a declared SUM:**

```
L1 delivery staff = 40000   L2 sessional = 41000   L3 management = 27000   L4 capital = 12000
F1 frontline delivery = sum[L1,L2]        = 81000    (a proper part of the total)
T1 total project cost = sum[L1,L2,L3,L4]  = 120000   (a DECLARED SUM)
D1 "the whole budget" = sum[L1,L2,L3]     = 108000   (a proper SUB-SUM; leaves ⊆ T1)
R1 "frontline share of the whole budget" = rate F1 / D1, asserted 0.75
```

For `S = T1`: `F1`'s leaves `{L1,L2} ⊂ {L1,L2,L3,L4}` so `numProperPart` is true; but `D1`'s leaves
`{L1,L2,L3} ⊆ {L1,L2,L3,L4}` so `denWithinS` is true → the rule treats `D1` as a legitimate sibling
part and does not fire. `resolveRegister` returns `R1 = 81000/108000 = 0.75`, where `F1`'s honest
share of the register's own declared total is `81000/120000 = 0.675`. `D1` is labelled **"the whole
budget"** yet provably **excludes** a line the register's own total includes (`L4` capital, 12000) —
"the whole" is a proper part. The literal word **`"total"`** works identically (`"the total
budget"`, A17 corroboration). The **sentinel** (A17, green) puts the same misleading label on a
denominator *outside* the total and it IS caught — isolating the defect precisely to the
`denWithinS` sub-sum escape.

This is the exact §5 "over 75% to frontline" defect: a budget with a natural subtotal
(`"the whole/overall/total delivery budget"`, `108k`) used as the `%`-to-frontline denominator while
the real project total (`120k`) sits in the register as a sum. Subtotals bearing "total"/"overall"
are ordinary model output, so this is reachable, not a self-inflicted shape.

**Fix spec:** `denWithinS` should not blanket-allow. A denominator that is a **proper** sub-sum of
`S` (its leaves a strict subset of `S`'s, `den.value ≠ S.value`) is a legitimate ratio base **only
if its label does not claim the whole**. Two options: (1) when `denLeaves ⊊ sLeaves` and
`den.value ≠ S.value`, require the denominator's label to be free of totalizing tokens
(`total/whole/overall/entire/…`) — refuse `"the whole budget"` on a sub-sum; or, cleaner and
word-list-free, (2) restrict the escape to the genuine part/part case by also requiring the
**numerator and denominator leaf-sets to be disjoint** (overhead ∩ direct-costs = ∅), since a real
"part A as a share of sibling part B" has no shared leaves — here `F1`'s leaves `{L1,L2} ⊂ D1`'s
`{L1,L2,L3}`, i.e. the numerator is *inside* the denominator, which is not a sibling ratio at all
but a part-of-a-larger-part masquerading as a share of the whole. Option (2) closes RE-6 without a
word list and still admits overhead/direct-costs.

## (b) The GENERATION-QUALITY half — still UNPROVEN, not broken

Unchanged: whether every prose figure routes through the register end-to-end is
**unproven-without-e2e**. Distinct from RE-6, a deterministic hole reachable with a crafted
register and no model.

## Verdict

**BROKEN**, and specifically outside the documented boundary: the true whole `T1` is a **declared
sum** (120000), not a bare leaf. Exact input (test A17): `F1 = sum[L1,L2] = 81000`,
`T1 = sum[L1,L2,L3,L4] = 120000`, `D1 = sum[L1,L2,L3] = 108000` labelled `"the whole budget"`,
`R1 = rate F1 / D1` asserted `0.75`. `resolveRegister` accepts `0.75` (honest `0.675`) because the
`denWithinS` escape treats the proper sub-sum `D1` as a legitimate sibling part, and no check
questions a totalizing word in `D1`'s own label. The residual-boundary claim that a sum-declared
total makes the leaf-set rule fire does not hold when the wrong denominator is itself a sub-sum.
