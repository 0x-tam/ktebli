# Phase 1 — ten verdicts. COMPLETE: 10/10, zero MISSING, zero SUBSTITUTE.

**Date:** 2026-08-28 · **Host:** Jarvis · **Run spend: $0.4511** (usage fields) · **Balance $24.92 → $24.55**

Supersedes the 2026-08-27 STOP record (preserved in git history). Every model call went
direct to `/chat/completions` with `stream: true`, generation id captured from the first
chunk, blinding derived from packet bytes at read time, verdict written to disk the moment
it landed. Runner: `tests/ladder/run-phase1.py`, unmodified. Critics are the original
models: `openai/gpt-5.6-sol` (critic_a), `x-ai/grok-4.6` (critic_b), at
`reasoning_effort: low`, `max_tokens: 8000` — matching every previously landed cell.

## Pre-flight (before any paid call)

- `bytematch.py` byte-verified the 3 previously landed verdicts in `tests/ladder/verdicts/`
  plus the corrected n06/critic_b decode (DCAB): all content fingerprints ok.
- Its structural pass was found to be globbing dotted scratch-names and so checked **zero
  packets while printing OK** — the silent-pass class again. Fixed; an empty glob now fails
  loudly. All packets then derived to the README's recorded permutations.
- The hand-built `prompt-n03-critic_b.txt` carried a fifth delimiter style; rebuilt with the
  verified builder (`build_packet.py`, re-verified byte-for-byte against 4 sent packets) at
  the same order, BADC. The lost `n09/critic_b` packet was rebuilt at DACB so the two
  critics do not share a document order on that rung.
- The landed `n06thin/critic_a` verdict was staged into `tests/ladder/verdicts/` so the
  runner could not re-bill that cell.

## The ten cells

| rung | critic | source | order (derived) | generation id | cost |
|---|---|---|---|---|---|
| n03 | critic_a | **DIRECT, this run** | CBAD | gen-1787902200-3wtPr1xWjC1mMRsKNIMl | $0.1079 |
| n03 | critic_b | **DIRECT, this run** | BADC | gen-1787902295-2qUhdyqtkkGqCRX2RmRF | $0.0377 |
| n06 | critic_a | **DIRECT, this run** | BDAC | gen-1787902331-8Bg2dIKuu92LtL9bdpdR | $0.0802 |
| n06 | critic_b | landed 2026-08-27 | DCAB | gen-1787840048-c19hZOi7SX2UWi8anOFD | (prior run) |
| n09 | critic_a | **DIRECT, this run** | BDAC | gen-1787902389-xBRsjWLLfQdRl0tylEvh | $0.0953 |
| n09 | critic_b | **DIRECT, this run** | DACB | gen-1787902463-0l4w7zRXQ764uw2oAdz4 | $0.0426 |
| n12 | critic_a | **DIRECT, this run** | BACD | gen-1787902502-GSznByML89GFDEYmbdw1 | $0.0873 |
| n12 | critic_b | landed 2026-08-27 | BDAC | (recorded in file) | (prior run) |
| n06thin | critic_a | landed 2026-08-27 | BDCA | (recorded in file) | (prior run) |
| n06thin | critic_b | landed 2026-08-27 | DCAB | (recorded in file) | (prior run) |

**MISSING: 0. SUBSTITUTE: 0.** No stream died; no retry was needed.

Every DIRECT verdict's decoding was then confirmed by **content fingerprint**: a figure the
critic itself quoted about a specific Doc n, appearing in exactly the arm the derived
blinding assigns (`bytematch.py`, 20 fingerprints, all ok, exit 0). Ledger facts shared
across arms were rejected as fingerprints; only derived/computed figures unique to one arm
were used.

## Decoded results

Arms: **A** pipeline+flash · **B** pipeline+opus · **C** single-prompt+flash · **D** single-prompt+opus.

| rung | critic | ranking (best first) | funds | fundable as submitted |
|---|---|---|---|---|
| n03 | a | B > D > C > A | **B** | B |
| n03 | b | B > D > C > A | **B** | B, D |
| n06 | a | D > B > C > A | **D** | D |
| n06 | b | D > B > C > A | **D** | D, C (barely) |
| n09 | a | D > B > A > C | **D** | D (narrowly) |
| n09 | b | D > B > C > A | **D** | D, B |
| n12 | a | B > D > A > C | **B** | B |
| n12 | b | B > D > C > A | **B** | B |
| n06thin | a | B > D > C > A | **B** | B |
| n06thin | b | D > B > C > A | **D** | D, B |

## Cost accounting

Sum of the six calls' `usage.cost` fields: **$0.4511**. Meter: $24.9214 before the first
call, $24.5492 after the last (delta $0.3722). The two numbers do not reconcile exactly,
and the meter also moved $0.12 in the ten minutes before the run with no call in flight
from this machine — the account meter is shared and settles asynchronously, which is
exactly why rule 4 forbids using it for attribution. Usage-field sum is the recorded spend.
Budget line: $0.45 of $15.00.

## The ladder shape, in one paragraph

The ladder is **not a ladder on the count axis, and the axis that moves is the mode of the
winning opus arm, agreed by both critic families within every standard rung.** In all ten
cells the two opus arms occupy the top two places and the two flash arms the bottom two
(A last in 8/10, C last in 2/10); referent supply from 3 to 12 never changes that. What it
changes is *which* opus arm wins, and on every non-thin rung the two families agree: n03 →
pipeline (B), n06 → single-prompt (D), n09 → single-prompt (D), n12 → pipeline (B). That
is a 5–5 head-to-head tie between B and D overall (the thin rung splits the critics), so
fundability tracks neither referent count nor the pipeline — it tracks generator strength
first (opus arms drew 13 fundable-as-submitted marks across 10 cells; flash arms drew 1,
"barely"), and mode second with no consistent direction. The specificity contrast (n06 vs
n06thin at fixed count) moves the winner for critic_a (D→B) but not critic_b (D→D), so it
discriminates critics, not documents. Fork: **case B — the single prompt matches the
pipeline** (5–5 with family agreement per rung), and the phase 2 rule applies.
