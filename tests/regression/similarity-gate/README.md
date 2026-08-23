# Regression fixture — similarity gate, 26-word shared run

`fixture.json` preserves the only live example the project had of the similarity gate
firing. It was captured from production order **KT-10005** (`test-orgb`) before that
synthetic order was deleted on 2026-08-23. Nothing from the original order is needed to
use it.

## Why this case is worth keeping

It is the concrete instance behind launch-readiness **P1 #7**. The gate did its job here —
it caught a revision drifting onto another applicant's territory on the same grant — but the
outcome is a customer-visible dead end: the order parks in `attention` and the `package` and
`deliver` stages never run. Any future change to the gate, the rewrite budget, or the
exclusivity comparison needs to keep this behaviour honest in both directions.

## The mechanism

`supabase/functions/worker/index.ts:1751`

```
if (worst > 25) throw new Error(`similarity gate: shared run of ${worst} words after ${rewrites} automated rewrites`)
```

Lines 1917–1919 then classify any message containing `similarity gate` as terminal and set
the stage to **`held`**, not `failed`. That matters: `claim_next_stage()` only advances past
a predecessor whose status is `done`, so `held` parks the chain for a human instead of
burning retry budget.

## Both directions are covered

- `baseline_pass` — the first check on the original narrative, which **passed** with a
  longest shared run of 16 against a cap of 25, after excluding 10 donor-mandated lines.
  Use it as the negative control: the gate must not fire here.
- `expected` — the failing revision: 26 words, 2 automated rewrites, `held`, order
  `attention`.

The interesting edge is that 25 passes and 26 fails; the comparison is strictly
greater-than. Both sides of that boundary are asserted in `regression_assertions`.

## What is deliberately not here

The colliding narrative concerned a **real, identifiable NGO** and is not reproduced. Only
the abstract strategy descriptors are kept — problem frame, intervention type, delivery
method, beneficiary, geography, signature mechanic — which is exactly what the exclusivity
architecture is designed to compare on, and what `claims.strategy` is documented to hold
("contains no customer prose").

To re-run the test, seed drift with any second applicant on the same grant whose narrative
shares a verbatim run of more than 25 words. The grant and applicant in this fixture are
both synthetic.

No secrets, service-role keys, or real customer content are present.
