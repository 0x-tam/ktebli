# Adversarial finding — invariant 2 (sufficiency/pre-payment): CONCEDED (held)

Attacker worktree: agent-a85a4c4e298967e03, commit 6d2379d (adv2_sufficiency_test.ts guard +
CONCEDED report). Could not break it; proved the two round-1-UNPROVEN protections by live
execution, not assertion:

- **Two webhooks racing ONE token**: consume_checkout_token locks SELECT…FOR UPDATE before its
  single-use guard. Controlled contention → session B blocked on A's row lock, re-evaluated under
  READ COMMITTED, saw checkout_token_used_at set, refused token_already_used. 25× simultaneous
  fire → 0 double/zero-win, exactly one checkout_consumed per token. Two funded orders cannot
  come from one clearance; the loser parks.
- **Forge/clear-then-edit**: pre_intakes has RLS enabled + REVOKE ALL from anon/authenticated +
  ZERO policies; as both public roles, INSERT/SELECT/UPDATE on pre_intakes and EXECUTE on
  consume_checkout_token all returned permission denied. Clearance columns are written only by
  save-intake from a server-computed verdict (single mint site, gated on verdict.cleared).
- Also refused: tier mismatch (check + tier-in-fingerprint + price gate), expired (6h interval),
  "A's clearance pays for B" (token→one-row uniqueness makes it inexpressible), single order-
  creation site (stripe-webhook:226) gated on funded = priceOk && emailOk && clearanceOk.
- Recorded residual (unreachable behind the RLS wall): the fingerprint binds the grant by LENGTH
  not text. Forward guard: never grant the public roles anything on pre_intakes.
- Bonus invariant-9 confirmation: the attacker's own events cleanup DELETE was blocked by
  "events is append-only" — the trail resists tampering.

Status: HELD. adv2_sufficiency_test.ts is a keeper regression (passes) — merge with the round.
