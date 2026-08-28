# Adversarial finding — invariant 5 (compliance): BROKEN, via the word counter

Attacker worktree: agent-a4d640c2df8cbb6eb, commit 9ebd55d (adv2_compliance_test.ts, 11 failing
assertions + report). The donor-limit PARSER is solid (ranges/minimums/wrong-units/RTL/dual all
refuse; no confident-wrong-number, no silent null) and the PAGE/render route is fully closed
(render mandatory, no estimate fallback). The break is the counter.

1. **STRONGEST: the word counter is not Unicode-aware.** wordCount() (index.ts:539-541) and its
   verbatim mirror gateWordCount() (delivery_gate.ts:279-281) tokenise on `/[A-Za-z0-9؀-ۿ]/` —
   Latin, ASCII digits, Arabic block only. Cyrillic/Greek/Hebrew/Devanagari/CJK count as ~0. A
   doc of 500 Latin + 4000 Cyrillic words counts 502 against a 1400 limit; over_word_limit never
   fires; the delivery-gate preflight (last catch, counts the whole doc) passes (502 in
   [250,1400]). The heading gate (normHeadU, index.ts:578, WS4a-16) and the repetition tokenizer
   (delivery_gate.ts:1128) in the SAME files already use `\p{L}\p{N}` — only the counter lagged.
   FIX: `/[\p{L}\p{N}]/u` in both mirrored copies. Monotonic-safe (counts ≥ today for every input).
2. **Zero-width chars + pipe tables collapse the count** (ZWSP/word-joiner/soft-hyphen/ZWJ;
   3000 words→1; 300 cells→100). `\s` and sanitizeMd strip none. FIX: normalise zero-width
   characters out before counting; count table cell text.
3. **absenceIsSuspicious wrapped-limit backstop gap** (donor_limits.ts:326-333): the phase-6
   one-line tightening (which correctly killed the footer false-positive) now misses a limit
   wrapped between number and unit ("1,400\nwords") → decideLimit(null,…) returns absent → a
   stated limit becomes null. Authors documented the trade (donor_limits.ts:320-325). JUDGMENT
   for the fix owner: try to catch the wrap WITHOUT reopening the footer false-positive (e.g.
   allow a single newline between number and unit only when no blank line and no "Page N" footer
   pattern intervenes); if not cleanly separable, keep the documented trade and note why.

Status: OPEN — consolidation fix owner. Re-attack: adv2_compliance_test.ts (11 failing) → all pass.
