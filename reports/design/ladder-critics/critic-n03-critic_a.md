# Blind critic run — rung n03, critic_a (openai/gpt-5.6-sol) — REPLAY ATTEMPT 2026-08-27

SYNTHETIC FIXTURE. Halewater Commons Trust, Kelverton, Marlpit, Dunmore Sixth Form College,
the Wren Hill Foundation and the Neighbourhood Futures Fund do not exist. Every name, figure,
date, partner, venue, vendor and person referred to anywhere in this file is invented for a
test fixture and is not a fact about any real organisation. The domain halewatercommons.org.uk
is part of the fixture and must never be crawled or cited as a source.

Date of original (refused) run: 2026-08-26
Date of replay attempt:        2026-08-27
Rung: n03 · Critic: critic_a = `openai/gpt-5.6-sol`
Packet: `.prompt-n03-critic_a.txt`, sent VERBATIM (51,169 chars; md5 of file
`09d110aad220fb1e0452af219ac0cd98`). Settings: reasoning_effort `low`, max_tokens 8000.

## RESULT: STILL NOT OBTAINED. No judgement exists for rung n03 / critic_a.

**The failure mode has changed, and this matters more than the missing verdict.**

The $15.76 key spend cap that produced the original `HTTP 403 Key limit exceeded` is **gone**.
Both replay calls were accepted upstream, generated, and **billed**. They were then lost to a
*different* block: **the MCP server's 60-second call ceiling.** The tool returned
`MCP server "OpenRouter_MCP" tool "send-message" timed out after 60s` — with no generation id,
so `get-generation` cannot recover the text. The money was spent; the answer is unreachable.

Proven by the credit meter, not inferred:

| moment | `total_usage` | delta |
|---|---|---|
| before call 1 | 15.760938031 | — |
| after call 1 (timed out) | 15.917938531 | **+0.1570005** |
| after call 2 (timed out) | 16.000221531 | **+0.082283** |

A timeout that bills is a completed generation, not a rejected one.

**Independently corroborated.** A sibling agent replaying rung n03 / critic_b
(`x-ai/grok-4.6`, a different model family, a different packet) hit the identical wall and
recorded it in `critic-n03-critic_b.md`. Two models, two packets, same 60s transport ceiling.
This is a property of the harness, not of any one endpoint.

### What was tried, and what was deliberately not tried

- Call 1: exactly as specified, default routing. Timed out at 60s.
- Call 2 (the single permitted retry): identical packet, identical model, identical
  `reasoning_effort: "low"` and `max_tokens: 8000`; **only** `provider: {sort: "throughput"}`
  added, because delivery latency was the sole demonstrated failure mode and routing is the
  only lever that touches it without touching the prompt, the blinding, or the sampling
  parameters. Timed out at 60s as well.
- **Not tried, on purpose:** lowering `max_tokens` to fit inside 60s (truncates the verdict and
  breaks comparability with the other rungs); raising or lowering `reasoning_effort` (pinned by
  the run design); shortening or summarising the packet (destroys the blinding); a third call
  (the brief permits one retry).

**There is no ranking, no fund/no-fund pick, no fundable / machine-generated / swappable
boolean, no critic referent count, no reject-list hit and no one-system judgement from this
critic.** Nothing below is inferred, estimated, or reconstructed. Do not read the absence of a
result as a passing result, and do not fill it from critic_b or from a neighbouring rung.

## Randomisation mapping — VERIFIED, not assumed

`.map-n03-critic_a.txt` contains `C B A D`. The sibling agent found that this same file does
**not** decode `_msg.txt`, so it was checked against *this* packet rather than trusted. Each
`===== DOC n =====` block was extracted from `.prompt-n03-critic_a.txt`, normalised
(HTML comments stripped, blank lines dropped, trailing whitespace trimmed) and compared for
exact equality against the same normalisation of `out-n03-{A,B,C,D}.md`. Four exact,
one-to-one matches:

| Label in packet | TRUE arm | Source file  | Normalised bytes | Match |
|---|---|---|---|---|
| Doc 1 | **C** — single prompt + current generator | `out-n03-C.md` | 14,385 | exact |
| Doc 2 | **B** — pipeline + stronger generator     | `out-n03-B.md` |  9,484 | exact |
| Doc 3 | **A** — pipeline + current generator      | `out-n03-A.md` | 10,063 | exact |
| Doc 4 | **D** — single prompt + stronger generator| `out-n03-D.md` |  8,063 | exact |

The mapping is correct for this packet. It is recorded here so the run stays repeatable.

## PRIOR DETERMINISTIC MEASUREMENTS — retained from the 2026-08-26 placeholder

These were computed locally, by counting and arithmetic, by the earlier agent. **They are not
a critic verdict** and were never claimed to be one. They are kept because they are real
measurements and overwriting this file would otherwise destroy them.

