# Adversarial round — invariants 7 and 9 (verified directly by the orchestrator)

These two are structural properties, not attackable input-surfaces like the gates, so they are
audited by direct inspection of the shipped code and the live local DB rather than by a
separate attacker agent. Both verifications are executed, not asserted.

## Invariant 7 — no human in the customer workflow. HELD.

The attack would be: find a code path where a paid order's progress waits on a human decision.

- **No human-gate exists in the state machine.** `orders.status ∈ {paid, processing, complete,
  attention, refunded}`; `order_proposals.status ∈ {queued, processing, complete, attention,
  failed}`; `job_stages.status ∈ {pending, running, done, failed, held}`. None is a
  "awaiting_review / needs_human / manual_approve" state. `attention` is the OPERATOR-ALERT
  terminal state (INFRA_HOLD / terminal failure), which the gauntlet explicitly permits:
  "Operator alerting is not review and is required." An order in `attention` is not paused
  waiting for a human to advance it — it has stopped and alerted.
- **No flag-for-review path in the worker.** `grep -niE
  "flag_for_review|human_review|manual_review|awaiting_review|needs_human|hold_for_review"`
  over worker/index.ts returns nothing. Every "reviewer" string in the file is the MODEL
  playing a funder's-reviewer role in the validate/check stages (e.g. "we assessed it the way a
  funder's reviewer would"), never a person.
- The delivery gate's only outcomes are pass and hold; the hold goes to regeneration then
  refund+notify, never to a human queue.

Residual: none in the customer workflow. Operator alerting (escalations, `attention`) is
present and required, and is not review.

## Invariant 9 — all of it observable in the append-only events table. HELD.

- **Immutability trigger intact and enforced on the live schema.** `events_immutable` BEFORE
  UPDATE OR DELETE is present; a real `UPDATE public.events` on the current DB raises (ERROR),
  as does DELETE (both re-confirmed this session).
- **Real events recorded by the benchmark run** (not a claim — queried from the live DB):
  `claim_held ×4`, `claim_confirmed ×4`, `crawl_outcome ×4` (invariant 6 + the crawl taxonomy),
  `notify_customer ×2`, `notify_operator ×2` (invariant 8, both classes firing),
  `analyze_limit_reconciled ×1` (compliance).
- **Per-stage cost is observable**, off the old module-level global and onto per-stage figures
  from OpenRouter's own usage field: `job_stages.output.usage.usd` per stage per order sums to
  **$5.5580** across the benchmark — the exact figure the benchmark report captured (analyze
  0.27103, org 0.30623, strategy 0.53776, …). Cross-stage contamination is impossible (each
  runStage owns a fresh sink; proven by tests/adversarial/cost_accounting_test.ts).
- **Gate outcomes and hold codes** land in `delivery_gate_verdicts` (0 rows so far — correct:
  no benchmark order reached `package`; KT-10001 held at `validate`) and, when reached, in
  events under distinct actions per the hold class. Scores are carried in the verdict record's
  `critics` jsonb.
- Drift is to be monitored on delivered output, not validators — the launch benchmark's every
  failing proposal passed every internal validator, which is why the blind gate (invariant 1)
  and this event trail, not the validators, are the observability of record.

Residual: gate-verdict and refund events are exercised by construction and by the delivery-gate
tests, but no live order reached the gate in this run (all held earlier or driven only to
strategy). The FIRST-ORDERS section of launch-readiness.md flags watching the first real
gate decisions.
