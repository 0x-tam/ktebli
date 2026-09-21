# Adversarial finding — invariant 4 (numeric register): BROKEN, 3 breaks

Attacker worktree: agent-a46dac953846f5ace, commit 879c708 (adv2_numeric_test.ts + report).
The round-1 isolated resolveRegister() survived re-attack on all 10 closed classes. Round 2:

1. **BREAK 3 (systemic, strongest): the register is wired to nothing.** resolveRegister()
   (numeric_register.ts:288) is imported/called by NO worker code. The design stage emits bare
   model numbers; `dn` built straight from raw fields; the only numeric gate is
   consistencyFindings (index.ts:2279), STILL one-directional (`n > dn.participants*1.01`,
   index.ts:265 — understatement passes, the 200-vs-216 direction), with numbersNear()
   (index.ts:241) a dead `a===b` no-op. Matches CLAUDE.md P1.7 verbatim. FIX: wire
   resolveRegister before generation; make consistencyFindings bidirectional and summing;
   remove/replace the dead numbersNear.
2. **BREAK 1 (register-internal): percentage right about the wrong denominator.** The rate
   denominator-label guard (numeric_register.ts:216-220) is a naive substring test; a rate
   labelled "share of total project cost…" divides by a "cost" node (£108k) while the register
   holds its own total (£120k), certifying 75% when the honest share is 67.5%. FIX: match the
   denominator by node identity/id, not label substring.
3. **BREAK 2 (register-internal): ratio verified by a colliding integer.** numeric_register.ts
   :318-319 accepts a bare integer equal to asPercent(value); numbersIn() (92-101) never records
   which numbers wore a %. FIX: track %-provenance so a bare integer cannot satisfy a ratio.

Status: OPEN — assigned to the consolidation fix owner. Re-attack: re-run adv2_numeric_test.ts
(7 failures today) until all pass, attacker confirms concession.
