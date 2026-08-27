# Phase 1 — STOPPED. No verdict was obtained, and no call was made.

**Date:** 2026-08-27 · **Spend this run: $0.00** · **Balance $25.10 before and after**
(total_credits $45.00, total_usage $19.8987 — unchanged, because nothing was sent).

This file is a STOP record, not a set of verdicts.

## Where this stopped, and why

At the first model call. Two independent blockers, either one sufficient:

1. **`openrouter.ai` and `api.openrouter.ai` are denied by this session's egress policy** —
   `403 to CONNECT`, logged at `15:45:34Z` by the session proxy, whose own README states a
   403 is an organisation policy denial that must be reported rather than retried or routed
   around. Operating rule 4 requires these calls to go direct over HTTP. They cannot leave
   this machine.
2. **There is no OpenRouter key on this machine.** `stack/.env` does not exist, no
   `OPENROUTER_*` variable is set, and a key must not be taken out of production.

**The MCP path was not used, deliberately.** Rule 4 forbids it and the last run is why: seven
calls were accepted, generated and billed upstream, then discarded by the MCP server's
60-second ceiling with no generation id, so $0.9521 bought nothing. Sending them that way
again would have spent real money at the same odds. The balance check that rule 3 requires
was made through the MCP server's read-only credit endpoint — a metadata read, not a model
call, and the only thing that endpoint was used for.

**Note the pattern.** Three runs, three different transports, none of which reached a verdict:
a key spend cap (2026-08-26), the MCP 60-second ceiling (2026-08-27 am), an egress policy
denial (now). Credit has never been the binding constraint. Transport always has.

## Verdict inventory — 4 landed, 6 outstanding

The brief says "3 of 10 landed" and asks for the remaining 7. The count is **4 and 6**: the
brief's 3 plus the n06/critic_b cell, whose decoding is settled below.

| rung | critic_a `openai/gpt-5.6-sol` | critic_b `x-ai/grok-4.6` | packet on disk |
|---|---|---|---|
| n03 | OUTSTANDING | OUTSTANDING | critic_a yes · **critic_b: no packet, no map — must be built** |
| n06 | OUTSTANDING | **LANDED** | both |
| n09 | OUTSTANDING | OUTSTANDING | both |
| n12 | OUTSTANDING | **LANDED** | both |
| n06thin | **LANDED** | **LANDED** | both |

Every packet and every map, plus the 20 ladder documents and the fixture, existed **only**
in an ended session's `/tmp` scratch directory. They are now in `tests/ladder/` with an md5
manifest. Had this container been reclaimed first, no verdict in
`reports/design/ladder-critics/` could ever have been checked again.

## The retroactive byte-match — this part did complete

Phase 1 requires the byte-match to be applied retroactively to the landed verdicts and
"hardest" to the corrected n06 result, "which currently favours the shipped default". It
does not survive.

**Finding: the "DECODING CORRECTED 2026-08-27" banner on `critic-n06-critic_b.md` was itself
wrong, and it inverted that cell in favour of the pipeline.** The banner claimed critic_a's
packet (`BDAC`) had been sent, re-decoding the verdict from `D > B > C > A` (funds single
prompt + opus) to `B > C > D > A` (funds pipeline + opus). The critic's own quoted arithmetic
settles which document it actually read:

| the critic wrote | figure | occurs in | under `DCAB` | under `BDAC` |
|---|---|---|---|---|
| Doc 4's budget states 55,385, sums to 53,885 | `55,385` | only `out-n06-B.md` | Doc 4 = B ✓ | Doc 4 = C ✗ |
| Doc 1: 38,840 + 4,660 = 43,500 | `38,840` | only `out-n06-D.md` | Doc 1 = D ✓ | Doc 1 = B ✗ |

Neither figure appears in any other arm at that rung. `DCAB` fits both, `BDAC` neither. The
banner is withdrawn in place, with the evidence, and **the original decoding stands: ranking
`D > B > C > A`, would fund `D`, both pipeline arms not fundable.** `reports/referent-ladder.md`
§1 and §2 already recorded `DCAB` and need no change — the report was right and the banner
was wrong, which is the opposite of the direction anyone would have guessed.

All four landed cells were then re-derived from scratch, trusting no `.map-` file:

| cell | packet actually read | permutation | how established |
|---|---|---|---|
| n06 / critic_b | `.packet-n06-critic_b.txt` | `DCAB` | structure + 2 content fingerprints |
| n12 / critic_b | `.prompt-n12-critic_b.txt` | `BDAC` | structure + 4 content fingerprints |
| n06thin / critic_a | `.prompt-n06thin-critic_a.txt` | `BDCA` | structure + 1 content fingerprint |
| n06thin / critic_b | `.prompt-n06thin-critic_b.txt` | `DCAB` | structure + 4 content fingerprints |

All 11 packets on disk also decode structurally to their own recorded maps, and every packet
draws its four documents from exactly one rung — so no cross-rung pairing survives anywhere.
Re-runnable as `tests/ladder/bytematch.py`; exit 0 today.

Two failure modes are now separated by construction. *Structure* answers "which documents are
in this file"; only a *content fingerprint* answers "which document did the critic read". The
n06 banner was produced by a method that could only answer the first, and got the second
wrong.

## Ladder shape — NOT ESTABLISHED

Four of ten cells, one critic on three of them, one document per cell, no repeat calls. On
what is in hand: **no movement on the count axis** — arm A is last in all four rankings, arm C
third in all four, and the winner is always an opus arm, with referent supply changing only
*which* opus arm wins. With the n06 banner withdrawn the funded arm splits 2–2 between
pipeline (n12/critic_b, n06thin/critic_a) and single prompt (n06/critic_b, n06thin/critic_b),
where the banner had made it 3–1 for the pipeline. That is a tie on four judgements, not a
finding, and it is the strongest statement the evidence supports. Six cells missing, and not
missing at random — critic_a has answered on exactly one rung, the smallest packet.

## To run this phase

1. Allow `openrouter.ai` and `api.openrouter.ai` through the egress policy.
2. Put an OpenRouter key in `stack/.env`.
3. Build the missing `n03 / critic_b` packet: `tests/ladder/build_packet.py n03 <ORDER> <dest>`
   with an order that is not `CBAD` (critic_a's). That builder reproduces four
   actually-sent packets byte for byte (`--verify`), so the new packet carries identical
   framing. The other five packets are already on disk. Do not store the order beside the
   packet — `bytematch.py` re-derives it.
4. Original critic models only, one verdict per call, `stream: true`, log the generation id
   from the first chunk, cost from `usage`, write each verdict to its own file before the
   next call starts, and run `tests/ladder/bytematch.py` after each — adding that verdict's
   quoted figures to `FINGERPRINTS` so the next run inherits the check.
