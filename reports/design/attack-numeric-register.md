# ADVERSARIAL — invariant 4, "every number derived once through `resolveRegister()`"

**Date:** 2026-08-27 · **Target:** `supabase/functions/worker/numeric_register.ts` (232 lines)
**Verdict: BROKEN.** Ten distinct classes of number that do not close were built as concrete
inputs and **run through the real function**, which accepted every one. An eleventh was found by a
control case that was supposed to pass and did not.

No model was called. Nothing here is an opinion about what the code would do; every line below is
an observed result. Scripts: `attack.ts`, `attack2.ts`, `attack3.ts` in this directory.

---

## 0. First, the finding that dwarfs the rest

The task named one attack to press hardest: *a number that never enters the register at all because
the section wrote it directly.* Measured against the tree:

```
occurrences of "resolveRegister"      in worker/index.ts: 0
occurrences of "numeric_register"     in worker/index.ts: 0
occurrences of "registerConformance"  in worker/index.ts: 0
occurrences of "numbersIn("           in worker/index.ts: 0
worker/index.ts still calls consistencyFindings: 2 time(s)
numbersNear (documented dead code):              3 occurrence(s)
```

`numeric_register.ts` is imported by exactly one file in the repository: its own unit test. It
exports no function that can read a document — no signature in it takes prose. The path from a
generated section to a register figure does not exist in either direction.

So today, **the number that never enters the register is every number.** A clean register resolving
`N1=120 N2=60 N3=180` sits beside a narrative reading *"...reach 180 young people, building on the
4,200 contacts our outreach team made last year and a 92% retention rate, delivering 1,560 sessions
at a unit cost of £38"* — 5 of the 6 figures in that sentence appear nowhere in the register, and
nothing in the committed system compares the two.

This is consistent with `reports/quality-iteration-1.md` §7 item 3, which lists landing the register
as work not yet done, so it is not a surprise. It is stated first because **every finding below is
latent until the wiring lands, and every finding below would still be open the day it does.** That
is the value of attacking the module now.

The rest of this report is about the module itself, judged as if it were already wired.

---

## 1. The closure check is opt-in — chosen by the model it exists to police

`numeric_register.ts:170` — `if (n.asserted !== undefined)`. `asserted` is optional on derived
nodes (`:39`, `:114`), so a `sum` that does not state a total is never contradicted by anything.

`tests/numeric-register/numeric_register_test.ts:23-34` is the delivered 200-vs-216 defect, and it
throws `closure_mismatch`. **Delete the one field the generator itself supplies and the identical
register resolves silently**, holding 216 while the design's own headline was 200:

```
BREAK  B1b the SAME register with `asserted` simply omitted
   ACCEPTED
```

The module's headline claim — *"a model's asserted total is checked against the recomputation rather
than believed"* (`:18`) — holds only for models that volunteer to be checked.

**Honest limit on this one.** If prose then used the register's 216, no harm is done. The damage
requires the prose binding to be missing, which it is (§0). It is defence in depth, not the root.
It is still the cheapest single line in the file to fix.

## 2. `opts.frozen` is declared and never read

`:84` accepts `opts: { frozen?: Map<string, Resolved> } = {}`. The identifier `opts` appears
**once in the file** — in that signature. `reports/design/design-integrity.md:352-361` specifies
section 5, `register_shrank` / `register_revised`; it was not carried into the committed module.

`gen:budget` is specified (`design-integrity.md:502`) to pass `{ frozen }` on the explicit contract
that *"the register is created once and may only grow"*. Run against the real function:

```
   design register: B9 = 60000
BREAK  A1  revise a frozen node's value and re-resolve with { frozen }   ACCEPTED
   >>> B1 was 12000, is now 30000; B9 was 60000, is now 78000
BREAK  A1b drop B9 entirely and re-resolve with { frozen }               ACCEPTED
   >>> the total the design closed on is simply gone; no error
```

A silent no-op is worse than an absent check: the caller has done everything the contract asks and
believes the design figure is pinned.

## 3. An arbitrary six-figure total walks in through the money door

`admissible` (iii) at `:219` is the anti-arbitrary-target rule, and it is gated on
`r.unit_kind === "count"`. Rule (iv) at `:227` states the reason money is exempt: *"Money leaves are
unit costs and are explicitly planning estimates."* Nothing tests that a money leaf is a unit cost.

```
BREAK  A2  £247,500 'total project cost', leaf, basis=estimate, never decomposed   ACCEPTED
   >>> sigFigs(247500) = 4 — rule (iii) would have rejected the same number as a count
held   A2b the same figure declared as a COUNT leaf (control)  → pseudo_precision
```

