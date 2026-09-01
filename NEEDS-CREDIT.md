# NEEDS-CREDIT — the re-run stopped at the $3 model-spend floor

**Date:** 2026-09-01 · **Balance: $1.30** (below the $3 floor) · **Phase 8, Task 3 (re-run to delivery)**

Per the autonomy rules, model work is STOPPED and this file records what remains and its cost.
Everything non-model continues (the reports below are finished). Nothing touched production.

## What stopped it — honestly

Two things compounded, and the first is a process failure I own:

1. **Budget management.** The $6 re-run line assumed ~$1.5/order. The DESIGN stage is one
   high-effort model call that exceeds the local edge-runtime invocation window (see #2), so it
   was reaped and **retried repeatedly**, each retry an expensive opus-5 (then sonnet-5)
   high-effort call, plus a full org re-run ($0.70) each time the order was reset. I checked the
   balance too infrequently during the retry loop and it fell from ~$10.05 to $1.30 — past the
   $6 line and through the $3 floor — before I caught it. That is on me, not the rules.

2. **The design stage is a monolithic high-effort call that does not fit the local runtime.**
   This is launch-readiness **P0.3** ("design/validate are monolithic multi-call stages exceeding
   the local single-invocation window with no resume; unproven on deployed runtime"), now
   demonstrated concretely: the design opus-5 call runs longer than the local edge runtime holds
   a request, the invocation dies mid-call, the heartbeat stops, and the reaper marks "[timeout]"
   and retries into the same wall. A faster strategy model (sonnet-5, set locally) and a
   heartbeat-during-call fix both helped but did not clear it.

## What was achieved before the floor (all merged, non-model, on trunk)

- **Task 1 — the intake spec** (reports/phase8-intake.md §1): the exact mandatory facts KT-10001's
  grounding check found missing, in check order.
- **Task 2 — the intake redesign** (merged, critic-passed by re-execution): the data-starvation
  fix is real and proven — the worker now folds the structured evidence-interview answers into the
  Evidence Ledger (E-INTAKE-4+), and `properNounAudit` drops **9 unsourced → 0** on a mapped
  ledger (the KT-10001 starvation, closed). Sufficiency reconciled to invariant 2 (hard bar =
  fulfillability: registration + org-fact floor; income/safeguarding reported, not blocking).
  Extra-links crawl, wizard, migration + fingerprint all landed.
- **Task 3 research** — the four applicants' real public-materials intake, every fact cited to a
  fetched source, nothing invented, all four charity numbers independently verified (Sufra 1151911,
  Nourish 1154716, Glass Door 1083203, Magpie 1176267).
- **Three real bugs the re-run surfaced, fixed on trunk:** (a) analyze crashed inserting the
  model's free-text grant deadline into a DATE column — `coerceGrantDeadline()` (fdeadd8); (b) a
  blocking model call heartbeated only at its start, so a slow reasoning call outran the reaper —
  now beats every 20s in flight (a9f027d); (c) the `functions serve` restart infra workaround.
- **Sufra (KT-10001) reached analyze → org → voice → strategy WITH the real intake ledger** — i.e.
  the expanded intake path works end-to-end through the crawl, the ledger build, and the composer.
  It stalled at DESIGN (the P0.3 stage), never reaching the delivery gate.

## The deliverable state, plainly

- **delivery_gate_verdicts rows: 0.** No order reached the delivery gate, because none cleared the
  design stage locally. The intake expansion is NOT the blocker — grounding was never reached to
  be tested end-to-end (the properNounAudit unit proof is the evidence it would pass).

## What it costs to finish

To produce the four real delivery-gate verdicts the deliverable asks for, in priority order:

1. **Credit:** ~**$8–12** of OpenRouter balance (4 Draft orders × ~$2–3 each to reach the gate,
   with headroom for the design/validate retries the current local runtime forces). A monthly key
   cap set deliberately (already OPERATOR item #3) covers this.
2. **The design-stage P0.3 fix (engineering, $0 model):** make design resumable / fit the
   invocation window — either a real streaming client for `llmRaw` so a long call keeps its
   connection and heartbeat, or splitting the design call, or (deployed) confirming the platform's
   invocation limit holds an opus-5 high-effort call. Until then, drive orders with a faster
   strategy model (Vault `openrouter_model_strategy`) which fits the window at some quality cost.
3. Then: re-run Sufra + Nourish + Glass Door + Magpie through the merged intake path to the gate,
   record per order {ledger size, sufficiency score, gate pass/hold, hold reason, cost}, and if
   fewer than two pass, state what each would still need (Magpie already needs a non-public income
   figure; all four need the internal admin self-certs — safeguarding lead, insurance, bank).

The intake expansion — the subject of this phase — is done and proven. The end-to-end gate
demonstration needs credit and the P0.3 design-stage fix, both recorded here and in
reports/phase8-intake.md.
