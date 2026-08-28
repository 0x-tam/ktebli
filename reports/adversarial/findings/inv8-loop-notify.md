# Adversarial finding — loop limits + invariant 8: BROKEN (2)

Attacker worktree: agent-a69f49a172624bdd9, commit 9aa8086 (adv2_loop_notify_test.ts A2/A3 fail
+ report). Held/conceded in writing: >2-regen double-cap, spend-reserve, INFRA→customer
disjointness, QUALITY logs+tells. Two breaks:

1. **STRONGEST: material-change floor defeated by a padding regeneration.** materialChange()
   (delivery_gate.ts:1134) computes an insertion-ROBUST verdict (retention/material) built
   specifically for this attack — but runGateLoop (:1880) keeps only changed_fraction, and
   loopAction (:1622) tests only `changed_fraction < minMaterialChange`. retention/.material are
   consumed in NO decision path. A regen returning the previous doc with a filler word every 4th
   word: retention=1.000, material=false, changed_fraction=1.000 → loopAction says "regenerate";
   runGateLoop burns its whole 2-regen budget re-judging padded copies. Same "hardened the
   function, never wired the verdict" pattern as inv4. FIX: carry material/retention into
   LoopAttempt from runGateLoop:1880; loopAction:1622 refuses when material===false, KEEP the
   changed_fraction floor so the low-edit control still refuses.
2. **notifyTerminal silent-swallow (invariant 8).** notifyTerminal (index.ts:1350) commits
   notified_at BEFORE any notification attempt; sel() throws on non-2xx (:104). A transient error
   or not-yet-visible row at the proposal/order lookup (:1352/:1354) early-returns / hits the
   outer catch{} with the marker already set and nothing written; notifyUnnotifiedTerminals
   sweeps only notified_at IS NULL, so it never retries — a paid terminal failure swallowed
   permanently. FIX: set notified_at LAST, after the escalation+email attempts.

Status: OPEN — consolidation fix owner. Re-attack: adv2_loop_notify_test.ts A2/A3 → pass.