The budget envelope is read as `refValue(project, "budget_envelope", register)`
(`design-integrity.md:452`) with no requirement that it be derived. At Draft tier — a paid tier —
there is no `gen:budget` stage to decompose it. A £247,500 headline with basis `"our costing for the
period"` is a register-blessed figure.

## 4. `unit_kind` is self-declared, and every rule in the file is keyed on it

`unit` and `unit_kind` are never cross-checked. One word changes which rules apply:

```
held   B2a 1,247 'people' as a count leaf, basis estimate      → pseudo_precision
BREAK  B2b the SAME figure with unit_kind flipped to 'ratio'   ACCEPTED
BREAK  B2c 120.6 'people' declared unit_kind 'ratio'           ACCEPTED
BREAK  A5  a USD cost declared unit_kind 'count' in a GBP proposal (sum closes at 100) ACCEPTED
```

`currency_mismatch` (`:101`), `pseudo_precision` (`:219`), `nonpositive_cost` (`:229`),
`product_multiplier` (`:155`) and the rounding granularity of `snap()` (`:61`) are **all** gated on
this field. It is one opt-out switch for five gates, and the entity that sets it is the generator.

## 5. Provenance: the evidence check never opens the item it names

`admissible` (i) at `:203` is `evidenceNums.has(Math.round(r.value))` — set membership over every
integer in **every** ledger item pooled together, with the value rounded first. `basis.detail` is
matched against a regex (`:200`) and then never used again.

A real ledger for this product is identity-only (`worker/index.ts:1298-1301`: name, registration
number, website). Built from one:

```
   evidenceNums = 1, 1998, 1145123
BREAK  C2c '1,145,123 young people supported since 2010', basis evidence E-INTAKE-1   ACCEPTED
   >>> that is the CHARITY REGISTRATION NUMBER, from E-INTAKE-2, re-served as a service
       statistic, cited to E-INTAKE-1, at 7 significant figures
BREAK  B3  value 1250 cited to 'E-INTAKE-1' when 1250 lives in E-WEB-3                ACCEPTED
BREAK  B3b basis 'E-PROP-999', a ledger item that does not exist                      ACCEPTED
```

Note that `evidence` basis also skips rule (iii) entirely (`:220` tests only `estimate|capacity`),
so this is simultaneously the pseudo-precision bypass: 7 significant figures, admitted.

And the check is **dimensionless** — it rounds the node's value to an integer before looking it up:

```
BREAK  C2a '77% of leavers sustain employment' as a ratio, basis evidence E-WEB-2   ACCEPTED
   >>> Math.round(0.77) = 1, and 1 is in the pool because the Trust "runs 1 centre"
held   C2b the same claim at 0.42  → evidence_basis_unverified
```

For any ratio the answer is decided by whether a stray `1` appears anywhere in the ledger, and never
by the evidence. Both outcomes are wrong. **This is invariant 3 as much as invariant 4: the module
attaches a real ledger id to a number that item does not carry, which is manufacturing provenance.**

**Related, not tested here:** `donorNums` is specified as `numbersIn(JSON.stringify(analysis))`
(`design-integrity.md:447`), and `analysis` is entirely model output — `jsonOf(await llm(...))` at
`index.ts:1253`. So a "donor" basis is verified against the analyze stage's own prose. The donor's
real text is on hand at `grants.guidelines_text` (`index.ts:1279`) and is the set that should be
used. Flagged, not exploited — the exploit needs a model call and the key is capped.

## 6. A rate whose denominator is not the quantity its label names

The `rate` branch (`:158-163`) performs **no unit checking of any kind**: not on `n.unit`, not on
`n.unit_kind`, not on either member. `label` is only length-checked (`:96`).

`quality-iteration-1.md` §5 records `critic_a` finding, unprompted, an *"over 75% to frontline
delivery"* claim recomputing to 61.9–69.0%. The register reproduces it exactly:

```
BREAK  B4  'share of TOTAL PROJECT COST reaching frontline delivery', of: [B1 frontline, B2 grant]
   ACCEPTED
   >>> R1 closes at 0.75 — "over 75% to frontline delivery"
   >>> against the total its own label names (B1/B4) it is 0.6750 = 67.5%
BREAK  A4b GBP divided by people, unit "%", unit_kind "ratio", asserted 750   ACCEPTED
```

Every figure in that register is honest, every total closes, and the sentence the register licenses
is false. This is the defect class the module was built to make impossible, surviving in the one
node kind that has no validation at all.

