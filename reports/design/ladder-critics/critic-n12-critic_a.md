# Blind critic evaluation — rung n12, critic_a (openai/gpt-5.6-sol)

**SYNTHETIC FIXTURE.** Halewater Commons Trust, Kelverton, Marlpit, Ferry Bank,
St Aidan's Parish Hall, Wharfside Boathouse, Dunmore Sixth Form College, Barrowfield
Youth Justice Team, Northgate Minibus Hire, Redgate Catering, Priya Raval, Delroy
Ferguson, the Second Chances and Night Kitchen courses, halewatercommons.org.uk, The
Wren Hill Foundation and the Neighbourhood Futures Fund do not exist. Nothing in this
file or in the documents it references is a statement of fact about any real
organisation, place or person.

## Randomisation mapping (the critic was never told any of this)

Drawn with `random.SystemRandom().shuffle` over [A,B,C,D]. Mapping string: **BACD**

| Presented as | True arm | Source file | Arm description |
|---|---|---|---|
| Doc 1 | **B** | `out-n12-B.md` | pipeline + stronger generator |
| Doc 2 | **A** | `out-n12-A.md` | pipeline + current generator |
| Doc 3 | **C** | `out-n12-C.md` | single prompt + current generator |
| Doc 4 | **D** | `out-n12-D.md` | single prompt + stronger generator |

Also in `.map-n12-critic_a.txt`.

---

## STATUS: NO CRITIC VERDICT. Generated and packeted successfully; the model reply was lost in transport.

The credit blocker recorded on 2026-08-26 is **resolved** — `get-credits` shows headroom
and both calls were accepted and billed upstream. The four `out-n12-*.md` documents that
were missing on 2026-08-26 now exist and were used. The evaluation nonetheless produced
**no verdict**, for the same transport reason that defeated the n09/critic_a replay:

```
MCP server "OpenRouter_MCP" tool "send-message" timed out after 60s
```

Twice, on identical parameters. The generations completed (or partially completed)
upstream and were charged; the replies were lost inside the MCP transport, which caps at
60 seconds. There is no generation id to recover them with — the timeout returns before
an id is surfaced, and this MCP server exposes no listing endpoint, only `get-generation`
by id.

| attempt | wall result | account usage before | after | billed |
|---|---|---|---|---|
| 1 | 60s MCP timeout | 19.518426198 | 19.573332794 | $0.054907 |
| 2 (the one permitted retry) | 60s MCP timeout | 19.573332794 | 19.675278427 | $0.101946 |
| | | | **total** | **$0.156852** |

Per the standing instruction the call was made once and retried exactly once. No third
attempt was made and **no judgement has been substituted for the missing one.**

Account state after: `total_credits` 45, `total_usage` 19.675278427 — roughly $25.32 of
headroom left, well clear of the $3 floor. Budget is not the blocker.

### The size threshold does not explain this one, and that matters

The n09/critic_a report proposed packet size as the cause and put the boundary between
n03 (51,235 B, replayed OK) and n09 (54,553 B, timed out). **This rung falsifies that
reading.**

| packet | bytes | outcome |
|---|---|---|
| `.prompt-n06-critic_a.txt` | 49,015 | replayed OK earlier today |
| **`.prompt-n12-critic_a.txt`** | **49,490** | **times out, twice** |
| `.prompt-n03-critic_a.txt` | 51,235 | replayed OK earlier today |
| `.prompt-n09-critic_a.txt` | 54,553 | times out |

n12 is 475 bytes larger than an n06 packet that succeeded and 1,745 bytes *smaller* than
an n03 packet that succeeded. Size is at best a weak correlate. The honest statement is
that this workload sits near the 60s boundary and whether any given call lands inside it
is not reliably predictable from packet size. Anyone reading the n09 file should not
treat "under ~52 KB is safe" as established — it is not.

### The available levers all break comparability and were not pulled

Lowering `max_tokens` truncates the arithmetic recomputation in part 4 and would make
this critic's output structurally different from the n03/n06 replays. Lowering
`reasoning_effort` is explicitly forbidden by the run instruction, for the same reason.
Splitting the packet changes the blinding and the four-way comparison the ranking depends
on. A refused measurement is better than an incomparable one.

`send-message` carries a `timeout_ms` parameter, but it only aborts *earlier* locally; it
cannot extend the server's own 60s ceiling.

A direct HTTPS call to the OpenRouter API would fix this, and is what the n09 file
recommends. It was **not attempted here**: obtaining the API key required reading
credential stores, the sandbox classifier denied that read, and working around a
credential-access denial is not a reasonable thing to do to get a measurement. This
remains a user-side unblock.

**No critic judgements exist for rung n12 / critic_a.** Ranking, fundability,
machine-generated, swappable, concrete-named-referent counts, weakest-thing, reject-list
hits and the one-system/different-applicants call were NOT measured and are returned
empty rather than guessed. Do not read the absence of a result as a passing result.

## Packet integrity — verified before sending

```
size    49,490 bytes / 49,376 characters / 523 lines
md5     31e08611b588b001771a4f52b321ad7d
non-ASCII   66 x U+00A3 (£), 20 x U+2013 (–), 4 x U+2014 (—)
            no tabs, no CR, no trailing whitespace on any line
```

Built to match `.prompt-n09-critic_a.txt` exactly in everything but the four documents.
Verified mechanically, not by eye:

- The header — synthetic-fixture note, hard-to-please-program-officer framing, funder
  guidance from `grant.json`, applicant identity from `org.json`, and the
  `THE FOUR SUBMISSIONS` banner — is **byte-identical** to the n09 packet's first 83
  lines (`diff` clean).