### Word count, Q1–Q5 bodies only (hard limit 1,200; over = returned unread)

Method: count words between `## Q1.` and the first non-Q heading; question headings excluded;
sub-headings and in-answer table cell text included; budget table and declaration excluded.

| arm | Q1–Q5 words | verdict against the 1,200 hard limit |
|-----|-------------|--------------------------------------|
| A   | 1,122       | under |
| B   | 1,216       | OVER by 16 — marginal, sensitive to whether in-answer table cells are counted |
| C   | 1,760       | OVER by 560 — returned unread on any counting method |
| D   | 1,172       | under |

### Budget arithmetic

- **A** — 25,200 + 6,600 + 5,400 + 3,200 + 2,500 = **42,900**, matches stated total. Overhead
  12% = 5,148 exact. Total 48,048 exact. Closes. Outcomes: 3 x 22 = 66; 52/66 = 78.8% ("79%");
  34/66 = 51.5% ("52%"); 28/34 = 82.4% ("82%") — all ok. Match funding row states "Secured" but
  carries no amount — an incomplete row against the call's requirement to show match with
  source and status.
- **B** — 45,000 + 7,500 + 3,000 + 5,000 + 2,500 + 1,400 + 900 + 600 + 1,000 = **66,900**,
  matches. Overhead 12% = 8,028 exact. Total 74,928, inside the 75,000 ceiling by 72. Chain
  70 → 55 → 40 → 33 internally consistent. Closes.
- **C** — 36,000 + 16,500 + 4,200 + 3,600 + 1,800 + 1,400 = **63,500**, matches. Overhead 7,000
  stated as "11.02% of direct costs"; 7,000/63,500 = 11.024%, under the 12% cap, so it closes,
  but the odd rate is a round-number overhead reverse-fitted to a percentage. Total 70,500
  exact. 3 x 24 = 72; 24 + 9 + 6 = 39; 57/72 = 79.2%; 39/72 = 54.2%; 30/39 = 76.9%; "drop-out
  exceeds 30% (fewer than 50 completers)" → 70% of 72 = 50.4, consistent. Arithmetic closes;
  the word count does not.
- **D** — 22,000 + 7,200 + 5,760 + 4,500 + 2,700 + 1,800 + 1,500 + 2,400 = **47,860**, matches.
  Overhead 12% = 5,743.2, stated 5,743. Total 53,603 exact. 48 = 3 x 16; 48 x £120 = 5,760.
  Closes.
  **Timeline defect (deterministic):** stated period April 2027 – June 2028 = 15 months. Cohort
  3 starts February 2028; 12 weeks ends ~May 2028; follow-through to week 26 runs to ~August
  2028 — roughly two months past the stated grant end. The headline outcome ("24 … still there
  at week 26") therefore cannot be evidenced for cohort 3 inside the grant. The document does
  not reconcile this.

### Distinct concrete named referents (local count; applicant and funder names excluded)

Counting places below city level, venues, vendors, named people with roles, named partners, and
prior results tied to a date. Kelverton is the town itself (city level) and is excluded.

| arm | count | what was counted | named people with roles | named vendors/suppliers |
|-----|-------|------------------|-------------------------|-------------------------|
| A | 6 | Marlpit; Dunmore Sixth Form College; "Second Chances"; 2024–25 referral result 27→18; Jan–Apr 2025 pilot 24/19/11; 2021 census 38% | 0 | 0 |
| B | 7 | as A, plus referral route "since 2023" | 0 | 0 |
| C | 8 | as B, plus "Progression Gateway" | 0 | 0 |
| D | 7 | as B | 0 | 0 |

All four cluster in a band of 6–8 and draw from an identical referent set. **Zero named people
with roles and zero named vendors or suppliers in any of the four.** No street, estate or
building is named anywhere; "Marlpit" and "our Marlpit site" are the entire geography below
town level, and the river is never named.

## WHAT IS STILL MISSING, AND WHAT IT WOULD TAKE

Everything requiring the critic: the ranking, the fund/no-fund pick, the fundable /
machine-generated / swappable booleans, the reject-list hits with quotes, and the "four
applicants or one system" call. Rung n03 remains unjudged, as do n06, n09, n12 and n06thin —
checked, and every `critic-*.md` in this directory is a non-result.

**Raising the key cap did not unblock this ladder.** The binding constraint is now the 60s MCP
call ceiling, and no amount of credit clears it. Finishing the ladder needs a transport that
can wait out a long generation — a direct API call with a longer client timeout, streaming, or
an MCP timeout above 60s — *not* more budget. Spending more through this path will keep
billing for answers that are never delivered: $0.239 has already been spent for zero verdicts.
