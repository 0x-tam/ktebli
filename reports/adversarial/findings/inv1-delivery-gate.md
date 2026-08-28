# Adversarial finding — invariant 1 (delivery gate): CONCEDED (held) + one cheap hardening

Attacker worktree: agent-a830f42ed940f0dd9, commit deb61a4 (adv2_delivery_gate_test.ts 72 green +
report). Could not deterministically break it. 10 attack families HELD against the real module:
strict structured-output parsing (field manipulation, decoy JSON, out-of-enum verdicts, string
scores, numeric booleans); the hold-biased double-signal (clears AND asserted clears_bar both
required — assertion can only veto); gate-version + sticky-hash replay guards; family-exclusion
under id obfuscation (judgeCall sends req.model, not the generator); preflight-before-judge;
delivery-only-on-pass; deliver fail-closed on hash miss.

**One cheap hardening worth taking (contingent, not attacker-reachable):** normaliseDocument
(delivery_gate.ts:221-230) collapses \n{3,}→\n\n but NOT the \n↔\n\n (0↔1 blank-line) boundary,
while its comment claims a blank-line reflow "must not earn a fresh roll." A blank-line-only twin
changes doc_hash → the sticky verdict is not replayed at the loop's FIRST judgement. Not a break
because: materialChange refunds a blank-line-only regen (0% change) before it re-rolls; narrative
bytes are pipeline-controlled (gate_text resumes verbatim); the customer controls no bytes;
deliver fails closed. FIX (take it anyway, honours the documented contract): collapse \n{2,}→\n so
any blank-line reflow is hash-invariant. The disclosed judge-rubber-stamp residual (phase3 §2) is
a judge-accuracy property already flagged, needs a non-deterministic model call, not a mechanism
bug — not reproduced.

Status: HELD. Take the normaliseDocument hardening in the consolidation fix. adv2_delivery_gate_
test.ts (72 green) is a keeper regression.
