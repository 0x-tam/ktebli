# Blind critic evaluation — rung n09, critic_b (x-ai/grok-4.6)

**STATUS: STILL NOT OBTAINED. NO EVALUATION EXISTS FOR THIS CELL.**

The original refusal (`HTTP 403 Key limit exceeded`) is gone — the key works. This cell now
fails for a *different* reason: the MCP transport's 60-second ceiling. Both permitted calls were
accepted, generated and **billed** upstream, and both replies were lost in transit. The money was
spent; the answer is unreachable.

Date of original (refused) run: 2026-08-26 · Date of replay attempt: 2026-08-27
Rung: n09 (ledger offers 13 referents) · Critic: critic_b = `x-ai/grok-4.6`

SYNTHETIC FIXTURE NOTE. Halewater Commons Trust, the town of Kelverton, the neighbourhoods
Marlpit and Ferry Bank, St Aidan's Parish Hall, Wharfside Boathouse, Dunmore Sixth Form College,
Barrowfield Youth Justice Team, Northgate Minibus Hire, Priya Raval, The Wren Hill Foundation and
the Neighbourhood Futures Fund are all invented. Nothing in the packet or in this file is a
statement of fact about any real organisation, place or person. The domain
halewatercommons.org.uk is part of the fixture and must never be crawled or cited as a source.

## Randomisation mapping (private — the critic never saw this)

Read from `.map-n09-critic_b.txt`: permutation `CDBA`. Verified against the packet rather than
trusted, by extracting each `DOC n` block and scoring its long lines against `out-n09-{A,B,C,D}.md`:

| Label shown to critic | TRUE arm | Source file | Line-set match |
|---|---|---|---|
| Doc 1 | C (single prompt + current generator) | out-n09-C.md | 1.00 |
| Doc 2 | D (single prompt + stronger)         | out-n09-D.md | 1.00 |
| Doc 3 | B (pipeline + stronger)              | out-n09-B.md | 1.00 |
| Doc 4 | A (pipeline + current generator)     | out-n09-A.md | 0.875 |

Doc 4's 0.875 is fully explained: the `DOC 4` block has no closing delimiter, so the extraction
swept up the twelve trailing lines of the `YOUR TASK` section. Every one of the twelve is task
text ("Assess all four…", "REJECT LIST…"), not proposal text. Doc 4 is arm A in full.

## CORRECTION TO THE REPLAY INSTRUCTION — the packet path given was wrong

The task named `.prompt-n09-critic_a.txt` as the packet, paired with `.map-n09-critic_b.txt` as
the mapping. **Those two do not belong together.** Sent as a pair they would have produced a
confidently-labelled, entirely wrong decode:

- `.prompt-n09-critic_a.txt` is **critic_a's** packet. Its document order is `BDAC` — verified
  the same way as the table above — and it matches `.map-n09-critic_a.txt`.
- `.map-n09-critic_b.txt` is `CDBA`.

Decoding a `BDAC` packet with a `CDBA` key mislabels three of the four documents. The packet
actually paired with `CDBA` is **`.packet-n09-critic_b.txt`**, which is self-contained: it carries
the fixture note, the programme-officer framing, the funder guidance, the applicant identity, all
four documents in `CDBA` order, and the five task questions. That is the file that was sent.

This is the same defect a sibling agent found and corrected at rung n06 (see
`critic-n06-critic_b.md`, "CORRECTION TO THE REPLAY INSTRUCTION"). It is an error in the replay
instructions, not in the preserved artefacts — the blinding itself is intact and byte-for-byte.

Packet sent: `.packet-n09-critic_b.txt`, 53,637 chars, md5 `9870c38dff3f35fef382d32f8dae4c91`,
VERBATIM, nothing added or removed.

## What was tried

Model `x-ai/grok-4.6`, `reasoning_effort: "low"`, `max_tokens: 8000`, no system prompt (the
programme-officer framing lives inside the packet). Two calls, identical in every parameter.

| # | Result | Account usage before → after | Billed |
|---|---|---|---|
| 1 | MCP timeout at 60s | 16.185141831 → 16.249675831 | **$0.064534** |
| 2 | MCP timeout at 60s | 16.249675831 → 16.359928631 | **$0.110253** |

**Total actual spend for this cell: $0.174787**, read from account usage deltas, not estimated.

Both calls were billed, which is the whole point: the generation completed at xAI and the reply
died in the MCP transport. Nothing was truncated at the model end and nothing was refused.

## Why this rung is harder to land than n06 — and why a third call was not made

`list-model-endpoints` shows every `x-ai/grok-4.6` endpoint (xai, xai/priority, xai/zdr,
xai/zdr/priority, amazon-bedrock) sitting at **p50 throughput ~53 tok/s**, p90 ~68. The priority
endpoints buy better *latency* (p99 2.6 s vs 36 s time-to-first-token) but **not** better
throughput. So routing cannot rescue a long completion, and pinning a provider was correctly not
attempted.

Working back from the billing at published rates, the two lost completions were roughly **6,300
and 4,700 tokens**. At ~53 tok/s those need ~120 s and ~89 s. The n06/critic_b replay landed only
because grok-4.6 happened to emit **3,627** completion tokens there, finishing in 54.6 s — 5.4 s
inside the ceiling.

That reframes the sibling agent's conclusion. n06 landing was not proof the ceiling is generally
survivable; it was the short tail of a high-variance distribution. The n09 packet is the largest
in the ladder (53,637 chars against n06's 48,686) and asks the same five questions about four
longer documents, so it draws a longer answer. **Two independent draws at 4,700 and 6,300 tokens,
against a ceiling that admits ~3,100, is not bad luck — it is a rung that mostly does not fit.**

Not tried, on purpose:
- **A third call.** The instruction permits one retry. It was used.
- **Lowering `max_tokens` to force a shorter answer.** It would truncate the verdict mid-answer
  and, more seriously, make this cell incomparable with the n06 and n03 cells that ran at 8,000.
- **Raising or lowering `reasoning_effort`.** Same incomparability problem; the run design fixes
  it at "low".
- **Shortening or summarising the packet.** Destroys the blinding and the byte-for-byte replay.
- **`timeout_ms`.** The 60 s ceiling is the MCP server's own; a larger client timeout does not
  move it (established at n06/critic_a).

## What this cell contributes to the ladder

**Nothing.** There is no ranking, no fundability verdict, no per-document block, no referent
count, no reject-list hit, no arithmetic recomputation and no one-system judgement for
rung n09 / critic_b.

None of it has been inferred, estimated, carried over from critic_a, carried over from another
rung, or supplied from my own reading of the four documents. I read all four while verifying the
mapping and I am deliberately not recording an opinion about them: an opinion of mine is not a
measurement, and this placeholder exists precisely because an earlier agent declined to blur that
line. Do not read the absence of a result here as a passing result.

## To finish this cell

The blocker is transport, not money and not the model. Any of these unblocks it:
- an OpenRouter call path that is not subject to the 60 s MCP ceiling (streaming, or a direct
  HTTPS call — currently blocked from this machine);
- raising the MCP server's own timeout above ~150 s;
- accepting a documented, ladder-wide change of `max_tokens` and **re-running every cell** at the
  new value, so the rungs stay comparable with each other.

Until one of those happens, n09/critic_b stays MISSING, and any statement about how fundability
behaves at 13 referents rests on critic_a alone.
