# Phase 6.5 — the adversarial round

One attacker per invariant, each with one job: break it. An invariant is not proven by passing
its own test; it is proven by surviving an agent that tried to defeat it. Every break found is
fixed and re-attacked until the attacker concedes IN WRITING.

The wave-1/2 workstreams already left standing adversarial tests under tests/adversarial/ (each
of which broke its invariant on first contact and now passes). This round is the SECOND pass:
attackers assume those holes are closed and look for what the closing missed, plus the invariants
those tests do not cover (1 delivery gate, 6 exclusivity/uniqueness, 8 hold-class/refund).

Per-invariant attacker files land here as invariant-<n>-<name>.md: the attack tried, whether it
broke, the fix if it broke, and the re-attack outcome ending in the attacker's written concession
or an escalation to the orchestrator.
