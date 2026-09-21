# NEEDS-CREDIT — RESOLVED (credit added 2026-09-01), superseded by the re-run outcome

This file recorded the stop at the $3 model floor during the first phase-8 re-run attempt.
**Credit was subsequently added and the re-run completed.** See reports/phase8-intake.md §3–4
for the full outcome and reports/launch-readiness.md for the updated recommendation.

## What the re-run achieved

KT-10001 (Sufra) ran the **entire** chain to the delivery gate — the first real order ever to do
so. Getting there required fixing **nine** distinct defects, none of which had surfaced before
because no real order had ever cleared the design stage (all committed on trunk; see the table in
reports/phase8-intake.md §3):

1. design `effort:high` output runaway (never closed the JSON) → effort low + size cap + one-shot
2. numeric-register **hardcoded USD** base rejecting a valid GBP design (`currency_mismatch`, P2 #10)
3. numeric register hard-failing on unit/arity pedantry → block only on false/fabricated numbers
4. `analyze` extracting applicant-**process** instructions as blocking narrative requirements
5. `validate` not resumable → exceeded the invocation window, orphaned, restarted from scratch
6. "validation unresolved" retrying from scratch instead of holding terminally
7. correction loop **plateauing** (full regeneration reintroduced claims) → surgical correction
8. `contactAudit` reporting a **grounded** address as fabricated (venue/location labels unknown)
9. occasional malformed model JSON → tolerant `jsonOf`

## Outcome

- **2 real `delivery_gate_verdicts` rows** (hold/preflight_failed D4, then hold/bar_not_cleared).
- Order **refunded** — the QUALITY_HOLD path fired end-to-end.
- The gate's own judge called the proposal *"exceptionally grounded and specific"*; it held only
  on **Donor fit (3/4)** — a food charity applying to a homelessness grant (a real mismatch).
- **Spend:** ~$34 of a $50 top-up (nine-fix debugging + resumable multi-round validate on a real
  order). This overran every planned budget line and is owned as a process failure — see RUNLOG.

## What remains (no longer "needs credit" — needs work + a modest run)

- Close the **generic-vs-specific generation tension** (§4): generation that draws densely on the
  grounded ledger without over-claiming beyond it, so a well-matched applicant clears the gate.
- Run the other three applicants — intake researched and ready in stack/out/phase8-research/.
  **Glass Door (homelessness charity) is the best donor-fit match and the obvious next run.**
  ~$10–14 of credit each on the current pipeline.
