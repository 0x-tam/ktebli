# Wave 2 plan (executes after WS3 merges; state on disk per autonomy rule 3)

Precondition: WS3 (gate wiring) merged; WS4a audit + WS5 crawls merged or their fix-specs
for worker/index.ts collected.

Sub-streams (worktrees, disjoint ownership, critic each):

- **ws6-core** owns worker/index.ts (+ tests/adversarial additions it needs):
  1. Apply WS4a's and WS5's index.ts fix-specs (parser silent-passes, crawler wiring).
  2. Failure email: QUALITY_HOLD notifies customer; INFRA_HOLD notifies operator only and
     never implies the proposal failed; terminal failures notify both; all tested against
     the Resend stub (sendEmail returns false without a key — assert the attempt + the
     escalation row). Draft both wordings as shipping defaults: short plain sentences, no
     em dashes; mark DRAFT for operator edit.
  3. Strategy-retry strand: retry at or before strategy releases the held claim
     (release_claim exists, granted, called by nothing per launch report); prove with a
     forced retry against the local stack.
  4. Crawler outcomes wired into the sufficiency gate (uses WS5's taxonomy + WS3's
     sufficiency state).
  5. Per-stage cost accounting off the module global onto usage fields per stage per order.
  6. Resumable section-by-section generation for Competitive/Full: correct by construction,
     marked unproven-on-deployed-runtime.
  Report: reports/phase6-eng.md (engineering half).
- **ws6-bench** (after ws6-core merges; owns tests/benchmark/ + stack/out/phase6/ +
  benchmark section of reports/phase6-eng.md): one real order end-to-end on the local
  stack (phase 4's e2e: real crawl, real generation, real render via WS4a's local
  render-service, inside every limit, no truncation; fix-and-rerun loop recording every
  failure), then the mini-benchmark: WS5's six crawled ledgers as Draft orders through
  the full pipeline, gated by the wired judge. Scores, holds, spend per order from usage
  fields. Budget: e2e + benchmark ≤ $8 total (autonomy rule 5); over 50% overrun →
  degrade scope (fewer cases), never stop.
  Appends e2e section to reports/phase4-compliance.md.

Wave 3: adversarial round — one attacker agent per invariant (reports/adversarial/),
fix + re-attack until written concession. Then phase 7 handoff page.

Budget note at wave-1 spawn: balance $24.12; lines: gate validation ≤$3 (ws3),
e2e+benchmark ≤$8 (wave 2), reserve the rest. Floor $3.00 absolute.