- The trailing five-part request block is **byte-identical** to n09's.
- The document glue (`<<<<<<<<<< DOC n - BEGINS/ENDS >>>>>>>>>>`, blank-line spacing)
  was reverse-engineered from the n09 packet by reconstructing its four documents from
  `out-n09-*.md` and confirming an exact match, then applied unchanged.
- Each of the four documents round-trips byte-exact out of the assembled packet against
  its `out-n12-*.md` source.
- The n09 builder strips a leading `<!-- SYNTHETIC FIXTURE ... -->` HTML comment where
  one is present, because only some arms carry one and it would be a format tell
  correlated with provenance. The same strip was applied here; none of the four n12
  documents carried one, so it was a no-op.
- Leak scan over the assembled packet for `pipeline+`, `single+`, `out-n12`, `gemini`,
  `opus`, `anthropic`, `arm a`, `variant`: one hit, `"no delivery arm and no regional
  offices"` in the funder guidance — a false positive, present identically in the n09
  packet.

Blinding intact: no mention of a pipeline, of arms, of how any document was produced, or
of any difference between them.

## Deterministic arithmetic check — MINE, NOT THE CRITIC'S

Computed in Python from the printed budget lines. It is included only because it is
deterministic and depends on no model. It is **not** a substitute for the critic's
recomputation (part 4 of the request) and must not be reported as one. It says nothing
about fundability, ranking, machine-generated character or referent counts.

All four budgets **close** as stated, and all four sit inside the GBP 25,000–75,000 band
with an overhead line at or under the 12% cap:

| Doc / arm | direct lines sum | stated direct | overhead | as % of direct | total | band |
|---|---|---|---|---|---|---|
| Doc 1 / **B** | 60,000.00 | 60,000 | 7,200 | 12.0000% | 67,200 | in |
| Doc 2 / **A** | 44,424.00 | 44,424 | 5,320 | 11.9755% | 49,744 | in |
| Doc 3 / **C** | 33,866.40 | 33,866.40 | 4,063.96 | 12.0000% | 37,930.36 | in |
| Doc 4 / **D** | 49,040.00 | 49,040 | 5,880 | 11.9902% | 54,920 | in |

All four state a delivery period of exactly 18 months, at the ceiling.

Internal (non-budget) inconsistencies shown deterministically, which a critic would be
free to weigh differently:

- **Doc 3 / arm C** — the Q5 sustain figure **does not close**. Its own four components
  are 48 x 40 = 1,920; 12 x 95 = 1,140; 10 x 120 = 1,200; 360 x 2.40 = 864, summing to
  **5,124**, against a stated **£5,120**. Understated by £4.
- **Doc 4 / arm D** — transport unit mismatch. Q3 says "four off-site visits, 12 trips in
  total with Northgate Minibus Hire at £95"; the budget funds "24 trips at £95" = 2,280.
  The narrative supports 1,140. The budget line is double the described activity.
- **Doc 4 / arm D** — the Q5 "about £5,600" is not traceable. The itemised parts given
  are 12 evenings at £40 (480) and four minibus trips at £95 (380) = 860; coordinator
  time is explicitly stated to be already in the core budget. Reaching 5,600 requires
  ~£4,740 of unstated catering, which at £2.40 a head would be ~1,975 covers for a
  16-person twelve-week course.
- **Doc 4 / arm D** — venue line buys 90 Marlpit evenings; two Marlpit cohorts of twelve
  weekly sessions derive 24. The count does not follow from the stated schedule.
- **Doc 1 / arm B** — venue lines buy 70 evenings (40 + 30); three cohorts at one weekly
  group session over twelve weeks derive 36. Fortnightly one-to-ones are described but
  not costed as venue nights, so the count is not derivable as printed.
- **Doc 2 / arm A** — the overhead line is labelled "12.0% of direct costs" but is
  11.9755%. Under the cap, so not a breach; the label is inaccurate.
- **Doc 2 / arm A** — the meals line, £2,304 at "£2.40/head", implies exactly 960 covers.
  No derivation of 960 appears anywhere in the document.
- **Doc 2 / arm A** — the budget funds "24 sessions" at St Aidan's; the narrative
  describes four twelve-week courses split across two venues, which does not derive 24.
- **Doc 3 / arm C** — match funding of £3,500 is declared **Secured** with the source
  given as the applicant's own core reserves. Whether an organisation's own reserves are
  match funding is a judgement call, not an arithmetic one, and is flagged not scored.

Everything else recomputed cleanly, including Doc 3's cohort split (40 + 20 + 12 = 72),
its completion rate (57/72 = 79.2%, matching the 19/24 pilot rate it cites), its
progression split (24 + 6 + 6 = 36) and its catering derivation (27 persons x 18 days =
486 covers x £2.40 = £1,166.40); Doc 2's cohort totals (4 x 20 = 80), visit counts
(12 + 12 = 24) and destination split (26 + 10 + 6 = 42); Doc 1's cohort cap (3 x 22 = 66)
and trip count (3 cohorts x 2 visits = 6 trips x £95 = £570); and Doc 4's participant
count (48 young people + 24 adults = 72 x £45 = £3,240).

## To re-run

The packet and mapping are preserved byte-for-byte and remain valid. Send
`.prompt-n12-critic_a.txt` verbatim to `openai/gpt-5.6-sol` at `reasoning_effort: "low"`
and `max_tokens: 8000` — both fixed by comparability with the n03 and n06 replays and not
to be changed — over a channel that allows more than 60 seconds. $0.156852 has already
been spent on two lost replies here; budget roughly $0.05–0.11 for a successful one.

The same is still outstanding for n09/critic_a. Whatever fixes the transport should be
applied to both in one pass, since both packets are preserved and both are blocked on
exactly the same thing.
