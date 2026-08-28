# Adversarial finding — invariant 6 (exclusivity): BROKEN — nominal, not real, uniqueness

Attacker worktree: agent-a13f68e8874955642, commit b4362d0 (adv2_exclusivity_test.ts fails while
broken / CANNOT VERIFY on drift + report). $0. On the freshly-rewired composer (bfa6b4a).

**The break:** composeDraw (index.ts:1532-1548) hashes 11 axes into the fingerprint, but only 2
reach the writer — the strategy stage forwards only template_style(spine) and
opening_style(opening_move) (index.ts:2065-2066), and the sole style carrier into any prompt is
styleNote (index.ts:2130). The other 9 hashed axes (paragraph_regime, stance,
evidence_integration, argument_carrier, closing_move, tabular_policy + the integer grids
move_order/cadence_mu/weight_profile) appear in NO generation prompt (grep-confirmed). So distinct
fingerprints are cheap (everyone served, nobody waits — that half HOLDS), but the reader-visible
style space is a FINITE POOL of |spine|×|opening_move| = 13×14 = 182.

**Proof ($0):** module — shipped composeDraw + real vocabulary, N=1000 on one grant → 1000
distinct fingerprints but only 181 distinct reader-visible styles (819 reuse another's entire
visible style); first birthday collision ~N=17, pigeonhole certain past 182. E2E — claim_approach()
on replayed PG17, two distinct orgs on one grant BOTH granted, both spine=cost_of_inaction /
opening_move=cost_of_delay (byte-identical visible style), fingerprints differing only in mute
axes; claims_fingerprint_lock blocks neither.

**Why tests missed it:** ceiling_test.sql + composer_reservation_test assert only FINGERPRINT
distinctness; the latter literally treats "different integer grid → different canonical form" as
proof of width, never asking if the variation is VISIBLE. §11 measured 4 applicants, below 182.

**FIX (F1+F2):** feed the WHOLE composition to the writer (all axes become style instructions in
styleNote/the generation prompt), and hash only dimensions the reader can perceive. This ALSO
closes launch P0 #1's house-register complaint — the register/closing/cadence axes the migration
added to cure "reads machine-generated" are exactly the currently-inert mute ones.

Conceded (held): 50-reroll cap never reachable (race bound, 0 collisions at N=5000); no dup slips
the index; canonicalAxes sound; the only finite-pool residue IS this 182 visible pool.

Status: OPEN — consolidation fix owner. Re-attack: adv2_exclusivity_test.ts → green when the
visible style space is as wide as the fingerprint space.
