# Blind critic evaluation — rung n09, critic_a (openai/gpt-5.6-sol)

**SYNTHETIC FIXTURE.** Halewater Commons Trust, Kelverton, Marlpit, Ferry Bank,
St Aidan's Parish Hall, Wharfside Boathouse, Dunmore Sixth Form College,
Barrowfield Youth Justice Team, Northgate Minibus Hire, Priya Raval, The Wren Hill
Foundation and the Neighbourhood Futures Fund do not exist. Nothing in this file or
in the documents it references is a statement of fact about any real organisation,
place or person.

## STATUS: STILL NOT RUN — replay attempted 2026-08-27, failed on a NEW fault

The API key limit that blocked the 2026-08-26 attempt is **resolved**. `get-credits`
now reports headroom and the calls were accepted and billed upstream.

The replay nonetheless produced **no verdict**, for a different reason:

```
MCP server "OpenRouter_MCP" tool "send-message" timed out after 60s
```

Twice, on identical parameters. The generations completed (or partially completed)
upstream and were charged; the replies were lost inside the MCP transport, which
caps at 60 seconds. There is no generation id to recover them with — the timeout
returns before an id is surfaced, and this MCP server exposes no listing endpoint,
only `get-generation` by id.

| attempt | wall result | account usage before | after | billed |
|---|---|---|---|---|
| 1 | 60s MCP timeout | 16.140455831 | 16.185141831 | $0.044686 |
| 2 (the one permitted retry) | 60s MCP timeout | 16.185141831 | 16.249675831 | $0.064534 |
| | | | **total** | **$0.109220** |

Per the standing instruction, the call was made once and retried exactly once. No
third attempt was made and **no judgement has been substituted for the missing one.**

### Why this rung and not the others — this is the actionable part

n03/critic_a and n06/critic_a replayed successfully earlier today at the same model,
the same `reasoning_effort: "low"` and the same `max_tokens: 8000`. The difference is
packet size:

| packet | bytes |
|---|---|
| `.prompt-n06-critic_a.txt` (replayed OK) | 49,015 |
| `.prompt-n03-critic_a.txt` (replayed OK) | 51,235 |
| `.prompt-n09-critic_a.txt` (**times out**) | 54,553 |
| `.packet-n09-critic_b.txt` (untried at this size) | 53,663 |

n09 is the largest packet in the ladder — four documents totalling ~44,800 bytes of
narrative, against a five-part output request that includes a full arithmetic
recomputation of all four budgets. It sits past whatever the 60s window affords.

**The available levers all break comparability and were therefore not pulled.**
Lowering `max_tokens` truncates the recomputation in part 4 and would make this
critic's output structurally different from the n03/n06 replays. Lowering
`reasoning_effort` is explicitly forbidden by the run instruction, for the same
reason. Splitting the packet changes the blinding and the four-way comparison that
the ranking depends on. A refused measurement is better than an incomparable one.

**What would actually fix it:** a transport that does not cap at 60s — a direct
HTTPS call to the OpenRouter API rather than this MCP server, or an MCP server
configured with a longer timeout. Note the `send-message` schema carries a
`timeout_ms` parameter, but it only aborts *earlier* locally; it cannot extend the
server's own 60s ceiling, so it is no help here.

**No critic judgements exist for rung n09 / critic_a.** The ranking, fundability,
machine-generated, swappable, proper-noun counts and weakest-thing fields were NOT
measured and are returned empty rather than guessed. Do not read the absence of a
result as a passing result.

## Randomisation mapping (kept for a re-run — unchanged)

Drawn with `random.SystemRandom().shuffle` over [A,B,C,D]. Mapping string: **BDAC**

| Presented as | True arm | Source file |
|---|---|---|
| Doc 1 | **B** | out-n09-B.md (pipeline + stronger generator) |
| Doc 2 | **D** | out-n09-D.md (single prompt + stronger generator) |
| Doc 3 | **A** | out-n09-A.md (pipeline + current generator) |
| Doc 4 | **C** | out-n09-C.md (single prompt + current generator) |

Mapping also in `.map-n09-critic_a.txt`. The critic was never told any of this.

## Packet integrity — verified before sending

The packet was sent byte-for-byte as preserved. Confirmed before the call:

```
size    54,553 bytes / 54,527 characters / 557 lines
md5     a5f22b4287bfcb6d6bb1d52292b48d8c
non-ASCII   26 x U+00A3 (£), all inside Doc 1 (true arm B); no tabs, no CR,
            no trailing whitespace on any line, single trailing newline
```