## 7. Rounding: the register rejects the correct total and blesses the wrong one

`snap()` (`:61`) rounds money to the whole unit, and it is applied **per node**, leaves included.

```
BREAK  A6b 3 x £1,000.50 asserted as £3,003     ACCEPTED  (each leaf snaps to 1001)
held   A6c the same register asserting £3,002   → closure_mismatch
   >>> true total £3,001.50. The wrong total closes; the right one is refused.
```

This was confirmed a second time by a control case that was meant to pass and did not — a
**legitimate** budget line:

```
   control rejected: closure_mismatch [B2]: you stated 4560 GBP for "sessional delivery budget",
   but its components come to 4608: B1 x N1 = 48 x 96
```

£47.50 x 96 sessions is £4,560. The register snaps the unit cost to £48, computes £4,608, and
refuses the correct figure. A grant budget cannot carry pence.

On counts, `snap` to the integer gives every node up to 0.5 of slack, and a derivation whose exact
value is fractional is silently made whole:

```
BREAK  C1  280 places x 0.77 attendance, asserted 216   ACCEPTED
   >>> resolves to 216; derivation carried into prose is "N2 x N1 = 280 x 0.77" = 215.6
   >>> 216 closes. 215 also closes. Neither is a number of people.
```

## 8. Two nodes, one meaning, two values

```
BREAK  B6 'total beneficiaries' declared twice — a sum of 120 and a leaf of 150   ACCEPTED
```

`label` is documented at `:33` as *"the phrase the figure is written as in prose"*. Two figures may
own the same phrase, which is precisely what "one structured source of truth" is meant to forbid,
and it also lets a model defeat any label-based rule by renaming.

## 9. One I could not break deterministically

**A unit that is a lie.** `sum` compares `unit` as a **string** (`:145`), so declaring households
and young people both as `"beneficiaries"` makes them commensurable and 90 + 120 = 210 closes —
`quality-iteration-1.md` §5's "households added to persons", intact:

```
BREAK  C3 households and people added together, both relabelled 'beneficiaries'   ACCEPTED
```

I am reporting this as a real acceptance but **not** claiming a deterministic fix. Distinguishing a
household from a person requires a unit ontology this product does not have, and a closed unit
vocabulary would reject legitimate units on real proposals. The patch narrows the door (a unit that
looks like a currency or a duration must declare itself as one) and leaves this open. Naming it as
unsolved is more useful than a rule that would fail on live orders.

**Attacks that held.** Cycles, dangling references, self-reference, `leaf_has_of`,
`derived_has_value`, `sum_arity`, `binary_arity`, `product_unit` (exactly one member in the result
unit), `divide_by_zero`, `register_too_large`, `empty_basis`, and `pseudo_precision` on any honestly
declared count. The structural half of this module is sound. What fails is everything that depends
on a field the generator chooses, and everything the module declines to look at.

---

## Fix, and the test that would have caught it

- **Failing test:** `/home/user/ktebli/tests/adversarial/register_does_not_close_test.ts`.
  Against the committed module: **17 failures, exit 1** (verified). Against the patched module:
  **all pass, exit 0** (verified).
- **Patch spec:** `patch-numeric-register-closure.md` in this directory, with a verified patched
  copy (`numeric_register.patched.ts`) and a unified diff (`numeric_register.patch.diff`).
  `deno check` clean. The committed suite `tests/numeric-register/numeric_register_test.ts` stays
  green after a 4-line companion edit, which the spec lists.
- Ten new refusals, no new escape hatch, no flag. The only relaxation is that money stops being
  rounded to the whole unit — which today rejects correct budgets.

**What the patch does not do.** It does not wire the register into `index.ts`, and it does not bind
prose to the register. Until `registerConformance` lands (`design-integrity.md` §A.7, §A.9),
invariant 4 remains unenforced end to end no matter how sound this module becomes. Two holes in that
design, visible from what this attack found, are recorded at the end of the patch spec — chiefly
`resolvesAsRatio`, which whitelists any percentage matching **any ordered pair** in the register
(n(n-1) candidates) and is §6 of this report promoted to an escape hatch.

## Measurements not obtained

- **No model was called and none should be inferred.** The OpenRouter key returns 403; every
  finding here is deterministic code execution.
- **No live pipeline run.** All inputs are hand-built register objects. Whether a real generator
  emits these shapes is **MISSING** and cannot be measured this session.
- **The `donorNums`-from-model-output hole (§5) is reasoned from the code, not exploited.** It
  needs an `analyze` output to be concrete. Marked unexploited, not marked clean.