The 26-byte / 26-character delta is exactly the 26 pound signs. Nothing was added,
removed or reworded. This is the run that was refused, not a new one.

Contents, in order: a synthetic-fixture note; the hard-to-please-program-officer
framing; the funder guidance verbatim from `grant.json`; the applicant identity from
`org.json`; the four documents in BDAC order under neutral `DOC n` delimiters; then
the five numbered requests (rank + fund one or NONE; per-doc block; reject list;
recompute every number; four applicants or one system).

Blinding measures applied at assembly time and left intact: no mention of a pipeline,
of arms, of how any document was produced, or of any difference between them. The
leading `<!-- SYNTHETIC FIXTURE ... -->` HTML comments present in out-n09-A.md and
out-n09-C.md were stripped, because only two of the four carried one and it would
have been a format tell correlated with provenance; the synthetic labelling is
carried instead by the note at the head of the packet.

## Deterministic arithmetic check — MINE, NOT THE CRITIC'S

Carried over unchanged from the 2026-08-26 placeholder. It is included only because
it is deterministic and does not depend on a model. It is **not** a substitute for
the critic's recomputation (part 4 of the request) and must not be reported as one.
It says nothing about fundability, ranking or machine-generated character.

All four budgets **close** as stated:

- **Doc 3 / arm A** — direct lines sum to 47,980 (16,800+18,900+1,920+1,440+1,520+3,800+1,600+2,000).
  Overhead 5,758 = 12.00% of 47,980 (5,757.6 rounded up). Total 53,738. Within band.
- **Doc 1 / arm B** — direct lines sum to 57,000. Overhead 6,840 = exactly 12% of 57,000.
  Total 63,840. Within band. Line derivations check: 108 x 40 = 4,320; 24 x 95 = 2,280.
- **Doc 4 / arm C** — direct lines sum to 48,864. Overhead 5,860 = 11.99% of 48,864. Total 54,724.
  Within band. Every line derives: 14 x 19.50 x 78 = 21,294; 10 x 15 x 78 = 11,700;
  72 x 40 = 2,880; 36 x 120 = 4,320; 36 x 95 = 3,420; 72 x 25 = 1,800; 3 x 350 = 1,050;
  15 x 60 = 900. Q5 sustain total: 960+1,920+1,425+15 = 4,320.
- **Doc 2 / arm D** — direct lines sum to 46,440. Overhead 5,560 = 11.97% of 46,440.
  Total 52,000. Within band. 78 x 40 = 3,120; 20 x 120 = 2,400; 24 x 95 = 2,280;
  64 x 60 = 3,840; 700 x 14 = 9,800.

Internal (non-budget) inconsistencies shown deterministically, which a critic would
be free to weigh differently:

- **Doc 4 / arm C**: Phase 2 is "weeks 3-12" (10 weeks) with one weekly workshop per
  venue, but the budget buys 24 St Aidan's sessions and 12 boathouse sessions per
  cohort. The session counts do not derive from the stated schedule.
- **Doc 4 / arm C**: the Q5 sustain figure lands on exactly GBP 4,320 only because of a
  "Course materials and baseline refreshments (GBP 15)" line. GBP 15 a year for
  materials and refreshments for 48 young people is a plug, not a cost.
- **Doc 2 / arm D**: cohorts 2 and 4 run "two evenings a week for twelve weeks" at
  Wharfside Boathouse — 48 days for two cohorts — but the budget funds 20 days there.
  The venue line does not cover the described delivery.
- **Doc 2 / arm D**: "about GBP 3,400" to run one cohort a year is not traceable;
  24 evenings at GBP 40 (960) plus three minibus trips (285) plus 16 participants at
  GBP 60 (960) is 2,205.
- **Doc 2 / arm D**: Q4 says the completion and progression rates are held "flat"
  against Second Chances, but 32 of 64 progressing is 50% against a pilot rate of
  11/24 = 45.8%.
- **Doc 1 / arm B**: "108 evenings at GBP 40" does not derive from three 12-week cohorts.

## To re-run

The packet and mapping are still preserved byte-for-byte and still valid. The blocker
is now transport, not credit. Send `.prompt-n09-critic_a.txt` verbatim to
`openai/gpt-5.6-sol` at `reasoning_effort: "low"` and `max_tokens: 8000` — those two
settings are fixed by comparability with the n03 and n06 replays and must not be
changed — over a channel that allows more than 60 seconds. $0.109220 has already been
spent on two lost replies; budget roughly $0.05-0.07 for the successful one.
